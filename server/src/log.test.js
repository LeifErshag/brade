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
