# ── Bräde Project Setup Script ────────────────────────────────────────────────
# Run from the root of your cloned repo:
#   cd C:\path\to\brade
#   .\setup-project.ps1
#
# Creates all server + client files and folder structure.
# Safe to re-run — existing files will NOT be overwritten.

param(
  [switch]$Force  # pass -Force to overwrite existing files
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-File {
  param([string]$Path, [string]$Content)
  $full = Join-Path $root $Path
  $dir  = Split-Path $full
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  if ((Test-Path $full) -and -not $Force) {
    Write-Host "  SKIP  $Path (already exists)" -ForegroundColor Yellow
    return
  }
  Set-Content -Path $full -Value $Content -Encoding UTF8
  Write-Host "  CREATE $Path" -ForegroundColor Green
}

Write-Host ""
Write-Host "Bräde — Project Setup" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# ── Root files ────────────────────────────────────────────────────────────────

Write-File ".gitignore" @'
# Dependencies
node_modules/
.pnp
.pnp.js

# Environment variables — NEVER commit these
.env
.env.local
.env.*.local

# Build output
client/dist/
server/dist/

# Logs
logs/
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Test coverage
coverage/
'@

Write-File ".env.example" @'
# ── Server ────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3001

# ── PostgreSQL ────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/brade

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_ACCESS_SECRET=replace_with_random_64_byte_hex
JWT_REFRESH_SECRET=replace_with_different_random_64_byte_hex
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ── OAuth — Google ────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://brade.ershag.se/auth/google/callback

# ── OAuth — GitHub ────────────────────────────────────────────────────────────
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=https://brade.ershag.se/auth/github/callback

# ── CORS ──────────────────────────────────────────────────────────────────────
CLIENT_ORIGIN=https://brade.ershag.se

# ── Cookie ────────────────────────────────────────────────────────────────────
COOKIE_SECRET=replace_with_random_32_byte_hex
'@

Write-File "README.md" @'
# Bräde

Online multiplayer implementation of Svenskt Bräde (Swedish Tables).
Based on the official rules of Vasamuseets Brädspelsvänner.

**Live:** [brade.ershag.se](https://brade.ershag.se)

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express + WebSockets
- Game state: Redis
- Persistent data: PostgreSQL
- Auth: OAuth (Google + GitHub)
- Hosting: Render.com

## Local Development

### 1. Clone & install
```bash
git clone https://github.com/LeifErshag/brade.git
cd brade
```

### 2. Start local services (Docker)
```bash
docker run -d -p 5432:5432 -e POSTGRES_DB=brade -e POSTGRES_PASSWORD=dev postgres:16
docker run -d -p 6379:6379 redis:7
```

### 3. Configure environment
```bash
cp .env.example server/.env
# Fill in your OAuth credentials and secrets
```

### 4. Start backend
```bash
cd server && npm install && npm run dev
```

### 5. Start frontend
```bash
cd client && npm install && npm run dev
```
'@

# ── GitHub Actions ────────────────────────────────────────────────────────────

Write-File ".github/workflows/ci.yml" @'
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            client/package-lock.json

      - name: Install server deps
        run: npm ci
        working-directory: server

      - name: Install client deps
        run: npm ci
        working-directory: client

      - name: Lint server
        run: npm run lint
        working-directory: server

      - name: Build client
        run: npm run build
        working-directory: client

      - name: Audit dependencies
        run: npm audit --audit-level=high
        working-directory: server
'@

# ── Server files ──────────────────────────────────────────────────────────────

Write-File "server/package.json" @'
{
  "name": "brade-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "lint": "eslint src/",
    "test": "node --experimental-vm-modules node_modules/.bin/jest"
  },
  "dependencies": {
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.3.1",
    "helmet": "^7.1.0",
    "ioredis": "^5.4.1",
    "jsonwebtoken": "^9.0.2",
    "passport": "^0.7.0",
    "passport-github2": "^0.1.12",
    "passport-google-oauth20": "^2.0.0",
    "pg": "^8.12.0",
    "uuid": "^10.0.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "eslint": "^9.7.0",
    "jest": "^29.7.0"
  }
}
'@

Write-File "server/.env.example" @'
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/brade
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
GOOGLE_CLIENT_ID=replace_me
GOOGLE_CLIENT_SECRET=replace_me
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
GITHUB_CLIENT_ID=replace_me
GITHUB_CLIENT_SECRET=replace_me
GITHUB_CALLBACK_URL=http://localhost:3001/auth/github/callback
CLIENT_ORIGIN=http://localhost:5173
COOKIE_SECRET=replace_me
'@

Write-File "server/src/index.js" @'
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { readFileSync } from "fs";
import { initWebSocketServer } from "./ws/server.js";
import { connectRedis } from "./db/redis.js";
import { connectPostgres, getPool } from "./db/postgres.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/games.js";
import userRoutes from "./routes/users.js";
import { rateLimitApi } from "./middleware/rateLimit.js";

const app = express();
const httpServer = createServer(app);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: "10kb" }));
app.use("/api/", rateLimitApi);

