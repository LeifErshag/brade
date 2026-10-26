import { verifyAccessToken } from "../auth/tokens.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorised" });
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    if (payload.isGuest === true) req.isGuest = true;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Like requireAuth, but also rejects guest tokens. For endpoints that need a
// row in `users`: rated games, matchmaking, tournaments and profile routes.
export function requireUser(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.isGuest) return res.status(403).json({ error: "Forbidden" });
    return next();
  });
}

// Like requireAuth, but never rejects: sets req.userId (and req.isGuest) when
// a valid Bearer token is present, and passes the request on either way. For
// endpoints that must work for signed-out players too, e.g. error reports
// sent after a token has expired.
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      req.userId = payload.sub;
      if (payload.isGuest === true) req.isGuest = true;
    } catch {
      // Expired or invalid: treat the request as anonymous.
    }
  }
  return next();
}
