// An idle-client error emitted on the pg Pool must be logged, not left without
// a listener (which would crash the process with an uncaught exception).

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

class FakePool extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    // Every query succeeds; migrations look already applied.
    this.query = jest.fn(async () => ({ rows: [{ "?column?": 1 }] }));
  }
}

jest.unstable_mockModule("pg", () => ({ default: { Pool: FakePool } }));

const { connectPostgres, getPool } = await import("./postgres.js");

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("connectPostgres attaches an error listener to the pool", async () => {
  await connectPostgres();
  const pool = getPool();
  expect(pool.listenerCount("error")).toBe(1);

  const err = new Error("terminating connection due to administrator command");
  // Without a listener, EventEmitter would throw this error synchronously.
  expect(() => pool.emit("error", err, {})).not.toThrow();
  expect(errorSpy).toHaveBeenCalledWith("PostgreSQL idle client error:", err);
});

// ── Pool timeouts (issue #59) ────────────────────────────────────────────────
// Postgres calls can run while a room's lock is held, so a hung connect or
// query must fail after a bounded time instead of stalling the room forever.

describe("pool configuration", () => {
  const ORIGINAL_URL = process.env.DATABASE_URL;
  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_URL;
  });

  async function poolOptions() {
    await connectPostgres();
    return getPool().opts ?? {};
  }

  test("passes DATABASE_URL through as the connection string", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@db.example:5432/brade?sslmode=require";
    const opts = await poolOptions();
    expect(opts.connectionString).toBe(process.env.DATABASE_URL);
  });

  test("sets a finite connection timeout", async () => {
    const { connectionTimeoutMillis } = await poolOptions();
    expect(typeof connectionTimeoutMillis).toBe("number");
    expect(Number.isFinite(connectionTimeoutMillis)).toBe(true);
    expect(connectionTimeoutMillis).toBeGreaterThanOrEqual(1_000);
    expect(connectionTimeoutMillis).toBeLessThanOrEqual(60_000);
  });

  test("sets a finite statement timeout", async () => {
    const { statement_timeout } = await poolOptions();
    expect(typeof statement_timeout).toBe("number");
    expect(Number.isFinite(statement_timeout)).toBe(true);
    expect(statement_timeout).toBeGreaterThanOrEqual(1_000);
    expect(statement_timeout).toBeLessThanOrEqual(120_000);
  });
});