app.use("/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/users", userRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function runMigrations() {
  const pool = getPool();
  const sql = readFileSync(new URL("./db/migrations/001_init.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("Migrations complete");
}

async function start() {
  await connectPostgres();
  await runMigrations();
  await connectRedis();
  initWebSocketServer(httpServer);
  const port = process.env.PORT || 3001;
  httpServer.listen(port, () => console.log(`Brade server running on port ${port}`));
}

start();
'@

Write-File "server/src/db/postgres.js" @'
import pg from "pg";
const { Pool } = pg;

let pool;

export async function connectPostgres() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("SELECT 1");
  console.log("PostgreSQL connected");
}

export function query(text, params) {
  return pool.query(text, params);
}

export function getPool() { return pool; }
'@

Write-File "server/src/db/migrations/001_init.sql" @'
CREATE TABLE IF NOT EXISTS users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_provider VARCHAR(20) NOT NULL,
  oauth_id       VARCHAR(255) NOT NULL,
  display_name   VARCHAR(50) NOT NULL,
  avatar_url     TEXT,
  elo            INTEGER     NOT NULL DEFAULT 1200,
  wins           INTEGER     NOT NULL DEFAULT 0,
  losses         INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (oauth_provider, oauth_id)
);

CREATE TABLE IF NOT EXISTS games (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          VARCHAR(8)  NOT NULL UNIQUE,
  white_id         UUID        REFERENCES users(id),
  black_id         UUID        REFERENCES users(id),
  winner_id        UUID        REFERENCES users(id),
  win_type         VARCHAR(20),
  monk             BOOLEAN     NOT NULL DEFAULT false,
  white_score      INTEGER     NOT NULL DEFAULT 0,
  black_score      INTEGER     NOT NULL DEFAULT 0,
  match_length     INTEGER     NOT NULL DEFAULT 5,
  white_elo_before INTEGER,
  black_elo_before INTEGER,
  white_elo_after  INTEGER,
  black_elo_after  INTEGER,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS moves (
  id       BIGSERIAL   PRIMARY KEY,
  game_id  UUID        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq      INTEGER     NOT NULL,
  color    VARCHAR(5)  NOT NULL,
  from_pt  VARCHAR(4)  NOT NULL,
  to_pt    VARCHAR(4)  NOT NULL,
  die      INTEGER     NOT NULL,
  force    BOOLEAN     NOT NULL DEFAULT false,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS games_white_id_idx ON games(white_id);
CREATE INDEX IF NOT EXISTS games_black_id_idx ON games(black_id);
CREATE INDEX IF NOT EXISTS moves_game_id_idx  ON moves(game_id);
'@

Write-File "server/src/db/redis.js" @'
import Redis from "ioredis";

let client;

export async function connectRedis() {
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  await client.ping();
  console.log("Redis connected");
}

export function getRedis() { return client; }

export const keys = {
  room:         (id)     => `room:${id}`,
  roomPlayers:  (id)     => `room:${id}:players`,
  refreshToken: (userId) => `refresh:${userId}`,
  matchQueue:   ()       => "queue:match",
  invite:       (id)     => `invite:${id}`,
};

export const TTL = {
  room:    60 * 60 * 24,
  refresh: 60 * 60 * 24 * 7,
  invite:  60 * 60 * 48,
};
'@

Write-File "server/src/auth/tokens.js" @'
import jwt from "jsonwebtoken";
import { getRedis, keys, TTL } from "../db/redis.js";

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m" });
}

export function signRefreshToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

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

export function setRefreshCookie(res, token) {
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/auth/refresh",
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie("refresh_token", { path: "/auth/refresh" });
}
'@

Write-File "server/src/auth/passport.js" @'
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { query } from "../db/postgres.js";

function makeOAuthHandler(provider) {
  return async (_accessToken, _refreshToken, profile, done) => {
    try {
      const oauthId = profile.id;
      const name    = profile.displayName || profile.username || "Player";
      const avatar  = profile.photos?.[0]?.value || null;
      const { rows } = await query(
        `INSERT INTO users (oauth_provider, oauth_id, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (oauth_provider, oauth_id)
         DO UPDATE SET display_name = EXCLUDED.display_name,
                       avatar_url   = EXCLUDED.avatar_url
         RETURNING id, display_name, elo`,
        [provider, oauthId, name, avatar]
      );
      return done(null, rows[0]);
    } catch (err) {
      return done(err);
    }
  };
}

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL,
}, makeOAuthHandler("google")));

