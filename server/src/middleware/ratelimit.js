import rateLimit from "express-rate-limit";

// General API: 100 requests per minute per IP
export const rateLimitApi = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// Auth endpoints: 10 per minute per IP (prevent OAuth abuse)
export const rateLimitAuth = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts" },
});
