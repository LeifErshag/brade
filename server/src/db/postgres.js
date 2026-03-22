// ── server/src/db/postgres.js ─────────────────────────────────────────────────
import pg from "pg";
const { Pool } = pg;

let pool;

export async function connectPostgres() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("SELECT 1"); // verify connection
  console.log("PostgreSQL connected");
}

// Parameterised query helper — never interpolate user input into SQL
export function query(text, params) {
  return pool.query(text, params);
}

export function getPool() { return pool; }
