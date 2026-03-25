import Redis from "ioredis";

let client;

export async function connectRedis() {
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  await client.ping();
  console.log("Redis connected");
}

export function getRedis() { return client; }

// ── Key namespace helpers ─────────────────────────────────────────────────────
// Keeps all keys organised and prevents collisions
export const keys = {
  room:         (id)     => `room:${id}`,              // game room state (JSON)
  roomPlayers:  (id)     => `room:${id}:players`,      // set of player user IDs
  refreshToken: (userId) => `refresh:${userId}`,       // refresh token → userId
  matchQueue:   ()       => "queue:match",              // sorted set: userId → ELO
  matchInfo:    (userId) => `queue:match:info:${userId}`, // JSON: elo, joinedAt, matchLength, display_name, avatar_url
  matchResult:  (userId) => `queue:match:result:${userId}`, // roomId when matched
  invite:       (id)     => `invite:${id}`,            // invite link metadata
};

// TTLs (seconds)
export const TTL = {
  room:    60 * 60 * 24,   // 24 hours — abandoned games auto-expire
  refresh: 60 * 60 * 24 * 7, // 7 days
  invite:  60 * 60 * 48,   // 48 hours
};