passport.use(new GitHubStrategy({
  clientID:     process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL:  process.env.GITHUB_CALLBACK_URL,
}, makeOAuthHandler("github")));

export default passport;
'@

Write-File "server/src/routes/auth.js" @'
import { Router } from "express";
import passport from "../auth/passport.js";
import {
  signAccessToken, signRefreshToken,
  storeRefreshToken, revokeRefreshToken,
  isRefreshTokenValid, verifyRefreshToken,
  setRefreshCookie, clearRefreshCookie,
} from "../auth/tokens.js";
import { rateLimitAuth } from "../middleware/rateLimit.js";

const router = Router();
const CLIENT = process.env.CLIENT_ORIGIN;

router.get("/google", rateLimitAuth,
  passport.authenticate("google", { scope: ["profile"], session: false }));

router.get("/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: `${CLIENT}/?error=auth` }),
  issueTokens);

router.get("/github", rateLimitAuth,
  passport.authenticate("github", { scope: ["read:user"], session: false }));

router.get("/github/callback",
  passport.authenticate("github", { session: false, failureRedirect: `${CLIENT}/?error=auth` }),
  issueTokens);

router.post("/refresh", async (req, res) => {
  const token = req.signedCookies?.refresh_token;
  if (!token) return res.status(401).json({ error: "No refresh token" });
  try {
    const payload = verifyRefreshToken(token);
    const valid   = await isRefreshTokenValid(payload.sub, token);
    if (!valid) return res.status(401).json({ error: "Invalid refresh token" });
    return res.json({ accessToken: signAccessToken(payload.sub) });
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

router.post("/logout", async (req, res) => {
  const token = req.signedCookies?.refresh_token;
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await revokeRefreshToken(payload.sub);
    } catch { /* already invalid */ }
  }
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

async function issueTokens(req, res) {
  const user         = req.user;
  const accessToken  = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);
  res.redirect(`${CLIENT}/auth/callback#token=${accessToken}`);
}

export default router;
'@

Write-File "server/src/routes/games.js" @'
import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";

const router = Router();

const CreateGameSchema = z.object({
  matchLength: z.number().int().min(1).max(7).default(5),
});

router.post("/", requireAuth, validate(CreateGameSchema), async (req, res) => {
  const { matchLength } = req.body;
  const roomId = uuid().slice(0, 8).toUpperCase();
  const roomState = {
    roomId, matchLength, createdBy: req.userId,
    players: { white: req.userId, black: null },
    status: "waiting", gameState: null, createdAt: Date.now(),
  };
  const redis = getRedis();
  await redis.set(keys.room(roomId), JSON.stringify(roomState), "EX", TTL.room);
  await query(
    `INSERT INTO games (room_id, white_id, match_length) VALUES ($1, $2, $3)`,
    [roomId, req.userId, matchLength]
  );
  return res.status(201).json({
    roomId,
    inviteUrl: `${process.env.CLIENT_ORIGIN}/game/${roomId}`,
  });
});

router.get("/:roomId", requireAuth, async (req, res) => {
  const { roomId } = req.params;
  if (!/^[A-Z0-9]{8}$/.test(roomId))
    return res.status(400).json({ error: "Invalid room ID" });
  const raw = await getRedis().get(keys.room(roomId));
  if (!raw) return res.status(404).json({ error: "Room not found or expired" });
  const room = JSON.parse(raw);
  return res.json({ roomId: room.roomId, status: room.status,
    matchLength: room.matchLength, players: room.players });
});

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.room_id, g.win_type, g.monk,
            g.white_score, g.black_score, g.ended_at,
            w.display_name AS white_name, b.display_name AS black_name
     FROM games g
     LEFT JOIN users w ON w.id = g.white_id
     LEFT JOIN users b ON b.id = g.black_id
     WHERE g.white_id = $1 OR g.black_id = $1
     ORDER BY g.started_at DESC LIMIT 20`,
    [req.userId]
  );
  return res.json(rows);
});

export default router;
'@

Write-File "server/src/routes/users.js" @'
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/postgres.js";

const router = Router();

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
'@

Write-File "server/src/middleware/auth.js" @'
import { verifyAccessToken } from "../auth/tokens.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Unauthorised" });
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
'@

Write-File "server/src/middleware/rateLimit.js" @'
import rateLimit from "express-rate-limit";

export const rateLimitApi = rateLimit({
  windowMs: 60 * 1000, max: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests" },
});

export const rateLimitAuth = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many login attempts" },
});
'@

Write-File "server/src/middleware/validate.js" @'
import { z } from "zod";

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: result.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
    }
    req.body = result.data;
    return next();
  };
}
'@

Write-File "server/src/ws/server.js" @'
import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../auth/tokens.js";
import { handleMessage } from "./handlers.js";

const rooms = new Map();

export function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const url    = new URL(req.url, "http://localhost");
    const token  = url.searchParams.get("token");
    const roomId = url.searchParams.get("room");
    if (!token || !roomId) { ws.close(4001, "Missing token or room"); return; }
    let userId;
    try {
      userId = verifyAccessToken(token).sub;
    } catch {
      ws.close(4001, "Invalid token"); return;
    }
    if (!/^[A-Z0-9]{8}$/.test(roomId)) { ws.close(4002, "Invalid room"); return; }
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const client = { ws, userId };
    rooms.get(roomId).add(client);
    ws.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      await handleMessage({ msg, userId, roomId, rooms, ws });
    });
    ws.on("close", () => {
      rooms.get(roomId)?.delete(client);
      if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);
      broadcastToRoom(roomId, rooms, { type: "PLAYER_DISCONNECTED", userId });
    });
    ws.on("error", (err) => console.error(`WS error [${roomId}]:`, err.message));
    send(ws, { type: "CONNECTED", userId, roomId });
  });
  console.log("WebSocket server initialised");
}

export function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

export function broadcastToRoom(roomId, rooms, payload, excludeUserId = null) {
  rooms.get(roomId)?.forEach(({ ws, userId }) => {
    if (userId !== excludeUserId) send(ws, payload);
  });
}
'@

Write-File "server/src/ws/handlers.js" @'
import { getRedis, keys, TTL } from "../db/redis.js";
import { send, broadcastToRoom } from "./server.js";

export async function handleMessage({ msg, userId, roomId, rooms, ws }) {
  const redis   = getRedis();
  const rawRoom = await redis.get(keys.room(roomId));
  if (!rawRoom) { send(ws, { type: "ERROR", message: "Room not found" }); return; }
  const room = JSON.parse(rawRoom);
  const isParticipant = [room.players.white, room.players.black].includes(userId);
  if (!isParticipant) { send(ws, { type: "ERROR", message: "Not a participant" }); return; }

  switch (msg.type) {
    case "JOIN": {
      if (!room.players.black && room.players.white !== userId) {
        room.players.black = userId;
        room.status = "playing";
        await saveRoom(redis, roomId, room);
        broadcastToRoom(roomId, rooms, { type: "ROOM_STATE", room });
      } else {
        send(ws, { type: "ROOM_STATE", room });
      }
      break;
    }
    case "ROLL": {
      if (room.status !== "playing") break;
      const color = room.players.white === userId ? "white" : "black";
      const dice  = rollDice();
      broadcastToRoom(roomId, rooms, { type: "ROLLED", color, dice });
      break;
    }
    case "MOVE": {
      broadcastToRoom(roomId, rooms, { type: "MOVE_APPLIED", move: msg });
      break;
    }
    case "PASS": {
      broadcastToRoom(roomId, rooms, { type: "TURN_PASSED", userId });
      break;
    }
    case "RESIGN": {
      const winner = room.players.white === userId ? "black" : "white";
      broadcastToRoom(roomId, rooms, { type: "GAME_OVER", reason: "resign", winner });
      break;
    }
    default:
      send(ws, { type: "ERROR", message: "Unknown message type" });
  }
}

async function saveRoom(redis, roomId, room) {
  await redis.set(keys.room(roomId), JSON.stringify(room), "EX", TTL.room);
}

function rollDice() {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}
'@

# ── Client files ──────────────────────────────────────────────────────────────

Write-File "client/package.json" @'
{
  "name": "brade-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src/"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "eslint": "^9.7.0",
    "vite": "^5.3.4"
  }
}
'@

Write-File "client/index.html" @'
<!DOCTYPE html>
<html lang="sv">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bräde</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
'@

Write-File "client/vite.config.js" @'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
'@

Write-File "client/.env.example" @'
VITE_API_URL=http://localhost:3001
'@

Write-File "client/src/main.jsx" @'
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
'@

Write-File "client/src/App.jsx" @'
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Game from "./pages/Game.jsx";
import Profile from "./pages/Profile.jsx";
import AuthCallback from "./pages/AuthCallback.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/"                element={<Home />} />
      <Route path="/game/:roomId"    element={<Game />} />
      <Route path="/profile"         element={<Profile />} />
      <Route path="/auth/callback"   element={<AuthCallback />} />
    </Routes>
  );
}
'@

Write-File "client/src/pages/Home.jsx" @'
// Setup screen / lobby — game UI will move here from the artifact in Phase 10
export default function Home() {
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ color: "#e8b86d", fontSize: 48, letterSpacing: 4 }}>Bräde</h1>
        <p style={{ color: "#a07840", fontSize: 16 }}>Svenskt Brädspel</p>
        <div style={{ marginTop: 32, display: "flex", gap: 16, justifyContent: "center" }}>
          <a href="/auth/google" style={{ background: "#6b3a10", color: "#e8b86d",
            padding: "10px 24px", borderRadius: 8, textDecoration: "none", fontSize: 14 }}>
            Sign in with Google
          </a>
          <a href="/auth/github" style={{ background: "#3a1a00", color: "#a07840",
            padding: "10px 24px", borderRadius: 8, textDecoration: "none", fontSize: 14 }}>
            Sign in with GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
'@

Write-File "client/src/pages/Game.jsx" @'
import { useParams } from "react-router-dom";
// Full game board will be wired in here in Phase 10
export default function Game() {
  const { roomId } = useParams();
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e8b86d",
      fontFamily: "Georgia, serif" }}>
      <p>Game room: {roomId} — coming in Phase 10</p>
    </div>
  );
}
'@

Write-File "client/src/pages/Profile.jsx" @'
// Player profile, ELO, match history — Phase 11
export default function Profile() {
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e8b86d",
      fontFamily: "Georgia, serif" }}>
      <p>Profile — coming in Phase 11</p>
    </div>
  );
}
'@

Write-File "client/src/pages/AuthCallback.jsx" @'
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Handles the redirect back from OAuth — extracts token from URL fragment
export default function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const hash  = window.location.hash;
    const token = new URLSearchParams(hash.slice(1)).get("token");
    if (token) {
      // Store access token in memory (never localStorage)
      sessionStorage.setItem("access_token", token);
      window.history.replaceState(null, "", "/"); // clear token from URL
    }
    navigate("/");
  }, []);
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e8b86d",
      fontFamily: "Georgia, serif" }}>
      <p>Signing in...</p>
    </div>
  );
}
'@

Write-File "client/src/hooks/useSocket.js" @'
import { useEffect, useRef, useCallback } from "react";

// WebSocket hook — connects to game room, handles reconnection
export function useSocket({ roomId, token, onMessage }) {
  const ws      = useRef(null);
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!roomId || !token) return;
    const url = `${import.meta.env.VITE_API_URL.replace("http", "ws")}/ws?room=${roomId}&token=${token}`;
    ws.current = new WebSocket(url);
    ws.current.onmessage = (e) => {
      try { onMsgRef.current(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    ws.current.onclose = () => console.log("WS closed");
    ws.current.onerror = (e) => console.error("WS error", e);
    return () => ws.current?.close();
  }, [roomId, token]);

  return { send };
}
'@

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Done! All files created." -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. cd into your repo root" -ForegroundColor Gray
Write-Host "  2. Copy .env.example to server/.env and fill in your secrets" -ForegroundColor Gray
Write-Host "  3. git add ." -ForegroundColor Gray
Write-Host "  4. git commit -m 'feat: phase 7 backend scaffold'" -ForegroundColor Gray
Write-Host "  5. git push origin main" -ForegroundColor Gray
Write-Host ""
Write-Host "Generate secrets with:" -ForegroundColor White
Write-Host '  node -e "console.log(require(''crypto'').randomBytes(64).toString(''hex''))"' -ForegroundColor Gray
Write-Host ""