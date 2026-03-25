import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import { createServer } from "http";
import { initWebSocketServer } from "./ws/server.js";
import { connectRedis } from "./db/redis.js";
import { connectPostgres } from "./db/postgres.js";
import authRoutes        from "./routes/auth.js";
import gameRoutes        from "./routes/games.js";
import userRoutes        from "./routes/users.js";
import guestRoutes       from "./routes/guest.js";
import matchmakingRoutes  from "./routes/matchmaking.js";
import tournamentRoutes   from "./routes/tournaments.js";
import { rateLimitApi } from "./middleware/ratelimit.js";

const app = express();
const httpServer = createServer(app);

// Render.com (and most PaaS) sit behind a proxy — trust it so that
// express-rate-limit sees the real client IP and cookies get Secure flag right.
app.set("trust proxy", 1);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
// passport-oauth2 needs a session to store & verify the OAuth state parameter
// (CSRF protection).  We only use it for the brief OAuth redirect/callback flow;
// persistent auth is handled by JWT + httpOnly refresh-token cookie.
app.use(session({
  secret: process.env.COOKIE_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 5 * 60 * 1000 },
}));
app.use(cors({
  origin: process.env.CLIENT_ORIGIN,
  credentials: true,               // allow httpOnly cookies cross-origin
}));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: "10kb" })); // limit body size

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use("/api/", rateLimitApi);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/users", userRoutes);
app.use("/api/guest", guestRoutes);
app.use("/api/matchmaking",  matchmakingRoutes);
app.use("/api/tournaments",  tournamentRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── 404 & error handler ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  // Never leak stack traces to client
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  await connectPostgres();
  await connectRedis();
  initWebSocketServer(httpServer);

  const port = process.env.PORT || 3001;
  httpServer.listen(port, () => {
    console.log(`Bräde server running on port ${port}`);
  });
}

start();