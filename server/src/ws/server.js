import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../auth/tokens.js";
import { handleMessage, scheduleDisconnectForfeit, cancelDisconnectForfeit } from "./handlers.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";

// rooms: Map<roomId, Set<{ws, userId}>>
export const rooms = new Map();
// userConnections: Map<userId, Set<ws>> — for in-app invite delivery
export const userConnections = new Map();

export function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    const url    = new URL(req.url, "http://localhost");
    const token  = url.searchParams.get("token");
    const roomId = url.searchParams.get("room");

    if (!token || !roomId) { ws.close(4001, "Missing token or room"); return; }

    let userId, isGuest = false, guestDisplayName = "Guest";
    try {
      const payload = verifyAccessToken(token);
      userId = payload.sub;
      if (payload.isGuest === true) {
        isGuest = true;
        guestDisplayName = payload.display_name ?? "Guest";
      }
    } catch {
      ws.close(4001, "Invalid token"); return;
    }

    if (!/^[A-Z0-9]{8}$/.test(roomId)) { ws.close(4002, "Invalid room"); return; }

    const redis = getRedis();
    const rawRoom = await redis.get(keys.room(roomId));
    if (!rawRoom) { ws.close(4003, "Room not found"); return; }

    let room = JSON.parse(rawRoom);
    // Reset TTL on every connect so active rooms never expire mid-session
    await redis.expire(keys.room(roomId), TTL.room);

    // Auto-assign black seat if empty and this is not the white player.
    // Tournament rooms always have both seats pre-assigned — skip for them.
    if (!room.tournamentId && !room.players.black && room.players.white !== userId) {
      let blackInfo;
      if (isGuest) {
        blackInfo = { display_name: guestDisplayName, avatar_url: null };
      } else {
        const { rows: [player] } = await query(
          `SELECT display_name, avatar_url FROM users WHERE id = $1`,
          [userId]
        );
        blackInfo = {
          display_name: player?.display_name ?? "Player",
          avatar_url:   player?.avatar_url   ?? null,
        };
      }
      room.players.black    = userId;
      room.playerInfo       = room.playerInfo ?? { white: null, black: null };
      room.playerInfo.black = blackInfo;
      if (isGuest) room.hasGuest = true;
      await redis.set(keys.room(roomId), JSON.stringify(room), "EX", TTL.room);
    }

    // Cancel any pending disconnect forfeit for this player
    const reconnectColor = room.players.white === userId ? "white"
                         : room.players.black === userId ? "black" : null;
    if (reconnectColor && room.status === "playing") {
      cancelDisconnectForfeit(roomId, reconnectColor);
    }

    // Add to rooms and userConnections before broadcasting so count is accurate
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const client = { ws, userId };
    rooms.get(roomId).add(client);

    if (!userConnections.has(userId)) userConnections.set(userId, new Set());
    userConnections.get(userId).add(ws);

    // Send full room state to every client in the room (including new arrival)
    broadcastState(roomId, room);

    ws.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      await handleMessage({ msg, userId, roomId, ws });
    });

    ws.on("close", async () => {
      rooms.get(roomId)?.delete(client);
      if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);

      userConnections.get(userId)?.delete(ws);
      if (userConnections.get(userId)?.size === 0) userConnections.delete(userId);

      broadcastToRoom(roomId, { type: "PLAYER_DISCONNECTED", userId });

      // Schedule forfeit if a player disconnects mid-game
      const freshRaw = await getRedis().get(keys.room(roomId)).catch(() => null);
      if (freshRaw) {
        const freshRoom = JSON.parse(freshRaw);
        if (freshRoom.status === "playing") {
          const dc = freshRoom.players.white === userId ? "white"
                   : freshRoom.players.black === userId ? "black" : null;
          if (dc) scheduleDisconnectForfeit(roomId, dc, userId);
        }
      }
    });

    ws.on("error", (err) => console.error(`WS error [${roomId}]:`, err.message));
  });

  console.log("WebSocket server initialised");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

// Signature changed: rooms is now module-level, no longer passed as argument
export function broadcastToRoom(roomId, payload, excludeUserId = null) {
  rooms.get(roomId)?.forEach(({ ws, userId }) => {
    if (userId !== excludeUserId) send(ws, payload);
  });
}

// Broadcasts ROOM_STATE with live spectator count (not persisted to Redis)
export function broadcastState(roomId, room) {
  const connected = rooms.get(roomId);
  const playerIds = [room.players.white, room.players.black].filter(Boolean);
  const spectatorCount = connected
    ? [...connected].filter(c => !playerIds.includes(c.userId)).length
    : 0;
  broadcastToRoom(roomId, { type: "ROOM_STATE", room, spectatorCount });
}

export function sendToUser(userId, payload) {
  userConnections.get(userId)?.forEach(ws => send(ws, payload));
}
