import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { query } from "../db/postgres.js";
import {
  generateRoundRobin,
  generateSingleEliminationRound1,
  generateSwissPairings,
  createMatchRound,
} from "../game/tournament.js";

const router = Router();

const CreateSchema = z.object({
  name:            z.string().min(2).max(60),
  tournament_type: z.enum(["round_robin", "single_elimination", "swiss"]).default("round_robin"),
  match_length:    z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)]).default(3),
  max_players:     z.number().int().min(2).max(32).default(8),
  total_rounds:    z.number().int().min(1).max(20).optional(),
});

// ── POST /api/tournaments ─────────────────────────────────────────────────────
router.post("/", requireAuth, validate(CreateSchema), async (req, res) => {
  const { name, tournament_type, match_length, max_players, total_rounds } = req.body;
  const creatorId = req.userId;

  const { rows: [t] } = await query(
    `INSERT INTO tournaments (name, creator_id, tournament_type, match_length, max_players, total_rounds)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, creatorId, tournament_type, match_length, max_players, total_rounds ?? null]
  );

  // Auto-join the creator
  const { rows: [user] } = await query(
    `SELECT elo FROM users WHERE id = $1`, [creatorId]
  );
  await query(
    `INSERT INTO tournament_players (tournament_id, player_id, seed_elo)
     VALUES ($1, $2, $3)`,
    [t.id, creatorId, user?.elo ?? 1200]
  );

  return res.status(201).json(t);
});

// ── GET /api/tournaments ──────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { rows } = await query(`
    SELECT t.*,
           u.display_name AS creator_name,
           COUNT(tp.player_id)::int AS player_count
    FROM   tournaments t
    JOIN   users u  ON u.id  = t.creator_id
    LEFT   JOIN tournament_players tp ON tp.tournament_id = t.id
    WHERE  t.status IN ('registration', 'active', 'finished')
    GROUP  BY t.id, u.display_name
    ORDER  BY t.created_at DESC
    LIMIT  50
  `);
  return res.json(rows);
});

// ── GET /api/tournaments/:id ──────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { rows: [t] } = await query(
    `SELECT t.*, u.display_name AS creator_name,
            w.display_name AS winner_name
     FROM   tournaments t
     JOIN   users u ON u.id = t.creator_id
     LEFT   JOIN users w ON w.id = t.winner_id
     WHERE  t.id = $1`,
    [id]
  );
  if (!t) return res.status(404).json({ error: "Tournament not found" });

  const { rows: players } = await query(
    `SELECT tp.*, u.display_name, u.avatar_url
     FROM   tournament_players tp
     JOIN   users u ON u.id = tp.player_id
     WHERE  tp.tournament_id = $1
     ORDER  BY tp.wins DESC, tp.losses ASC, tp.seed_elo DESC`,
    [id]
  );

  const { rows: matches } = await query(
    `SELECT tm.*,
            w.display_name  AS white_name,
            b.display_name  AS black_name,
            win.display_name AS winner_name
     FROM   tournament_matches tm
     LEFT   JOIN users w   ON w.id   = tm.white_id
     LEFT   JOIN users b   ON b.id   = tm.black_id
     LEFT   JOIN users win ON win.id = tm.winner_id
     WHERE  tm.tournament_id = $1
     ORDER  BY tm.round ASC, tm.created_at ASC`,
    [id]
  );

  return res.json({ ...t, players, matches });
});

// ── POST /api/tournaments/:id/join ────────────────────────────────────────────
router.post("/:id/join", requireAuth, async (req, res) => {
  const { id }   = req.params;
  const userId   = req.userId;

  const { rows: [t] } = await query(
    `SELECT * FROM tournaments WHERE id = $1`, [id]
  );
  if (!t) return res.status(404).json({ error: "Tournament not found" });
  if (t.status !== "registration")
    return res.status(400).json({ error: "Registration is closed" });

  const { rows: [cnt] } = await query(
    `SELECT COUNT(*)::int AS n FROM tournament_players WHERE tournament_id = $1`, [id]
  );
  if (cnt.n >= t.max_players)
    return res.status(400).json({ error: "Tournament is full" });

  const { rows: [user] } = await query(
    `SELECT elo FROM users WHERE id = $1`, [userId]
  );

  try {
    await query(
      `INSERT INTO tournament_players (tournament_id, player_id, seed_elo)
       VALUES ($1, $2, $3)`,
      [id, userId, user?.elo ?? 1200]
    );
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Already registered" });
    throw e;
  }

  return res.json({ status: "joined" });
});

// ── POST /api/tournaments/:id/leave ───────────────────────────────────────────
router.post("/:id/leave", requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const { rows: [t] } = await query(
    `SELECT * FROM tournaments WHERE id = $1`, [id]
  );
  if (!t) return res.status(404).json({ error: "Tournament not found" });
  if (t.status !== "registration")
    return res.status(400).json({ error: "Cannot leave an active tournament" });
  if (t.creator_id === userId)
    return res.status(400).json({ error: "Creator cannot leave — cancel instead" });

  await query(
    `DELETE FROM tournament_players WHERE tournament_id = $1 AND player_id = $2`,
    [id, userId]
  );
  return res.json({ status: "left" });
});

// ── POST /api/tournaments/:id/cancel ─────────────────────────────────────────
router.post("/:id/cancel", requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const { rows: [t] } = await query(
    `SELECT * FROM tournaments WHERE id = $1`, [id]
  );
  if (!t) return res.status(404).json({ error: "Tournament not found" });
  if (t.creator_id !== userId)
    return res.status(403).json({ error: "Only the creator can cancel" });
  if (t.status === "finished")
    return res.status(400).json({ error: "Tournament already finished" });

  await query(
    `UPDATE tournaments SET status = 'cancelled' WHERE id = $1`, [id]
  );
  return res.json({ status: "cancelled" });
});

// ── POST /api/tournaments/:id/start ──────────────────────────────────────────
router.post("/:id/start", requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const { rows: [t] } = await query(
    `SELECT * FROM tournaments WHERE id = $1`, [id]
  );
  if (!t) return res.status(404).json({ error: "Tournament not found" });
  if (t.creator_id !== userId)
    return res.status(403).json({ error: "Only the creator can start" });
  if (t.status !== "registration")
    return res.status(400).json({ error: "Tournament already started or finished" });

  const { rows: players } = await query(
    `SELECT player_id, seed_elo FROM tournament_players
     WHERE  tournament_id = $1
     ORDER  BY seed_elo DESC`,
    [id]
  );
  if (players.length < 2)
    return res.status(400).json({ error: "Need at least 2 players to start" });

  const playerIds = players.map(p => p.player_id);
  const n         = playerIds.length;

  // Compute total rounds
  let totalRounds = t.total_rounds;
  if (t.tournament_type === "round_robin") {
    totalRounds = n % 2 === 0 ? n - 1 : n;
  } else if (t.tournament_type === "single_elimination") {
    totalRounds = Math.ceil(Math.log2(n));
  } else if (t.tournament_type === "swiss" && !totalRounds) {
    totalRounds = Math.ceil(Math.log2(n));
  }

  await query(
    `UPDATE tournaments
        SET status = 'active', current_round = 1, total_rounds = $2, started_at = now()
      WHERE id = $1`,
    [id, totalRounds]
  );

  // Generate round 1 pairs
  let pairs;
  if (t.tournament_type === "round_robin") {
    const allRounds = generateRoundRobin(playerIds);
    pairs = allRounds[0];
  } else if (t.tournament_type === "single_elimination") {
    pairs = generateSingleEliminationRound1(playerIds);
  } else {
    // Swiss round 1: pair by standing (ELO order, no prior matches)
    const standings = players.map(p => ({ playerId: p.player_id, wins: 0, losses: 0 }));
    pairs = generateSwissPairings(standings, new Set());
  }

  await createMatchRound(id, 1, t.match_length, pairs);

  return res.json({ status: "started", tournamentId: id });
});

export default router;
