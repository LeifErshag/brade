import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";
import { initGame } from "../game/engine.js";

const router = Router();

const JoinSchema = z.object({
  matchLength: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)]).default(5),
});

// ── POST /api/matchmaking/join ────────────────────────────────────────────────
router.post("/join", requireAuth, validate(JoinSchema), async (req, res) => {
  const { matchLength } = req.body;
  const userId = req.userId;
  const redis  = getRedis();

  // Already matched from a previous join/poll cycle?
  const existing = await redis.get(keys.matchResult(userId));
  if (existing) return res.json({ status: "matched", roomId: existing });

  // Fetch user info
  const { rows: [user] } = await query(
    `SELECT display_name, avatar_url, elo FROM users WHERE id = $1`, [userId]
  );
  if (!user) return res.status(404).json({ error: "User not found" });

  // Already in queue? Keep existing join time (don't reset the clock)
  const alreadyIn = await redis.zscore(keys.matchQueue(), userId);
  const joinedAt  = alreadyIn != null
    ? JSON.parse((await redis.get(keys.matchInfo(userId))) ?? "{}").joinedAt ?? Date.now()
    : Date.now();

  // (Re-)add to queue with ELO as score
  await redis.zadd(keys.matchQueue(), user.elo, userId);
  await redis.set(
    keys.matchInfo(userId),
    JSON.stringify({ elo: user.elo, joinedAt, matchLength,
                     display_name: user.display_name, avatar_url: user.avatar_url ?? null }),
    "EX", 300
  );

  // Attempt immediate match
  const roomId = await tryMatch(redis, userId, user.elo, joinedAt, matchLength, user);
  if (roomId) return res.json({ status: "matched", roomId });

  const queueSize = await redis.zcard(keys.matchQueue());
  return res.json({ status: "waiting", queueSize, joinedAt });
});

// ── GET /api/matchmaking/status ───────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  const userId = req.userId;
  const redis  = getRedis();

  // Matched?
  const roomId = await redis.get(keys.matchResult(userId));
  if (roomId) {
    await redis.del(keys.matchResult(userId));
    return res.json({ status: "matched", roomId });
  }

  // Still in queue?
  const score = await redis.zscore(keys.matchQueue(), userId);
  if (score === null) return res.json({ status: "idle" });

  // Try to match (with possibly expanded range after waiting)
  const infoRaw = await redis.get(keys.matchInfo(userId));
  if (infoRaw) {
    const info = JSON.parse(infoRaw);
    const { rows: [user] } = await query(
      `SELECT display_name, avatar_url FROM users WHERE id = $1`, [userId]
    );
    const matched = await tryMatch(
      redis, userId, info.elo, info.joinedAt, info.matchLength,
      { display_name: info.display_name, avatar_url: info.avatar_url, ...user }
    );
    if (matched) return res.json({ status: "matched", roomId: matched });
  }

  const queueSize = await redis.zcard(keys.matchQueue());
  const joinedAt  = infoRaw ? JSON.parse(infoRaw).joinedAt : null;
  return res.json({ status: "waiting", queueSize, joinedAt });
});

// ── POST /api/matchmaking/leave ───────────────────────────────────────────────
router.post("/leave", requireAuth, async (req, res) => {
  await leaveQueue(getRedis(), req.userId);
  return res.json({ status: "left" });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function leaveQueue(redis, userId) {
  await redis.zrem(keys.matchQueue(), userId);
  await redis.del(keys.matchInfo(userId));
}

// Find and claim a match for userId. Returns roomId string or null.
async function tryMatch(redis, userId, elo, joinedAt, matchLength, userInfo) {
  const waitSecs = (Date.now() - joinedAt) / 1000;
  // ±200 ELO initially, +100 per 30s, unlimited after 90s
  const range = waitSecs > 90 ? 999999 : 200 + Math.floor(waitSecs / 30) * 100;

  const candidates = await redis.zrangebyscore(keys.matchQueue(), elo - range, elo + range);
  const others = candidates.filter(id => id !== userId);
  if (others.length === 0) return null;

  // Prefer the player who has waited longest
  let best = null, bestTime = Infinity;
  for (const candidateId of others) {
    const raw = await redis.get(keys.matchInfo(candidateId));
    if (!raw) continue;
    const info = JSON.parse(raw);
    if (info.joinedAt < bestTime) { bestTime = info.joinedAt; best = { id: candidateId, ...info }; }
  }
  if (!best) return null;

  // Atomically claim the opponent — if ZREM returns 0 they were already taken
  const claimed = await redis.zrem(keys.matchQueue(), best.id);
  if (!claimed) return null;

  await redis.zrem(keys.matchQueue(), userId);
  await redis.del(keys.matchInfo(best.id));
  await redis.del(keys.matchInfo(userId));

  // Longer-waiting player gets white
  const [whiteId, whiteInfo, blackId, blackInfo] = best.joinedAt <= joinedAt
    ? [best.id, best, userId, userInfo]
    : [userId, userInfo, best.id, best];

  // Match length: use white player's preference
  const usedMatchLength = whiteId === userId ? matchLength : best.matchLength ?? matchLength;

  // Fetch current ELOs from DB
  const { rows: eloRows } = await query(
    `SELECT id, elo FROM users WHERE id = ANY($1::uuid[])`,
    [[whiteId, blackId]]
  );
  const eloMap = Object.fromEntries(eloRows.map(p => [p.id, p.elo]));

  // Create room
  const roomId = uuid().slice(0, 8).toUpperCase();
  const gs = initGame();
  gs.legalMoves = [];

  const roomState = {
    roomId,
    matchLength: usedMatchLength,
    createdBy:   whiteId,
    players:     { white: whiteId, black: blackId },
    playerInfo:  {
      white: { display_name: whiteInfo.display_name, avatar_url: whiteInfo.avatar_url ?? null },
      black: { display_name: blackInfo.display_name, avatar_url: blackInfo.avatar_url ?? null },
    },
    ready:     { white: true, black: true },
    status:    "playing",
    score:     { white: 0, black: 0 },
    gameNum:   1,
    gameState: gs,
    createdAt: Date.now(),
  };

  await query(
    `INSERT INTO games (room_id, white_id, black_id, match_length, white_elo_before, black_elo_before)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [roomId, whiteId, blackId, usedMatchLength, eloMap[whiteId] ?? 1200, eloMap[blackId] ?? 1200]
  );
  const { rows: [gameRow] } = await query(`SELECT id FROM games WHERE room_id = $1`, [roomId]);
  roomState.gameDbId = gameRow.id;

  await redis.set(keys.room(roomId), JSON.stringify(roomState), "EX", TTL.room);

  // Notify both players (consumed on first status poll)
  await redis.set(keys.matchResult(whiteId), roomId, "EX", 300);
  await redis.set(keys.matchResult(blackId), roomId, "EX", 300);

  return roomId;
}

export default router;
