import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";

const router = Router();

const CreateGameSchema = z.object({
  matchLength: z.number().int().min(1).max(7).default(5),
});

// ── POST /api/games — create a new game room ──────────────────────────────────
router.post("/", requireAuth, validate(CreateGameSchema), async (req, res) => {
  const { matchLength } = req.body;
  const roomId = uuid().slice(0, 8).toUpperCase(); // e.g. "A3F9B2C1"

  const roomState = {
    roomId,
    matchLength,
    createdBy: req.userId,
    players: { white: req.userId, black: null },
    status: "waiting",          // waiting | playing | finished
    gameState: null,            // populated when game starts
    createdAt: Date.now(),
  };

  const redis = getRedis();
  await redis.set(keys.room(roomId), JSON.stringify(roomState), "EX", TTL.room);

  // Also store in postgres for history (without full game state)
  await query(
    `INSERT INTO games (room_id, white_id, match_length) VALUES ($1, $2, $3)`,
    [roomId, req.userId, matchLength]
  );

  const inviteUrl = `${process.env.CLIENT_ORIGIN}/game/${roomId}`;
  return res.status(201).json({ roomId, inviteUrl });
});

// ── GET /api/games/:roomId — get room info ────────────────────────────────────
router.get("/:roomId", requireAuth, async (req, res) => {
  const { roomId } = req.params;
  // Validate roomId format — 8 alphanumeric chars
  if (!/^[A-Z0-9]{8}$/.test(roomId)) {
    return res.status(400).json({ error: "Invalid room ID" });
  }
  const redis = getRedis();
  const raw = await redis.get(keys.room(roomId));
  if (!raw) return res.status(404).json({ error: "Room not found or expired" });
  const room = JSON.parse(raw);
  // Don't expose internal state fields to non-participants
  const isParticipant = [room.players.white, room.players.black].includes(req.userId);
  if (!isParticipant && room.status !== "waiting") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json({ roomId: room.roomId, status: room.status,
    matchLength: room.matchLength, players: room.players });
});

// ── GET /api/games — current user's match history ─────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.room_id, g.win_type, g.monk,
            g.white_score, g.black_score, g.ended_at,
            g.white_elo_after, g.black_elo_after,
            w.display_name AS white_name, b.display_name AS black_name
     FROM games g
     LEFT JOIN users w ON w.id = g.white_id
     LEFT JOIN users b ON b.id = g.black_id
     WHERE g.white_id = $1 OR g.black_id = $1
     ORDER BY g.started_at DESC
     LIMIT 20`,
    [req.userId]
  );
  return res.json(rows);
});

export default router;