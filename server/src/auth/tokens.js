import jwt from "jsonwebtoken";
import { getRedis, keys, TTL } from "../db/redis.js";

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m",
  });
}

export function signRefreshToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d",
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

// Store refresh token in Redis so we can invalidate it on logout
export async function storeRefreshToken(userId, token) {
  const redis = getRedis();
  await redis.set(keys.refreshToken(userId), token, "EX", TTL.refresh);
}

export async function revokeRefreshToken(userId) {
  const redis = getRedis();
  await redis.del(keys.refreshToken(userId));
}

export async function isRefreshTokenValid(userId, token) {
  const redis = getRedis();
  const stored = await redis.get(keys.refreshToken(userId));
  return stored === token;
}

// Set refresh token as httpOnly cookie — never accessible to JS
export function setRefreshCookie(res, token) {
  // Client (brade.ershag.se) and server (*.onrender.com) are cross-site, so
  // SameSite=none is required.  Secure=true is enforced in production.
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days ms
    path: "/auth/refresh",            // only sent to refresh endpoint
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie("refresh_token", { path: "/auth/refresh" });
}
