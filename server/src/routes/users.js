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
    `SELECT display_name, avatar_url, elo, wins, losses
     FROM users ORDER BY elo DESC LIMIT 20`
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
