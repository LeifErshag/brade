// ── server/src/db/postgres.js ─────────────────────────────────────────────────
import pg from "pg";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

let pool;

export async function connectPostgres() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Migration applied: ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration failed (${filename}): ${err.message}`);
    } finally {
      client.release();
    }
  }
}

// Parameterised query helper — never interpolate user input into SQL
export function query(text, params) {
  return pool.query(text, params);
}

export function getPool() { return pool; }
