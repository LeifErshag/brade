import { Router } from "express";
import { v4 as uuid } from "uuid";
import { signGuestToken } from "../auth/tokens.js";

const router = Router();

// POST /api/guest — issue a short-lived guest identity token.
// No authentication required — anyone with the invite link can call this.
router.post("/", (req, res) => {
  const guestId = uuid();
  const token   = signGuestToken(guestId, "Guest");
  return res.json({ token, guestId });
});

export default router;
