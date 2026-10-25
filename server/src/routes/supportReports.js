import { Router } from "express";
import { z } from "zod";
import { optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { rateLimitSupportReport } from "../middleware/ratelimit.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { query } from "../db/postgres.js";
import { roomSnapshot } from "../ws/roomSnapshot.js";
import { log } from "../log.js";

const router = Router();

// How long reports are kept (see pruneSupportReports).
export const SUPPORT_REPORT_RETENTION_DAYS = 90;

const ROOM_ID = /^[A-Z0-9]{8}$/;

// One line of the client's recent log (client/src/remoteLog.js recentLogs()).
const LogLine = z.object({
  t:     z.string().max(40),
  level: z.enum(["info", "warn", "error"]),
  msg:   z.string().max(600),
  ctx:   z.record(z.string().max(50), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional(),
});

// Postgres rejects NUL characters in text and JSONB, so a report containing
// one would fail with a 500. They are removed from every string and key
// first. Anything nested deeper than MAX_DEPTH becomes null (the client's
// state summary is flat). Two keys that differ only by NULs would collapse
// into one, so that is an issue instead: {"note": …, "note\u0000": …} must be
// rejected like any unknown key, not quietly merged. The issue's path names
// the key, so a 400 says which one collided.
const MAX_DEPTH = 10;
function stripNul(value, ctx, path = []) {
  if (typeof value === "string") return value.replaceAll("\u0000", "");
  if (value === null || typeof value !== "object") return value;
  if (path.length >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((v, i) => stripNul(v, ctx, [...path, i]));
  const seen = new Set();
  const entries = Object.entries(value).map(([rawKey, v]) => {
    const k = rawKey.replaceAll("\u0000", "");
    if (seen.has(k)) {
      ctx.addIssue({ code: "custom", path: [...path, k], message: `Keys may not differ only by NUL characters: "${k}"` });
    }
    seen.add(k);
    return [k, stripNul(v, ctx, [...path, k])];
  });
  return Object.fromEntries(entries);
}

const SupportReportSchema = z.preprocess((value, ctx) => stripNul(value, ctx), z.object({
  note:   z.string().trim().min(1).max(2000),
  roomId: z.string().regex(ROOM_ID).optional(),
  page:   z.string().max(200).optional(),
  // The client's summary of what it showed (Game page __brade.state()).
  state:  z.record(z.string().max(50), z.unknown())
    .refine(o => Object.keys(o).length <= 40)
    .optional(),
  logs:   z.array(LogLine).max(50).optional(),
}).strict());

// The short ID shown to the player: the first 8 characters of the row's UUID.
export const shortReportId = (id) => id.slice(0, 8).toUpperCase();

// POST /api/support-reports — "Report a problem". Stores the player's note,
// what their client saw and, for a room that still exists, the server's
// own snapshot of it, and returns a short ID the player can quote. Works for
// signed-out players and guests too.
router.post("/", rateLimitSupportReport, optionalAuth, validate(SupportReportSchema),
  asyncHandler(async (req, res) => {
    const { note, roomId, page, state, logs } = req.body;
    const server = roomId ? await roomSnapshot(roomId) : null;
    const client = state || logs ? { state: state ?? null, logs: logs ?? [] } : null;
    const { rows: [row] } = await query(
      `INSERT INTO support_reports (user_id, is_guest, room_id, note, page, user_agent, client, server)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [req.userId ?? null, req.isGuest === true, roomId ?? null, note, page ?? null,
       req.get("user-agent")?.slice(0, 300) ?? null, client, server]
    );
    const reportId = shortReportId(row.id);
    log.info("Support report received", { reportId, userId: req.userId, roomId });
    return res.status(201).json({ reportId });
  }));

// Deletes reports older than the retention period. Run at startup.
export async function pruneSupportReports() {
  const { rowCount } = await query(
    `DELETE FROM support_reports WHERE created_at < now() - make_interval(days => $1)`,
    [SUPPORT_REPORT_RETENTION_DAYS]
  );
  if (rowCount) log.info("Old support reports deleted", { count: rowCount });
}

export default router;
