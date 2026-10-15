import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../auth/tokens.js";
import {
  handleMessage, scheduleDisconnectForfeit, cancelDisconnectForfeit, triggerAiTurn, DISCONNECT_FORFEIT_MS,
} from "./handlers.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";
import { withRoomLock } from "./roomLock.js";

// rooms: Map<roomId, Set<{ws, userId}>>
export const rooms = new Map();
// userConnections: Map<userId, Set<ws>> — for in-app invite delivery
export const userConnections = new Map();
// inFlightConnections: Map<`${roomId}:${userId}`, number> — connects still
// inside handleConnection (not yet registered in rooms, not yet given up)
export const inFlightConnections = new Map();
// pendingSeatReleases: Map<`${roomId}:${userId}`, {isGuest, hadGuest}> — a
// black seat auto-assigned to this user in this room that no connection of
// the user has used yet (none has registered since). It is given back once
// every in-flight connect of the user has settled without registering, and
// forgotten as soon as one registers. Only ever set while a connect is in
// flight, so entries never outlive the connects that created them.
const pendingSeatReleases = new Map();

// Test helper: number of seats still waiting to be released or confirmed.
export function pendingSeatReleaseCount() {
  return pendingSeatReleases.size;
}

export function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // The connection handler is async: an error escaping it (e.g. Redis or
    // Postgres down) would be an unhandled rejection. Log it and close the
    // socket with 1011 (internal error) so the client can retry.
    handleConnection(ws, req).catch((err) => {
      console.error("WS connection error:", err);
      ws.close(1011, "Server error");
    });
  });

  console.log("WebSocket server initialised");
}

export async function handleConnection(ws, req) {
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

  // Count this connect as in flight (synchronously, before the first await)
  // until it has registered or given up, so a seat release can tell that the
  // same user has another connection on its way in.
  const flightKey = `${roomId}:${userId}`;
  inFlightConnections.set(flightKey, (inFlightConnections.get(flightKey) ?? 0) + 1);
  try {
    // The whole connect (seat assignment, release, registration and the
    // first ROOM_STATE broadcast) runs under the room's lock, so it cannot
    // lose or be overwritten by a concurrent room update, and the state it
    // broadcasts is never older than one another writer already sent.
    await withRoomLock(roomId, () => connectToRoom(ws, roomId, userId, isGuest, guestDisplayName));
  } finally {
    const n = inFlightConnections.get(flightKey) - 1;
    if (n > 0) inFlightConnections.set(flightKey, n);
    else inFlightConnections.delete(flightKey);
    // When the user's last in-flight connect to this room has settled and a
    // seat auto-assigned to them is still pending (no connection of theirs
    // registered), give it back now. This catches every way a section can
    // end without handling the pending release itself: it threw (e.g. its
    // Redis read failed after an earlier same-user connect had deferred the
    // release to it) or it returned early (e.g. room not found, 4003). It
    // also makes the in-section release redundant in today's orderings; that
    // one just releases a little sooner, before other queued sections run.
    // Re-checks happen inside releasePendingSeat, under the lock, so a new
    // connect that arrived meanwhile keeps the release deferred to itself.
    // Taking the lock is safe here (DEADLOCK RULE): this code runs after our
    // locked section has settled, not inside it.
    if (n <= 0 && pendingSeatReleases.has(flightKey)) {
      try {
        await withRoomLock(roomId, () => releasePendingSeat(roomId, userId, 0));
      } catch (err) {
        console.error(`Seat release error [${roomId}]:`, err);
      }
    }
  }
}

