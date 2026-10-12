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
