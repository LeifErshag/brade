import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { signGuestToken } from "../auth/tokens.js";
import { validate } from "../middleware/validate.js";
import { GuestNameSchema } from "./guestName.js";

const router = Router();

const GuestSchema = z.object({
  displayName: GuestNameSchema.default("Guest"),
}).default({}); // older clients POST with no body


// POST /api/guest — issue a short-lived guest identity token.
// No authentication required — anyone with the invite link can call this.
router.post("/", validate(GuestSchema), (req, res) => {
  const guestId = uuid();
  const token   = signGuestToken(guestId, req.body.displayName);
  return res.json({ token, guestId });
});

export default router;