// Runs under the room's lock (see handleConnection). It must not take that
// lock again: triggerAiTurn below is fire-and-forget, so it only queues, and
// releasePendingSeat runs inside this same locked section.
async function connectToRoom(ws, roomId, userId, isGuest, guestDisplayName) {
  const redis = getRedis();
  const rawRoom = await redis.get(keys.room(roomId));
  if (!rawRoom) { ws.close(4003, "Room not found"); return; }

  let room = JSON.parse(rawRoom);
  // Reset TTL on every connect so active rooms never expire mid-session
  await redis.expire(keys.room(roomId), TTL.room);

  // Auto-assign black seat if empty and this is not the white player.
  // Tournament rooms always have both seats pre-assigned — skip for them.
  if (!room.tournamentId && !room.players.black && room.players.white !== userId) {
    const hadGuest = room.hasGuest === true;
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
    // Unused until a connection of this user registers (see below).
    pendingSeatReleases.set(`${roomId}:${userId}`, { isGuest, hadGuest });
  }

  // The client may have disconnected while we awaited Redis/Postgres above.
  // Its "close" event has then already fired, before our close listener
  // existed, so registering it now would leave rooms/userConnections entries
  // that are never cleaned up. Nothing on the registration path below
  // awaits, so this check suffices.
  // Returning before cancelDisconnectForfeit keeps any pending forfeit.
  if (ws.readyState !== 1 /* OPEN */) {
    // If a seat auto-assigned to this user (by this connect or an earlier
    // one of theirs that also dropped) is still unused, give it back instead
    // of leaving it held by a gone client, unless another connect of theirs
    // is still in flight; the last of those to settle then releases it.
    if (pendingSeatReleases.has(`${roomId}:${userId}`)) await releasePendingSeat(roomId, userId, 1);
    return;
  }

  // This connection registers below, so a seat assigned to the user is now in
  // use: it must not be released later, even when this connection closes.
  pendingSeatReleases.delete(`${roomId}:${userId}`);

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

  // If this is an AI game and it's the AI's turn, kick it off. This covers the
  // game created with the AI going first before any WebSocket connection
  // existed to trigger the normal ROLL/MOVE flow, and an AI turn left half
  // played (black "moving" with moves left) after its retries gave up, e.g.
  // Redis was down for longer than the backoff (issue #79). aiRoll resumes
  // such a turn with the dice already rolled; it never re-rolls. If a turn
  // is still running, this only asks it for a rerun.
  const gs = room.gameState;
  const aiToRoll = gs?.phase === "rolling";
  const aiMidTurn = gs?.phase === "moving" && gs.legalMoves?.length > 0 && gs.dice?.length > 0;
  if (room.isAi && room.status === "playing" && gs?.turn === "black" && (aiToRoll || aiMidTurn)) {
    triggerAiTurn(roomId, room.aiDifficulty).catch(e => console.error("AI first-turn error:", e));
  }

  ws.on("message", async (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    // A handler exception must never escape: an unhandled rejection here
    // would kill the process and drop every live game.
    try {
      await handleMessage({ msg, userId, roomId, ws });
    } catch (err) {
      console.error(`WS handler error [${roomId}] type=${msg?.type}:`, err);
      send(ws, { type: "ERROR", message: "Server error" });
    }
  });

  ws.on("close", async () => {
    rooms.get(roomId)?.delete(client);
    if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);

    userConnections.get(userId)?.delete(ws);
    if (userConnections.get(userId)?.size === 0) userConnections.delete(userId);

    broadcastToRoom(roomId, { type: "PLAYER_DISCONNECTED", userId });

    // Schedule a forfeit if a player disconnects mid-game, unless the same
    // user still has another open connection registered in this room (issue
    // #79). The check is made after the Redis read, right before scheduling,
    // with no await in between. A reconnect registers and cancels the forfeit
    // in one synchronous step too (connectToRoom), so whichever runs first,
    // no stale forfeit is left behind: a reconnect that registered during
    // our read makes us skip scheduling, and one that comes later cancels
    // what we scheduled. The forfeit delay counts from the drop, not from
    // when the read finished.
    const droppedAt = Date.now();
    const freshRaw = await getRedis().get(keys.room(roomId)).catch(() => null);
    if (!freshRaw) return;
    const freshRoom = JSON.parse(freshRaw);
    if (freshRoom.status !== "playing") return;
    const dc = freshRoom.players.white === userId ? "white"
             : freshRoom.players.black === userId ? "black" : null;
    if (!dc) return;
    const stillConnected = [...(rooms.get(roomId) ?? [])]
      .some(c => c.userId === userId && c.ws.readyState === 1 /* OPEN */);
    if (stillConnected) return;
    // Only what is left of the forfeit delay since the drop.
    scheduleDisconnectForfeit(roomId, dc, userId, DISCONNECT_FORFEIT_MS - (Date.now() - droppedAt));
  });

  ws.on("error", (err) => console.error(`WS error [${roomId}]:`, err.message));
}

// Give back a black seat auto-assigned to a user none of whose connections
// to the room has registered since (see pendingSeatReleases). Runs under the
// room's lock (called from connectToRoom's section or from handleConnection's
// own locked call), so it must not take the lock itself.
//
// selfInFlight is how many of the user's in-flight connects belong to the
// caller (1 from inside a connect's section, 0 after it has settled). If more
// are in flight, the release is deferred to the last of them: e.g. a quick
// reconnect queued behind this lock reads the room with the seat already
// assigned, does not assign it again, and would otherwise leave it held if it
// drops too. If the user has an open registered connection here, the seat is
// in use and is kept. Re-reads the room (defensively, in case a writer
// outside the lock changed it), and keeps the seat if the room has left the
// lobby or the seat has changed hands.
async function releasePendingSeat(roomId, userId, selfInFlight) {
  const key = `${roomId}:${userId}`;
  const pending = pendingSeatReleases.get(key);
  if (!pending) return;
  if ((inFlightConnections.get(key) ?? 0) > selfInFlight) return; // deferred
  pendingSeatReleases.delete(key);

  const registered = [...(rooms.get(roomId) ?? [])]
    .some(c => c.userId === userId && c.ws.readyState === 1 /* OPEN */);
  if (registered) return;

  const redis = getRedis();
  const raw = await redis.get(keys.room(roomId));
  if (!raw) return;
  const room = JSON.parse(raw);
  if (room.status !== "waiting" || room.players.black !== userId) return;

  room.players.black = null;
  if (room.playerInfo) room.playerInfo.black = null;
  if (room.ready) room.ready.black = false;
  if (pending.isGuest && !pending.hadGuest) delete room.hasGuest;
  await redis.set(keys.room(roomId), JSON.stringify(room), "EX", TTL.room);
  broadcastState(roomId, room);
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
