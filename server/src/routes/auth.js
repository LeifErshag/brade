import { Router } from "express";
import passport from "../auth/passport.js";
import {
  signAccessToken, signRefreshToken,
  storeRefreshToken, revokeRefreshToken,
  isRefreshTokenValid, verifyRefreshToken,
  setRefreshCookie, clearRefreshCookie,
} from "../auth/tokens.js";
import { rateLimitAuth } from "../middleware/ratelimit.js";

const router = Router();
const CLIENT = process.env.CLIENT_ORIGIN;

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get("/google",
  rateLimitAuth,
  passport.authenticate("google", { scope: ["profile"], session: false })
);
router.get("/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: `${CLIENT}/?error=auth` }),
  issueTokens
);

// ── GitHub OAuth ──────────────────────────────────────────────────────────────
router.get("/github",
  rateLimitAuth,
  passport.authenticate("github", { scope: ["read:user"], session: false })
);
router.get("/github/callback",
  passport.authenticate("github", { session: false, failureRedirect: `${CLIENT}/?error=auth` }),
  issueTokens
);

// ── Refresh access token ──────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const token = req.signedCookies?.refresh_token;
  if (!token) return res.status(401).json({ error: "No refresh token" });
  try {
    const payload = verifyRefreshToken(token);
    const userId  = payload.sub;
    const valid   = await isRefreshTokenValid(userId, token);
    if (!valid) return res.status(401).json({ error: "Invalid refresh token" });
    const accessToken = signAccessToken(userId);
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const token = req.signedCookies?.refresh_token;
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await revokeRefreshToken(payload.sub); // invalidate in Redis
    } catch { /* token already invalid — fine */ }
  }
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

// ── Shared token issuance after OAuth callback ────────────────────────────────
async function issueTokens(req, res) {
  const user         = req.user;
  const accessToken  = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);
  // Redirect to client with access token in URL fragment (never in query string)
  res.redirect(`${CLIENT}/auth/callback#token=${accessToken}`);
}

export default router;