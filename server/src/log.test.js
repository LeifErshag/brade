import { jest } from "@jest/globals";
import { log, buildEntry, format } from "./log.js";

describe("buildEntry", () => {
  test("carries level, message and fields", () => {
    const e = buildEntry("info", "WS connected", { roomId: "A3F9B2C1", userId: "u1" });
    expect(e).toMatchObject({ level: "info", msg: "WS connected", roomId: "A3F9B2C1", userId: "u1" });
    expect(Number.isNaN(Date.parse(e.t))).toBe(false);
  });

  test("serialises an err field with message and stack", () => {
    const err = new Error("redis down");
    err.code = "ECONNREFUSED";
    const e = buildEntry("error", "AI turn error", { roomId: "R", err });
    expect(e.err).toEqual({ message: "redis down", code: "ECONNREFUSED", stack: err.stack });
  });

  test("accepts an Error as the second argument, like console.error", () => {
    const err = new TypeError("boom");
    const e = buildEntry("error", "Unhandled promise rejection:", err);
    expect(e.msg).toBe("Unhandled promise rejection:");
    expect(e.err).toMatchObject({ name: "TypeError", message: "boom" });
  });

  test("accepts an Error as the message", () => {
    const e = buildEntry("error", new Error("db down"));
    expect(e.msg).toBe("db down");
    expect(e.err.message).toBe("db down");
  });

  test("a non-object, non-Error second argument is kept as err.message", () => {
    expect(buildEntry("error", "Unhandled promise rejection:", "nope").err).toEqual({ message: "nope" });
  });

  test("drops fields that may hold secrets or personal data, and undefined ones", () => {
    const e = buildEntry("info", "m", {
      token: "t", accessToken: "a", cookie: "c", password: "p", JWT_SECRET: "s",
      authorization: "Bearer x", email: "a@b.c", roomId: undefined, userId: "u1",
    });
    expect(Object.keys(e).sort()).toEqual(["level", "msg", "t", "userId"]);
  });

  test.each([
    ["a plain object", { code: 42, detail: "x" }, '{"code":42,"detail":"x"}'],
    ["undefined",      undefined,                 "undefined"],
    ["null",           null,                      "null"],
    ["a number",       7,                         "7"],
  ])("an err field that is %s is recorded as text", (_name, reason, message) => {
    const e = buildEntry("error", "Unhandled promise rejection", { err: reason });
    expect(e.err).toEqual({ message });
    expect(Object.keys(e).sort()).toEqual(["err", "level", "msg", "t"]);
  });

  test("an err field that is a plain object has unsafe keys dropped", () => {
    const e = buildEntry("error", "m", { err: { token: "abc", code: 1 } });
    expect(e.err).toEqual({ message: '{"code":1}' });
  });

  test("drops unsafe keys inside nested objects and arrays", () => {
    const e = buildEntry("info", "m", { ctx: { url: "/x", token: "t", deep: [{ email: "a@b.c", ok: 1 }] } });
    expect(e.ctx).toEqual({ url: "/x", deep: [{ ok: 1 }] });
  });

  test("drops unsafe keys inside class instances, Maps and Sets", () => {
    class Session { constructor() { this.userId = "u1"; this.accessToken = "tok-1"; } }
    const e = buildEntry("info", "m", {
      session: new Session(),
      map: new Map([["roomId", "R"], ["cookie", "cookie-1"]]),
      set: new Set([{ ok: 1, password: "pw-1" }]),
    });
    expect(e.session).toEqual({ userId: "u1" });
    expect(e.map).toEqual({ roomId: "R" });
    expect(e.set).toEqual([{ ok: 1 }]);
    expect(JSON.stringify(e)).not.toMatch(/tok-1|cookie-1|pw-1/);
  });

  test("uses toJSON's result, scrubbed, for objects that have one", () => {
    const at = new Date("2026-01-02T03:04:05.000Z");
    const e = buildEntry("info", "m", {
      at,
      custom: { toJSON: () => ({ ok: 1, secret: "s" }) },
      broken: { toJSON: () => { throw new Error("no"); } },
    });
    expect(e.at).toBe("2026-01-02T03:04:05.000Z");
    expect(e.custom).toEqual({ ok: 1 });
    expect(e.broken).toBe("[unprintable]");
  });

  test("an Error nested in a field is serialised, not printed as {}", () => {
    const e = buildEntry("error", "m", { ctx: { last: new RangeError("bad") } });
    expect(e.ctx.last).toMatchObject({ name: "RangeError", message: "bad" });
  });

  test("records err.cause, following a few levels", () => {
    const root = new Error("ECONNRESET");
    const err = new Error("query failed", { cause: new Error("socket closed", { cause: root }) });
    const e = buildEntry("error", "m", { err });
    expect(e.err.cause).toMatchObject({ message: "socket closed", cause: { message: "ECONNRESET" } });

    const reason = new Error("outer", { cause: "plain reason" });
    expect(buildEntry("error", "m", { err: reason }).err.cause).toEqual({ message: "plain reason" });

    // A cause cycle stops at the limit.
    const a = new Error("a");
    a.cause = a;
    const json = JSON.stringify(buildEntry("error", "m", { err: a }));
    expect(json).toContain('"cause":"[too deep]"');
  });

  test("records pg's detail without the row values it quotes, and its constraint and table", () => {
    const unique = Object.assign(new Error('duplicate key value violates unique constraint "users_provider_key"'), {
      code: "23505",
      detail: "Key (provider, provider_id)=(google, 123456789) already exists.",
      constraint: "users_provider_key",
      table: "users",
    });
    const e = buildEntry("error", "m", { err: unique });
    expect(e.err).toMatchObject({
      code: "23505",
      detail: "Key (provider, provider_id)=(…) already exists.",
      constraint: "users_provider_key",
      table: "users",
    });

    const notNull = Object.assign(new Error("null value in column"), {
      detail: "Failing row contains (id-1, Anna Svensson, null).",
      column: "avatar_url",
    });
    const e2 = buildEntry("error", "m", { err: notNull });
    expect(e2.err.detail).toBe("Failing row contains (…).");
    expect(e2.err.column).toBe("avatar_url");
    expect(JSON.stringify(e2)).not.toContain("Anna");
  });

  test("masks token-looking text in the message, fields and errors", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl";
    const err = new Error(`failed to connect to wss://x/ws?room=R&token=${jwt}`);
    const e = buildEntry("error", `GET /ws?token=abc&room=R`, {
      header: "Bearer abc.def", nested: { note: `jwt ${jwt}` }, err,
    });
    const text = JSON.stringify(e);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("token=abc");
    expect(text).not.toContain("Bearer abc");
    expect(e.msg).toBe("GET /ws?token=[redacted]&room=R");
    expect(e.err.message).toBe("failed to connect to wss://x/ws?room=R&token=[redacted]");
    expect(e.nested.note).toBe("jwt [jwt]");
  });

  test("fields cannot overwrite the core keys", () => {
    const e = buildEntry("info", "m", { level: "error", msg: "x", t: "y" });
    expect(e.level).toBe("info");
    expect(e.msg).toBe("m");
    expect(e.t).not.toBe("y");
  });
});

