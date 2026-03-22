import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../auth/tokens.js";
import { handleMessage } from "./handlers.js";

// rooms: Map<roomId, Set<{ws, userId}>>
const rooms = new Map();

export function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Auth: expect token in query string ?token=...
    // (Access token only — short-lived, so safe to pass in URL once)
    const url    = new URL(req.url, "http://localhost");
    const token  = url.searchParams.get("token");
    const roomId = url.searchParams.get("room");

    if (!token || !roomId) { ws.close(4001, "Missing token or room"); return; }

    let userId;
    try {
      const payload = verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      ws.close(4001, "Invalid token"); return;
    }

    // Validate roomId format
    if (!/^[A-Z0-9]{8}$/.test(roomId)) { ws.close(4002, "Invalid room"); return; }

    // Join room channel
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const client = { ws, userId };
    rooms.get(roomId).add(client);

    ws.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; } // ignore malformed messages
      await handleMessage({ msg, userId, roomId, rooms, ws });
    });

    ws.on("close", () => {
      rooms.get(roomId)?.delete(client);
      if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);
      broadcastToRoom(roomId, rooms, { type: "PLAYER_DISCONNECTED", userId });
    });

    ws.on("error", (err) => console.error(`WS error [${roomId}]:`, err.message));

    // Acknowledge connection
    send(ws, { type: "CONNECTED", userId, roomId });
  });

  console.log("WebSocket server initialised");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

export function broadcastToRoom(roomId, rooms, payload, excludeUserId = null) {
  rooms.get(roomId)?.forEach(({ ws, userId }) => {
    if (userId !== excludeUserId) send(ws, payload);
  });
}