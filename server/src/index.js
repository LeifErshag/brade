import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
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
import clientLogRoutes    from "./routes/clientLog.js";
import supportReportRoutes, { pruneSupportReports } from "./routes/supportReports.js";
import { rateLimitApi } from "./middleware/ratelimit.js";
import { installProcessErrorHandlers } from "./processErrors.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { runStartup } from "./startup.js";
import { log } from "./log.js";

installProcessErrorHandlers();

const app = express();
const httpServer = createServer(app);

// Render.com (and most PaaS) sit behind a proxy — trust it so that
// express-rate-limit sees the real client IP and cookies get Secure flag right.
app.set("trust proxy", 1);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN,
  credentials: true,               // allow httpOnly cookies cross-origin
}));
app.use(cookieParser(process.env.COOKIE_SECRET));
// A problem report carries recent client log lines, so it gets a larger
// limit. Parsed first; the general parser then skips the parsed body.
app.use("/api/support-reports", express.json({ limit: "64kb" }));
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
app.use("/api/client-log",   clientLogRoutes);
app.use("/api/support-reports", supportReportRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── 404 & error handler ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler(log));

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  await connectPostgres();
  // Best effort: an old report left behind must not stop the server.
  await pruneSupportReports().catch(err => log.error("Support report cleanup failed", { err }));
  await connectRedis();
  initWebSocketServer(httpServer);

  const port = process.env.PORT || 3001;
  httpServer.listen(port, () => {
    log.info("Bräde server running", { port });
  });
}

runStartup(start);