describe("format", () => {
  test("json is one line that parses back", () => {
    const entry = buildEntry("error", "x", { roomId: "R", err: new Error("multi\nline") });
    const line = format(entry, true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(entry);
  });

  test("pretty puts level, message and fields on the first line", () => {
    const line = format(buildEntry("warn", "WS rejected", { roomId: "R", code: 4001 }), false);
    expect(line.split("\n")[0]).toMatch(/ WARN WS rejected roomId=R code=4001$/);
  });
});

describe("log", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LOG_FORMAT;
  });

  test("writes each level to the matching console method", () => {
    process.env.LOG_FORMAT = "json";
    const out = {
      info:  jest.spyOn(console, "log").mockImplementation(() => {}),
      warn:  jest.spyOn(console, "warn").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
    };
    for (const level of ["info", "warn", "error"]) {
      log[level]("hello", { userId: "u1" });
      expect(out[level]).toHaveBeenCalledTimes(1);
      expect(JSON.parse(out[level].mock.calls[0][0])).toMatchObject({ level, msg: "hello", userId: "u1" });
    }
  });

  test("a field that cannot be serialised still logs the message", () => {
    process.env.LOG_FORMAT = "json";
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const circular = {};
    circular.self = circular;
    expect(() => log.error("still here", { circular })).not.toThrow();
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({ msg: "still here" });
  });

  test.each([
    ["an Error whose message is not a string", () => { const e = new Error("x"); e.message = 5; return [e]; }],
    ["an Error whose stack is not a string",   () => { const e = new Error("x"); e.stack = { a: 1 }; return [e]; }],
    ["a message that String() cannot convert", () => [Object.create(null)]],
    ["an err that String() cannot convert",    () => ["m", { err: Object.create(null) }]],
    ["a non-Error object thrown as message",   () => [{ code: 1, token: "t" }]],
  ])("never throws for %s", (_name, args) => {
    process.env.LOG_FORMAT = "json";
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => log.error(...args())).not.toThrow();
    const line = error.mock.calls[0][0];
    expect(() => JSON.parse(line)).not.toThrow();
    expect(line).not.toContain('"t":"t"');
  });

  test("null fields are ignored, not logged as an error", () => {
    process.env.LOG_FORMAT = "json";
    const info = jest.spyOn(console, "log").mockImplementation(() => {});
    log.info("m", null);
    expect(JSON.parse(info.mock.calls[0][0]).err).toBeUndefined();
  });

  test("objects nested deeper than the scrub limit are left out", () => {
    const e = buildEntry("info", "m", { a: { b: { c: { d: { e: { token: "leak" } } } } } });
    expect(JSON.stringify(e)).not.toContain("leak");
    expect(e.a.b.c.d.e).toBe("[too deep]");
  });
});

describe("default format", () => {
  const saved = { ...process.env };
  afterEach(() => {
    jest.restoreAllMocks();
    for (const k of ["LOG_FORMAT", "NODE_ENV", "RENDER"]) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  function lineFor(env) {
    for (const k of ["LOG_FORMAT", "NODE_ENV", "RENDER"]) delete process.env[k];
    Object.assign(process.env, env);
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    log.error("boom", { err: new Error("bad") });
    const [[line]] = error.mock.calls;
    error.mockRestore();
    return line;
  }

  test.each([
    ["on Render",            { RENDER: "true" }],
    ["in production",        { NODE_ENV: "production" }],
    ["when forced",          { LOG_FORMAT: "json", NODE_ENV: "development" }],
  ])("is JSON %s", (_name, env) => {
    expect(JSON.parse(lineFor(env))).toMatchObject({ level: "error", msg: "boom" });
  });

  test("is readable elsewhere, with the stack on the following lines", () => {
    const line = lineFor({ NODE_ENV: "development" });
    const [first, ...rest] = line.split(/\r?\n/);
    expect(first).toMatch(/ ERROR boom$/);
    expect(rest.length).toBeGreaterThan(0);
    expect(line).toContain("Error: bad");
  });
});
