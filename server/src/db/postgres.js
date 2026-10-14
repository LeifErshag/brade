// ── server/src/db/postgres.js ─────────────────────────────────────────────────
import pg from "pg";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

let pool;

// An idle client in the pool can error (e.g. Postgres restarts). pg emits that
// on the Pool; without a listener it becomes an uncaught exception and the
// process exits, dropping every live game. Log it instead: pg discards the
// broken client and the next query opens a fresh connection.
export function handlePoolError(err, logger = console) {
  logger.error("PostgreSQL idle client error:", err);
}

// Timeouts, so a hung database cannot stall a room forever: START_GAME and
// handleGameOver run their Postgres calls while holding the per-room lock
// (see ws/roomLock.js), and every later message for that room queues behind.
// - connectionTimeoutMillis: give up acquiring/opening a connection (also
//   bounds the startup connect) instead of waiting indefinitely.
// - statement_timeout: Postgres cancels any statement running longer. All app
//   queries are small indexed lookups/updates, so 20 s is far above normal.
//   Migrations may legitimately run longer and disable it for their own
//   transaction (see runMigrations).
// - query_timeout: node-postgres gives up on a query client-side after this
//   long. statement_timeout only helps while the server is reachable; if the
//   network hangs after a query was sent, no cancellation ever arrives and
//   the query would wait forever. Kept a little above statement_timeout so a
//   reachable server's own cancellation (a clearer error) normally wins.
export const POOL_TIMEOUTS = Object.freeze({
  connectionTimeoutMillis: 10_000,
  statement_timeout:       20_000,
  query_timeout:           25_000,
});

// Client-side timeout for a migration's own SQL. The pool's query_timeout
// would cut off a long migration whose statement_timeout is lifted, so the
// migration statement gets its own, much larger bound (node-postgres only
// accepts a truthy per-query value as an override, so it cannot be 0).
export const MIGRATION_QUERY_TIMEOUT = 60 * 60_000; // 1 h

export async function connectPostgres() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ...POOL_TIMEOUTS });
  pool.on("error", (err) => handlePoolError(err));
  await pool.query("SELECT 1"); // verify connection
  console.log("PostgreSQL connected");
  await runMigrations();
}

async function runMigrations() {
  // Ensure the tracking table exists before anything else
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const { rows } = await pool.query(
      "SELECT 1 FROM _migrations WHERE filename = $1", [filename]
    );
    if (rows.length) continue; // already applied

    const raw = await fs.readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
    const sql = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; // strip BOM if present
    const client = await pool.connect();
    let releaseErr;
    try {
      await client.query("BEGIN");
      // A migration on a large table (e.g. ALTER TABLE moves) can exceed the
      // pool's statement_timeout; lift it for this transaction only, and
      // raise the client-side timeout for the migration statement to match.
      await client.query("SET LOCAL statement_timeout = 0");
      await client.query({ text: sql, query_timeout: MIGRATION_QUERY_TIMEOUT });
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Migration applied: ${filename}`);
    } catch (err) {
      // After a client-side timeout the connection may still be busy with the
      // abandoned statement; discard it rather than return it to the pool.
      releaseErr = err;
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original error is the one worth reporting.
      }
      throw new Error(`Migration failed (${filename}): ${err.message}`);
    } finally {
      client.release(releaseErr);
    }
  }
}

// Parameterised query helper — never interpolate user input into SQL
export function query(text, params) {
  return pool.query(text, params);
}

export function getPool() { return pool; }
