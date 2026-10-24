// ── POST /api/client-log (issue #140) ────────────────────────────────────────
// Client warnings and errors are validated and written to the server log,
// with the userId attached when the Bearer token is valid.

import { jest } from "@jest/globals";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.LOG_FORMAT = "json";

const { default: clientLogRouter } = await import("./clientLog.js");
const { signAccessToken, signGuestToken } = await import("../auth/tokens.js");
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");

const USER_ID = "11111111-1111-1111-1111-111111111111";

describe("POST /api/client-log", () => {
  let server, url, out;

  beforeAll(async () => {
    const app = express();
    // Each test request gets its own client IP (X-Forwarded-For), so the
    // per-IP rate limit only applies where a test means it to.
    app.set("trust proxy", "loopback");
    app.use(express.json({ limit: "10kb" }));
    app.use("/api/client-log", clientLogRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    url = `http://127.0.0.1:${server.address().port}/api/client-log`;
  });

  afterAll(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  beforeEach(() => {
    out = {
      info:  jest.spyOn(console, "log").mockImplementation(() => {}),
      warn:  jest.spyOn(console, "warn").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
    };
  });
  afterEach(() => jest.restoreAllMocks());

  let nextIp = 1;
  function post(body, token, ip = `10.0.0.${nextIp++}`) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        "User-Agent": "jest",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  const logged = (level) => JSON.parse(out[level].mock.calls[0][0]);

  test("logs a signed-in player's error with their userId and returns 204", async () => {
    const res = await post({
      level: "error", msg: "[ws] giving up", roomId: "A3F9B2C1", page: "/game/A3F9B2C1",
      context: { code: 4003, wasClean: true },
    }, signAccessToken(USER_ID));
    expect(res.status).toBe(204);
    expect(logged("error")).toMatchObject({
      level: "error", msg: "client: [ws] giving up", source: "client", userId: USER_ID,
      roomId: "A3F9B2C1", page: "/game/A3F9B2C1", ctx: { code: 4003, wasClean: true }, userAgent: "jest",
    });
  });

  test("marks guests", async () => {
    const res = await post({ level: "warn", msg: "x" }, signGuestToken("22222222-2222-2222-2222-222222222222", "Guest"));
    expect(res.status).toBe(204);
    expect(logged("warn")).toMatchObject({ userId: "22222222-2222-2222-2222-222222222222", guest: true });
  });

  test("an invalid or missing token is accepted without a userId", async () => {
    expect((await post({ level: "warn", msg: "x" }, "not-a-jwt")).status).toBe(204);
    expect((await post({ level: "warn", msg: "y" })).status).toBe(204);
    for (const [line] of out.warn.mock.calls) expect(JSON.parse(line).userId).toBeUndefined();
  });

  test("an expired token is accepted without a userId", async () => {
    const expired = jwt.sign({ sub: USER_ID }, process.env.JWT_ACCESS_SECRET, { expiresIn: -10 });
    expect((await post({ level: "warn", msg: "late" }, expired)).status).toBe(204);
    expect(logged("warn").userId).toBeUndefined();
  });

  test("allows 30 lines a minute from one IP", async () => {
    const ip = "10.9.9.9";
    for (let i = 0; i < 30; i++) expect((await post({ level: "warn", msg: `m${i}` }, undefined, ip)).status).toBe(204);
    expect((await post({ level: "warn", msg: "one more" }, undefined, ip)).status).toBe(429);
    expect(out.warn).toHaveBeenCalledTimes(30);
  });

  test("token-looking text and unsafe context keys do not reach the log", async () => {
    await post({
      level: "error", msg: "WebSocket failed: wss://h/ws?room=R&token=abc.def.ghi",
      context: { accessToken: "secret", note: "ok" },
    });
    const entry = logged("error");
    expect(entry.msg).toBe("client: WebSocket failed: wss://h/ws?room=R&token=[redacted]");
    expect(entry.ctx).toEqual({ note: "ok" });
  });

  test.each([
    ["an unknown level",           { level: "debug", msg: "x" }],
    ["an empty message",           { level: "warn", msg: "" }],
    ["a message over 500 chars",   { level: "warn", msg: "x".repeat(501) }],
    ["a malformed room id",        { level: "warn", msg: "x", roomId: "abc" }],
    ["a nested context value",     { level: "warn", msg: "x", context: { a: { b: 1 } } }],
    ["more than 20 context keys",  { level: "warn", msg: "x", context: Object.fromEntries([...Array(21)].map((_, i) => [`k${i}`, i])) }],
    ["an unknown field",           { level: "warn", msg: "x", extra: 1 }],
  ])("rejects %s with 400 and logs nothing", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(out.warn).not.toHaveBeenCalled();
    expect(out.error).not.toHaveBeenCalled();
  });
});
