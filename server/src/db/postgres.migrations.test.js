// Migration path of connectPostgres (issues #64, #69).
//
// Every migration file is reported as unapplied, so the full transaction path
// runs. A migration may legitimately run long: it lifts statement_timeout with
// SET LOCAL inside its transaction, and must not be cut off by the pool's
// client-side query_timeout either.
//
// The fake mirrors node-postgres timeout semantics: a client built by a Pool
// gets the pool's options; a query's effective client-side timeout is the
// per-query `query_timeout` if truthy, otherwise the client's
// connectionParameters.query_timeout at the time of the call.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const ONE_HOUR = 60 * 60 * 1000;

const pools = [];
const clients = [];
const queryLog = []; // { via, owner, text, effectiveTimeout }
// Optional hook: (text) => Error | null. A returned Error makes that query reject.
let failQuery = null;

function normalize(config, values) {
  if (typeof config === "string") return { text: config, values, perQuery: undefined };
  return { text: config?.text ?? "", values: config?.values ?? values, perQuery: config?.query_timeout };
}

function respond(text) {
  // Report every migration as unapplied (works for per-file lookups and for
  // "list all applied filenames" style queries alike).
  if (/^\s*select\b/i.test(text) && /_migrations/.test(text)) return { rows: [], rowCount: 0 };
  return { rows: [{ "?column?": 1 }], rowCount: 1 };
}

class FakeClient extends EventEmitter {
  constructor(opts = {}, pool = null) {
    super();
    this.opts = opts;
    this.pool = pool;
    this.connectionParameters = { query_timeout: opts.query_timeout ?? false };
    this.released = false;
    this.releasedWithTimeout = undefined;
    this.releaseArgs = undefined; // arguments of the release() call
    this.ended = false;
    clients.push(this);
  }
  async connect() {}
  async end() { this.released = true; this.ended = true; }
  release(...args) {
    this.releaseArgs = args;
    this.released = true;
    this.releasedWithTimeout = this.connectionParameters.query_timeout;
  }
  async query(config, values) {
    const q = normalize(config, values);
    queryLog.push({
      via: "client", owner: this, text: q.text,
      effectiveTimeout: q.perQuery || this.connectionParameters.query_timeout,
    });
    const err = failQuery?.(q.text);
    if (err) throw err;
    return respond(q.text);
  }
}

class FakePool extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    pools.push(this);
  }
  async connect() { return new FakeClient(this.opts, this); }
  async query(config, values) {
    const q = normalize(config, values);
    queryLog.push({
      via: "pool", owner: this, text: q.text,
      effectiveTimeout: q.perQuery || this.opts.query_timeout,
    });
    const err = failQuery?.(q.text);
    if (err) throw err;
    return respond(q.text);
  }
  async end() {}
}

jest.unstable_mockModule("pg", () => ({
  default: { Pool: FakePool, Client: FakeClient },
  Pool: FakePool,
  Client: FakeClient,
}));

const { connectPostgres, getPool } = await import("./postgres.js");

const squash = (s) => s.replace(new RegExp("^\uFEFF"), "").replace(/\s+/g, " ").trim().replace(/;$/, "");
const isSetLocalOff = (t) => /^set local statement_timeout\s*(=|to)\s*'?0'?$/i.test(squash(t));
const isBegin = (t) => /^begin( transaction| work)?$/i.test(squash(t));
const isCommit = (t) => /^commit( transaction| work)?$/i.test(squash(t));
const isEnd = (t) => /^(commit|rollback)\b/i.test(squash(t));

async function migrationFiles() {
  const names = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: squash(await fs.readFile(path.join(MIGRATIONS_DIR, name), "utf8")),
  })));
}

beforeEach(async () => {
  pools.length = 0;
  clients.length = 0;
  queryLog.length = 0;
  failQuery = null;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  await connectPostgres();
});
afterEach(() => jest.restoreAllMocks());

// The log entry that ran a migration file's SQL, plus the other entries
// issued on the same connection (with their global log positions).
function findMigration(sql) {
  const idx = queryLog.findIndex((e) => squash(e.text) === sql);
  if (idx === -1) return null;
  const entry = queryLog[idx];
  const sameConn = queryLog
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.owner === entry.owner);
  return { idx, entry, sameConn };
}

function mustFind(name, sql) {
  const m = findMigration(sql);
  expect({ name, found: m !== null }).toEqual({ name, found: true });
  return m;
}

