import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";
import { initGame } from "../game/engine.js";
import { AI_USER_ID, AI_DISPLAY } from "../game/ai.js";

const router = Router();

const CreateGameSchema = z.object({
  matchLength: z.union([
    z.literal(1), z.literal(3), z.literal(5), z.literal(7),
  ]).default(5),
  opponent:     z.enum(["human", "ai"]).default("human"),
  aiDifficulty: z.enum(["beginner", "journeyman", "master", "grandmaster"]).default("journeyman"),
});

// ── POST /api/games — create a new game room ──────────────────────────────────
router.post("/", requireAuth, validate(CreateGameSchema), async (req, res) => {
  const { matchLength, opponent, aiDifficulty } = req.body;
  const isAi  = opponent === "ai";
  const roomId = uuid().slice(0, 8).toUpperCase();

  const { rows: [creator] } = await query(
    `SELECT display_name, avatar_url FROM users WHERE id = $1`,
    [req.userId]
  );

  const redis = getRedis();

  if (isAi) {
    // Ensure the AI system user exists in the DB (idempotent)
    await query(
      `INSERT INTO users (id, oauth_provider, oauth_id, display_name)
       VALUES ($1, 'system', 'computer', 'Computer')
       ON CONFLICT DO NOTHING`,
      [AI_USER_ID]
    );

    const gs = initGame();
    gs.legalMoves = [];

    const roomState = {
      roomId,
      matchLength,
      createdBy:   req.userId,
      isAi:        true,
      aiDifficulty,
      players:     { white: req.userId, black: AI_USER_ID },
      playerInfo:  {
        white: { display_name: creator?.display_name ?? "Player", avatar_url: creator?.avatar_url ?? null },
        black: AI_DISPLAY,
      },
      ready:     { white: true, black: true },
      status:    "playing",
      score:     { white: 0, black: 0 },
      gameNum:   1,
      gameState: gs,
      createdAt: Date.now(),
    };

    // Persist game record with both players and starting ELOs
    await query(
      `INSERT INTO games (room_id, white_id, black_id, match_length, white_elo_before, black_elo_before)
       VALUES ($1, $2, $3, $4,
         (SELECT elo FROM users WHERE id = $2),
         1200)`,
      [roomId, req.userId, AI_USER_ID, matchLength]
    );
    const { rows: [gameRow] } = await query(
      `SELECT id FROM games WHERE room_id = $1`, [roomId]
    );
    roomState.gameDbId = gameRow.id;

    await redis.set(keys.room(roomId), JSON.stringify(roomState), "EX", TTL.room);
    return res.status(201).json({ roomId, inviteUrl: null, isAi: true });
  }

  // ── Human vs human ────────────────────────────────────────────────────────
  const roomState = {
    roomId,
    matchLength,
    createdBy: req.userId,
    players:    { white: req.userId, black: null },
    playerInfo: {
      white: { display_name: creator?.display_name ?? "Player", avatar_url: creator?.avatar_url ?? null },
      black: null,
    },
    ready:     { white: false, black: false },
    status:    "waiting",
    gameState: null,
    createdAt: Date.now(),
  };

  await redis.set(keys.room(roomId), JSON.stringify(roomState), "EX", TTL.room);

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
  if (!/^[A-Z0-9]{8}$/.test(roomId)) {
    return res.status(400).json({ error: "Invalid room ID" });
  }
  const redis = getRedis();
  const raw = await redis.get(keys.room(roomId));
  if (!raw) return res.status(404).json({ error: "Room not found or expired" });
  const room = JSON.parse(raw);
  const isParticipant = [room.players.white, room.players.black].includes(req.userId);
  if (!isParticipant && room.status !== "waiting") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json({
    roomId:      room.roomId,
    status:      room.status,
    matchLength: room.matchLength,
    players:     room.players,
    playerInfo:  room.playerInfo,
    isAi:        room.isAi ?? false,
  });
});

// ── GET /api/games — current user's match history ─────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.room_id, g.win_type, g.monk,
            g.white_score, g.black_score, g.ended_at, g.match_length,
            g.white_id, g.black_id, g.winner_id,
            g.white_elo_before, g.white_elo_after,
            g.black_elo_before, g.black_elo_after,
            w.display_name AS white_name, b.display_name AS black_name
     FROM games g
     LEFT JOIN users w ON w.id = g.white_id
     LEFT JOIN users b ON b.id = g.black_id
     WHERE (g.white_id = $1 OR g.black_id = $1) AND g.ended_at IS NOT NULL
     ORDER BY g.ended_at DESC
     LIMIT 20`,
    [req.userId]
  );
  return res.json(rows);
});

export default router;
