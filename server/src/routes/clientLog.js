import { Router } from "express";
import { z } from "zod";
import { optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { rateLimitClientLog } from "../middleware/ratelimit.js";
import { log } from "../log.js";

const router = Router();

// A few small scalar values describing what the client saw (close code,
// attempt number, component stack, ...). Kept flat and short so a client
// cannot write large blobs into the logs.
const ContextValue = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);

const ClientLogSchema = z.object({
  level:   z.enum(["info", "warn", "error"]),
  msg:     z.string().min(1).max(500),
  roomId:  z.string().regex(/^[A-Z0-9]{8}$/).optional(),
  page:    z.string().max(200).optional(),
  context: z.record(z.string().max(50), ContextValue)
    .refine(o => Object.keys(o).length <= 20)
    .optional(),
}).strict();

// POST /api/client-log — a client-side warning or error, written to the
// server log so a player's problem can be traced (see server/src/log.js).
// Signed-out players may send too; the userId is attached when the Bearer
// token is valid. The roomId is whatever the client says: a line without a
// userId may name any room, so treat its roomId as unverified.
router.post("/", rateLimitClientLog, optionalAuth, validate(ClientLogSchema), (req, res) => {
  const { level, msg, roomId, page, context } = req.body;
  log[level](`client: ${msg}`, {
    source:    "client",
    userId:    req.userId,
    guest:     req.isGuest || undefined,
    roomId,
    page,
    ctx:       context,
    userAgent: req.get("user-agent")?.slice(0, 200),
  });
  res.status(204).end();
});

export default router;
