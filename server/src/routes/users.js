import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { query } from "../db/postgres.js";

const router = Router();

const patchMeSchema = z.object({
  display_name: z.string().trim().min(1, "Name too short").max(50, "Name too long"),
});

router.patch("/me", requireAuth, validate(patchMeSchema), async (req, res) => {
  const { rows } = await query(
    `UPDATE users SET display_name = $1
     WHERE id = $2
     RETURNING id, display_name, avatar_url, elo, wins, losses, created_at`,
    [req.body.display_name, req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });
  return res.json(rows[0]);
});

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, display_name, avatar_url, elo, wins, losses, created_at
     FROM users WHERE id = $1`,
    [req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });
  return res.json(rows[0]);
});

router.get("/leaderboard", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, display_name, avatar_url, elo, wins, losses
     FROM users
     WHERE oauth_provider != 'system'
     ORDER BY elo DESC LIMIT 20`
  );
  return res.json(rows);
});

// ── GET /api/users/search?q=name — find users by display name ────────────────
router.get("/search", requireAuth, async (req, res) => {
  const q = (req.query.q ?? "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters" });
  const { rows } = await query(
    `SELECT id, display_name, avatar_url FROM users
     WHERE display_name ILIKE $1 AND id != $2
     ORDER BY display_name LIMIT 10`,
    [`%${q}%`, req.userId]
  );
  return res.json(rows);
});

router.get("/:id/games", async (req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.win_type, g.monk,
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
    [req.params.id]
  );
  return res.json(rows);
});

router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT display_name, avatar_url, elo, wins, losses FROM users WHERE id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });
  return res.json(rows[0]);
});

export default router;