test("applies every unapplied migration file in filename order", async () => {
  const files = await migrationFiles();
  expect(files.length).toBeGreaterThan(0);
  const positions = files.map(({ name, sql }) => mustFind(name, sql).idx);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
});

test("each migration runs on one connection as BEGIN, SET LOCAL statement_timeout = 0, migration SQL, COMMIT", async () => {
  for (const { name, sql } of await migrationFiles()) {
    const m = mustFind(name, sql);
    // A transaction needs a single checked-out connection, not pool.query.
    expect({ name, via: m.entry.via }).toEqual({ name, via: "client" });

    const before = m.sameConn.filter((e) => e.i < m.idx);
    const after = m.sameConn.filter((e) => e.i > m.idx);
    const beginAt = before.filter((e) => isBegin(e.text)).map((e) => e.i).pop();
    expect({ name, begin: beginAt !== undefined }).toEqual({ name, begin: true });
    const inTx = before.filter((e) => e.i > beginAt);
    expect({ name, endedEarly: inTx.some((e) => isEnd(e.text)) }).toEqual({ name, endedEarly: false });
    expect({ name, setLocal: inTx.filter((e) => isSetLocalOff(e.text)).length })
      .toEqual({ name, setLocal: 1 });
    const commitAt = after.find((e) => isEnd(e.text));
    expect({ name, commit: commitAt !== undefined && isCommit(commitAt.text) })
      .toEqual({ name, commit: true });

    // The connection is handed back afterwards.
    expect({ name, released: m.entry.owner.released }).toEqual({ name, released: true });
  }
});

test("migration SQL is not subject to the pool's client-side query_timeout", async () => {
  // Precondition: the app pool does have a finite client-side timeout (#69).
  const appTimeout = getPool().opts?.query_timeout;
  expect(typeof appTimeout).toBe("number");
  expect(Number.isFinite(appTimeout)).toBe(true);
  expect(appTimeout).toBeGreaterThan(0);

  for (const { name, sql } of await migrationFiles()) {
    const t = mustFind(name, sql).entry.effectiveTimeout;
    const unbounded = !t || t >= ONE_HOUR;
    expect({ name, effectiveTimeout: t, unbounded }).toEqual({ name, effectiveTimeout: t, unbounded: true });
  }
});

test("connections returned to the app pool keep its client-side query_timeout", async () => {
  const pool = getPool();
  const appTimeout = pool.opts?.query_timeout;
  expect(typeof appTimeout).toBe("number");
  expect(Number.isFinite(appTimeout)).toBe(true);
  // A pooled connection whose timeout was lifted for a migration must not be
  // handed back to the app with the timeout still disabled.
  for (const c of clients.filter((c) => c.pool === pool && c.released)) {
    expect(c.releasedWithTimeout).toBe(appTimeout);
  }
});

test("a failing migration rejects with its filename and original error, and discards the connection", async () => {
  const [first] = await migrationFiles();
  pools.length = 0;
  clients.length = 0;
  queryLog.length = 0;
  // The migration SQL times out client-side, and the connection is then too
  // broken for ROLLBACK to succeed either.
  failQuery = (text) => {
    if (squash(text) === first.sql) return new Error("Query read timeout");
    if (/^rollback\b/i.test(squash(text))) return new Error("Connection terminated unexpectedly");
    return null;
  };

  const outcome = await connectPostgres().then(
    () => ({ rejected: false, message: "" }),
    (err) => ({ rejected: true, message: String(err?.message ?? err) }),
  );
  expect(outcome.rejected).toBe(true);
  expect(outcome.message).toContain(first.name);
  expect(outcome.message).toContain("Query read timeout");
  // The ROLLBACK failure must not replace the original error.
  expect(outcome.message).not.toContain("Connection terminated unexpectedly");

  // The connection that ran the failing SQL is not handed back as healthy:
  // a pooled client is released with a truthy error (so pg destroys it); a
  // standalone client is ended.
  const m = findMigration(first.sql);
  expect(m).not.toBeNull();
  const conn = m.entry.owner;
  expect(conn).toBeInstanceOf(FakeClient);
  expect(conn.released).toBe(true);
  if (conn.pool) {
    expect(conn.releaseArgs).toBeDefined();
    expect(conn.releaseArgs[0]).toBeTruthy();
  } else {
    expect(conn.ended || Boolean(conn.releaseArgs?.[0])).toBe(true);
  }
});
