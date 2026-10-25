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

    // A value with a line break (e.g. a display name) is masked too.
    const multiline = Object.assign(new Error("null value in column"), {
      detail: "Failing row contains (id-1, Anna\nSvensson, null).",
    });
    const e3 = buildEntry("error", "m", { err: multiline });
    expect(e3.err.detail).toBe("Failing row contains (…).");
    const dup = Object.assign(new Error("duplicate key"), { detail: "Key (display_name)=(Anna\nSvensson) already exists." });
    expect(buildEntry("error", "m", { err: dup }).err.detail).toBe("Key (display_name)=(…) already exists.");
  });

  test("masks the input pg quotes in an error's message, stack and detail", () => {
    const badUuid = Object.assign(new Error('invalid input syntax for type uuid: "Anna\nSvensson"'), {
      severity: "ERROR", code: "22P02",
    });
    const e = buildEntry("error", "m", { err: badUuid });
    expect(e.err.message).toBe('invalid input syntax for type uuid: "…"');
    expect(e.err.stack.split("\n")[0]).toBe('Error: invalid input syntax for type uuid: "…"');
    expect(JSON.stringify(e)).not.toMatch(/Anna|Svensson/);

    const badJson = Object.assign(new Error("invalid input syntax for type json"), {
      severity: "ERROR", code: "22P02", detail: 'Token "Anna" is invalid.',
    });
    expect(buildEntry("error", "m", { err: badJson }).err.detail).toBe('Token "…" is invalid.');

    // As the message itself, too.
    expect(buildEntry("error", badUuid).msg).toBe('invalid input syntax for type uuid: "…"');

    // A value quoted mid-message (22003), in the message and the stack.
    const outOfRange = Object.assign(new Error('value "1234\n5678901234" is out of range for type integer'), {
      severity: "ERROR", code: "22003",
    });
    const e2 = buildEntry("error", "m", { err: outOfRange });
    expect(e2.err.message).toBe('value "…" is out of range for type integer');
    expect(e2.err.stack.split("\n")[0]).toBe('Error: value "…" is out of range for type integer');
    expect(JSON.stringify(e2)).not.toMatch(/1234|5678901234/);
    const badReal = Object.assign(new Error('"1e999" is out of range for type real'), { severity: "ERROR", code: "22003" });
    expect(buildEntry("error", "m", { err: badReal }).err.message).toBe('"…" is out of range for type real');

    // A value that starts the message (bit strings, 22P02), but not an
    // identifier that does.
    for (const kind of ["binary", "hexadecimal"]) {
      const badBit = Object.assign(new Error(`"Ö" is not a valid ${kind} digit`), { severity: "ERROR", code: "22P02" });
      const e4 = buildEntry("error", badBit);
      expect(e4.msg).toBe(`"…" is not a valid ${kind} digit`);
      expect(e4.err.stack.split("\n")[0]).toBe(`Error: "…" is not a valid ${kind} digit`);
      expect(JSON.stringify(e4)).not.toContain("Ö");
    }
    const notSeq = Object.assign(new Error('"games" is not a sequence'), { severity: "ERROR", code: "42809" });
    expect(buildEntry("error", notSeq).msg).toBe('"games" is not a sequence');

    // Messages from anything other than pg are left alone.
    expect(buildEntry("error", "m", { err: new Error('bad value: "x"') }).err.message).toBe('bad value: "x"');
  });

  test.each([
    ['time zone "Anna" not recognized', 'time zone "…" not recognized'],
    ['invalid value "Anna" for "MON"', 'invalid value "…" for "MON"'],
    ['interval time zone "Anna" must not include months or days', 'interval time zone "…" must not include months or days'],
    ['unit "Anna" not recognized', 'unit "…" not recognized'],
    ['unit "Anna" not supported for type interval', 'unit "…" not supported for type interval'],
  ])("masks the value in the pg message %j", (message, masked) => {
    const e = buildEntry("error", Object.assign(new Error(message), { severity: "ERROR", code: "22023" }));
    expect(e.msg).toBe(masked);
    expect(e.err.stack.split("\n")[0]).toBe(`Error: ${masked}`);
    expect(JSON.stringify(e)).not.toContain("Anna");
  });

  test.each([
    ['Unexpected "Ö" character.', 'Unexpected "…" character.'],
    ['Expected ":", but found "Anna".', 'Expected ":", but found "…".'],
    ['Expected JSON value, but found "Anna\nSvensson".', 'Expected JSON value, but found "…".'],
    ['Escape sequence "\\Anna" is invalid.', 'Escape sequence "…" is invalid.'],
    [
      'This time zone name appears in the configuration file for time zone abbreviation "Anna".',
      'This time zone name appears in the configuration file for time zone abbreviation "…".',
    ],
  ])("masks the value in the pg detail %j", (detail, masked) => {
    const err = Object.assign(new Error("invalid input syntax for type json"), { severity: "ERROR", code: "22P02", detail });
    expect(buildEntry("error", "m", { err }).err.detail).toBe(masked);
  });

  test.each([
    'relation "games" does not exist',
    'column "room_id" of relation "games" does not exist',
    '"games" is not a sequence',
  ])("keeps the identifier in the pg message %j", message => {
    const err = Object.assign(new Error(message), { severity: "ERROR", code: "42P01" });
    const e = buildEntry("error", err);
    expect(e.msg).toBe(message);
    expect(e.err.stack).toBe(err.stack);
  });

  test("keeps the stack header of a pg message that starts with an identifier", () => {
    const err = Object.assign(new Error('"games" is not a sequence'), { severity: "ERROR", code: "42809" });
    void err.stack;
    // A changed message makes the whole head go through maskPg.
    err.message = "changed";
    const stack = buildEntry("error", "m", { err }).err.stack;
    expect(stack.split("\n")[0]).toBe('Error: "games" is not a sequence');
  });

  test("masks a pg message cut off after a value that starts it", () => {
    const err = Object.assign(new Error('"Anna" is out of range for type real'), { severity: "ERROR", code: "22003" });
    void err.stack;
    err.message = '"Anna" is out of ra';
    const e = buildEntry("error", "m", { err });
    expect(e.err.message).toBe('"…" is out of ra');
    expect(e.err.stack.split("\n")[0]).toBe('Error: "…" is out of range for type real');
    expect(JSON.stringify(e)).not.toContain("Anna");
  });

  // A cut message is masked from the message its stack was captured with, so
  // a quote inside the value isn't taken for its end, whatever follows it.
  test.each([
    ['"Anna "Bo" Svensson" is out of range for type real', '"Anna "Bo" Svens', '"…'],
    ['"Anna "Bo", Svensson" is out of range for type real', '"Anna "Bo", Sv', '"…'],
    ['"Anna " Bo" is out of range for type real', '"Anna " Bo', '"…'],
    ['"Anna "_Bo" is out of range for type real', '"Anna "_Bo', '"…'],
    ['"Anna "😀Bo" is out of range for type real', '"Anna "😀Bo', '"…'],
    ['"Anna "Bo" Svensson" is out of range for type real', '"Anna "Bo" Svensson" is out', '"…" is out'],
    ['invalid input syntax for type uuid: "Anna "Bo" Svensson"', 'invalid input syntax for type uuid: "Anna "Bo" Sv', 'invalid input syntax for type uuid: "…'],
    ['Key (a)=(Anna) already exists.', 'Key (a)=(Anna) alr', 'Key (a)=(…) alr'],
    ['Key (a)=(Anna) already exists.', 'Key (a)=', 'Key (a)='],
  ])("masks a pg message %j cut to %j from its stack", (old, cut, masked) => {
    const err = Object.assign(new Error(old), { severity: "ERROR", code: "22003" });
    void err.stack;
    err.message = cut;
    const e = buildEntry("error", err);
    expect(e.msg).toBe(masked);
    expect(e.err.message).toBe(masked);
    expect(JSON.stringify(e)).not.toMatch(/Anna|Bo\b|Sv/);
  });

  test("masks a pg stack whose message was changed after it was captured", () => {
    const err = Object.assign(new Error('invalid input syntax for type uuid: "Anna\nSvensson"'), {
      severity: "ERROR", code: "22P02",
    });
    void err.stack; // V8 builds the stack text on first read
    err.message = 'invalid input syntax for type uuid: "Bertil"';
    const e = buildEntry("error", "m", { err });
    expect(e.err.stack.split("\n")[0]).toBe('Error: invalid input syntax for type uuid: "…"');
    expect(e.err.stack).toMatch(/\n\s+at /);
    expect(JSON.stringify(e)).not.toMatch(/Anna|Svensson|Bertil/);
  });

  // Only our own code can leave a value's closing quote out.
  test.each([
    ['invalid input syntax for type uuid: "Anna Svensson"', 'invalid input syntax for type uuid: "An'],
    ['invalid input syntax for type uuid: "Anna Svensson"', 'invalid input syntax for type uuid: "Anna\nSvensson'],
    ['x: "a"', 'x: "a" y: "Anna Svensson'],
    ['invalid input syntax for type uuid: "Anna "Svensson"', 'invalid input syntax for type uuid: "Anna "Svensson'],
    ['"Anna Svensson" is out of range for type real', '"Anna Svensson'],
    ['"Anna "Svensson" is out of range for type real', '"Anna "Svensson'],
  ])("masks a pg message %j changed to end inside a value, %j", (old, cut) => {
    const err = Object.assign(new Error(old), { severity: "ERROR" });
    void err.stack;
    err.message = cut;
    const e = buildEntry("error", "m", { err });
    expect(e.err.message).toMatch(/…$/);
    expect(JSON.stringify(e)).not.toMatch(/Anna|Svensson/);
  });

  test("masks a value without a closing quote in a pg stack and detail", () => {
    const err = Object.assign(new Error('invalid input syntax for type uuid: "Anna'), {
      severity: "ERROR", detail: 'x: "Svensson',
    });
    const e = buildEntry("error", "m", { err });
    expect(e.err.message).toBe('invalid input syntax for type uuid: "…');
    expect(e.err.stack.split("\n")[0]).toBe('Error: invalid input syntax for type uuid: "…');
    expect(e.err.detail).toBe('x: "…');
  });

  // A new message that still appears in the stack (shortened, or "Error").
  test.each(["invalid input syntax for type uuid", "Error"])(
    "masks a pg stack whose message was shortened to %j",
    shorter => {
      const short = Object.assign(new Error('invalid input syntax for type uuid: "Anna"'), { severity: "ERROR" });
      void short.stack;
      short.message = shorter;
      expect(buildEntry("error", "m", { err: short }).err.stack).not.toContain("Anna");
    },
  );

  // The second message ends in a whole frame with a location; only the
  // closing " keeps that line out of the frames.
  test.each([
    'x: "Anna\n    at Bertil\nCecilia"',
    'x: "Anna\n    at Bertil (a:1:2)"',
  ])("masks an old pg message %j with a line that looks like a stack frame", (old) => {
    const err = Object.assign(new Error(old), { severity: "ERROR" });
    const frames = err.stack.split("\n").slice(old.split("\n").length);
    err.message = "q";
    const stack = buildEntry("error", "m", { err }).err.stack;
    expect(stack).not.toMatch(/Anna|Bertil|Cecilia/);
    // The real frames are kept as they were.
    expect(stack.split("\n").slice(1)).toEqual(frames);
  });

  // A new message that is the tail of the old one, or its start cut just
  // before a line that looks like a frame.
  test.each([
    ['invalid input syntax for type uuid: "Anna Svensson"', 'n"'],
    ['invalid input syntax for type uuid: "Anna Svensson"', '"Anna Svensson"'],
    ['invalid input syntax for type uuid: "x"\n    at Anna Svensson"', 'invalid input syntax for type uuid: "x"'],
    ["Key (a)=(x\n    at Anna Svensson)", "Key (a)=(x"],
  ])("masks a pg stack whose message %j was cut to %j", (old, cut) => {
    const err = Object.assign(new Error(old), { severity: "ERROR" });
    void err.stack;
    err.message = cut;
    expect(buildEntry("error", "m", { err }).err.stack).not.toMatch(/Anna|Svensson/);
  });

  test("masks a pg stack whose message was cut to a middle slice ending in frame-like lines", () => {
    const err = Object.assign(new Error("Key (a)=(q\n    at Anna (y:1:2)\n    at x (y:1:2)"), { severity: "ERROR" });
    void err.stack;
    err.message = "ey (a)=(q\n    at Anna (y:1:2)\n  ";
    const stack = buildEntry("error", "m", { err }).err.stack;
    expect(stack).not.toContain("Anna");
    expect(stack).toMatch(/\n\s+at /);
  });

  // The old message ends in a line that looks like a frame, so only masking
  // the frames, too, masks it, whether or not the current message holds the value.
  test.each([
    ['q\n    at f: "Anna" (y:1:2)', ': "Anna"', '    at f: "…'],
    ['q\n    at f: "Anna" (y:1:2)', "Anna", '    at f: "…'],
    ["q\n    at f contains (Anna, Bo) (y:1:2)", "contains (Anna", "    at f contains (…)"],
  ])("masks a pg stack whose old message %j ends in a frame-like line, changed to %j", (old, current, line) => {
    const err = Object.assign(new Error(old), { severity: "ERROR" });
    const frames = err.stack.split("\n").slice(2);
    err.message = current;
    const stack = buildEntry("error", "m", { err }).err.stack;
    expect(stack).not.toMatch(/Anna|Bo\b/);
    // The real frames are kept as they were.
    expect(stack.split("\n")).toEqual(["Error: q", line, ...frames]);
  });

  test("masks only the message in a pg stack whose message is unchanged", () => {
    const err = Object.assign(new Error('"games" is not a sequence'), { severity: "ERROR", code: "42809" });
    const e = buildEntry("error", "m", { err });
    expect(e.err.message).toBe('"games" is not a sequence');
    expect(e.err.stack).toBe(err.stack);

    const bad = Object.assign(new Error('invalid input syntax for type uuid: "Anna"'), { severity: "ERROR" });
    const frames = bad.stack.slice(bad.stack.indexOf("\n"));
    expect(buildEntry("error", "m", { err: bad }).err.stack)
      .toBe(`Error: invalid input syntax for type uuid: "…"${frames}`);

    // pg sets name = "error" and then captures the stack, so its header is "error: ".
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "Anna"'), { name: "error", severity: "ERROR" });
    Error.captureStackTrace(pg);
    expect(pg.stack.startsWith("error: ")).toBe(true);
    const pgFrames = pg.stack.slice(pg.stack.indexOf("\n"));
    expect(buildEntry("error", "m", { err: pg }).err.stack)
      .toBe(`error: invalid input syntax for type uuid: "…"${pgFrames}`);
  });

  test("keeps object keys of a Map apart", () => {
    const e = buildEntry("info", "m", {
      map: new Map([[{ id: 1 }, "a"], [{ id: 2 }, "b"], ["token", "tok-1"], ["roomId", "R"]]),
    });
    expect(e.map).toEqual([[{ id: 1 }, "a"], [{ id: 2 }, "b"], ["roomId", "R"]]);
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

  test("pretty shows an error's pg fields and its cause", () => {
    const cause = new Error("socket closed");
    const err = Object.assign(new Error("query failed", { cause }), {
      code: "23505", detail: "Key (room_id)=(R) already exists.", table: "games",
    });
    const lines = format(buildEntry("error", "m", { err }), false).split("\n");
    expect(lines).toContain("  code=23505 detail=Key (room_id)=(…) already exists. table=games");
    const at = lines.indexOf("  Caused by:");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe("    Error: socket closed");
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

  test("the fallback line keeps the plain fields", () => {
    process.env.LOG_FORMAT = "json";
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const fields = {
      roomId: "R", userId: "u1", tries: 2, token: "tok-1",
      get broken() { throw new Error("no"); },
      ctx: { get deep() { throw new Error("no"); } },
    };
    expect(() => log.error("still here", fields)).not.toThrow();
    const entry = JSON.parse(error.mock.calls[0][0]);
    expect(entry).toMatchObject({ msg: "still here", roomId: "R", userId: "u1", tries: 2 });
    expect(entry).not.toHaveProperty("ctx");
    expect(JSON.stringify(entry)).not.toContain("tok-1");
  });

  test("the fallback line keeps the message when the fields cannot be listed", () => {
    process.env.LOG_FORMAT = "json";
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const fields = new Proxy({}, { ownKeys() { throw new Error("no"); } });
    expect(() => log.error("keep me", fields)).not.toThrow();
    expect(JSON.parse(error.mock.calls[0][0]).msg).toBe("keep me");
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
