// Client-side query timeout (issue #69): the app pool bounds every query with
// node-postgres' query_timeout, while migrations (which lift statement_timeout)
// must not be cut off by it. Unlike postgres.test.js, every migration here
// looks unapplied, so the pool.connect() migration path actually runs.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const log = []; // { conn, text, timeout } in call order

// Same rule as node-postgres: a truthy per-query value wins, otherwise the
// connection's query_timeout at call time.
function effectiveTimeout(config, fallback) {
  return (typeof config === "object" && config.query_timeout) || fallback;
}
function textOf(config) {
  return typeof config === "string" ? config : config.text;
}
function result(text) {
  return /^\s*SELECT/i.test(text) && text.includes("_migrations") ? { rows: [] } : { rows: [{ x: 1 }] };
}

let connSeq = 0;
class FakeClient {
  constructor(opts = {}) {
    this.id = ++connSeq;
    this.connectionParameters = { query_timeout: opts.query_timeout || false };
    this.released = false;
    this.releasedTimeout = undefined;
  }
  async connect() {}
  async query(config) {
    const text = textOf(config);
    log.push({ conn: this.id, text, timeout: effectiveTimeout(config, this.connectionParameters.query_timeout) });
    return result(text);
  }
  release() {
    this.released = true;
    this.releasedTimeout = this.connectionParameters.query_timeout;
  }
  async end() { this.released = true; }
}

let lastPool;
class FakePool extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.clients = [];
    lastPool = this;
  }
  async query(config) {
    const text = textOf(config);
    log.push({ conn: "pool", text, timeout: effectiveTimeout(config, this.opts.query_timeout) });
    return result(text);
  }
  async connect() {
    const c = new FakeClient(this.opts);
    this.clients.push(c);
    return c;
  }
  async end() {}
}

jest.unstable_mockModule("pg", () => ({
  default: { Pool: FakePool, Client: FakeClient },
  Pool: FakePool,
  Client: FakeClient,
}));

const { connectPostgres, getPool, POOL_TIMEOUTS } = await import("./postgres.js");

const norm = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s).replace(/\s+/g, " ").trim().replace(/;$/, "").trim();

beforeEach(() => {
  log.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("the pool sets a finite query_timeout above statement_timeout", async () => {
  await connectPostgres();
  const { query_timeout, statement_timeout } = getPool().opts;
  expect(Number.isFinite(query_timeout)).toBe(true);
  expect(query_timeout).toBeGreaterThan(statement_timeout);
  expect(query_timeout).toBeLessThanOrEqual(120_000);
  expect(POOL_TIMEOUTS.query_timeout).toBe(query_timeout);
});

test("each migration runs on one client with statement_timeout lifted and no short client timeout", async () => {
  await connectPostgres();
  const pool = getPool();
  expect(pool).toBe(lastPool);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  expect(files.length).toBeGreaterThan(0);

  let searchFrom = 0;
  for (const file of files) {
    const sql = norm(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    const idx = log.findIndex((e, i) => i >= searchFrom && norm(e.text) === sql);
    expect(idx).toBeGreaterThanOrEqual(0);
    const entry = log[idx];
    expect(entry.conn).not.toBe("pool");
    expect(!entry.timeout || entry.timeout >= 3_600_000).toBe(true);

    const onConn = log.filter((e) => e.conn === entry.conn).map((e) => norm(e.text));
    expect(onConn[0]).toBe("BEGIN");
    expect(onConn.filter((t) => /^SET LOCAL statement_timeout = 0$/i.test(t))).toHaveLength(1);
    const setIdx = onConn.findIndex((t) => /^SET LOCAL statement_timeout/i.test(t));
    const sqlIdx = onConn.indexOf(sql);
    expect(setIdx).toBeLessThan(sqlIdx);
    expect(onConn[onConn.length - 1]).toBe("COMMIT");
    searchFrom = idx + 1;
  }

  for (const c of pool.clients) {
    expect(c.released).toBe(true);
    expect(c.releasedTimeout).toBe(pool.opts.query_timeout);
  }
  // The app pool still bounds its own queries.
  for (const e of log.filter((x) => x.conn === "pool")) {
    expect(e.timeout).toBe(pool.opts.query_timeout);
  }
});
