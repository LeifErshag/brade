import { getRedis, keys } from "../db/redis.js";
import { rooms } from "./server.js";

// The authoritative state of a room plus its live WebSocket connections, for
// debugging (GET /api/games/:roomId/debug) and problem reports. null when the
// room does not exist or has expired.
export async function roomSnapshot(roomId) {
  const redis = getRedis();
  const raw = await redis.get(keys.room(roomId));
  if (!raw) return null;
  const ttlSeconds = await redis.ttl(keys.room(roomId));
  const connected  = rooms.get(roomId);
  return {
    serverTime:  new Date().toISOString(),
    ttlSeconds,
    connections: connected ? [...connected].map(c => c.userId) : [], // userIds with a live WebSocket
    room:        JSON.parse(raw), // full authoritative room state
  };
}
