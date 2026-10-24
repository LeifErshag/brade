// ── POST /api/support-reports (issue #141) ───────────────────────────────────
// Postgres and Redis are replaced with in-memory fakes. A report stores the
// player's note, what the client saw and the server's own room snapshot, and
// returns a short ID that is also logged.

import { jest } from "@jest/globals";

const REPORT_UUID = "abcd1234-0000-4000-8000-000000000000";
const query = jest.fn(async () => ({ rows: [{ id: REPORT_UUID }], rowCount: 1 }));
jest.unstable_mockModule("../db/postgres.js", () => ({
  query,
  connectPostgres: async () => {},
}));

const redisGet = jest.fn(async () => null);
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => ({ get: redisGet, ttl: async () => 3600 }),
  keys: { room: (id) => `room:${id}` },
  TTL: { room: 86400 },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.LOG_FORMAT = "json";

const { default: router, pruneSupportReports, shortReportId } = await import("./supportReports.js");
const { signAccessToken, signGuestToken } = await import("../auth/tokens.js");
const { default: express } = await import("express");

const USER_ID  = "11111111-1111-1111-1111-111111111111";
const GUEST_ID = "22222222-2222-2222-2222-222222222222";
const ROOM = { players: { white: USER_ID, black: null }, status: "waiting" };

describe("POST /api/support-reports", () => {
  let server, url, info;

  beforeAll(async () => {
    const app = express();
    // Each test request gets its own client IP (X-Forwarded-For), so the
    // per-IP rate limit only applies where a test means it to.
    app.set("trust proxy", "loopback");
    app.use("/api/support-reports", express.json({ limit: "64kb" }));
    app.use(express.json({ limit: "10kb" }));
    app.use("/api/support-reports", router);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    url = `http://127.0.0.1:${server.address().port}/api/support-reports`;
  });

  afterAll(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  beforeEach(() => {
    query.mockClear();
    redisGet.mockReset();
    redisGet.mockResolvedValue(null);
    info = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  let nextIp = 1;
  function post(body, token, ip = `10.0.0.${nextIp++}`) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "jest",
        "X-Forwarded-For": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  const insertParams = () => query.mock.calls[0][1];

  test("stores the note, client state, logs and server snapshot, and returns a short ID", async () => {
    redisGet.mockResolvedValue(JSON.stringify(ROOM));
    const logs = [{ t: "2026-10-25T10:00:00.000Z", level: "warn", msg: "[ws] closed", ctx: { code: 1006 } }];
    const res = await post({
      note: "  The dice did not roll  ", roomId: "A3F9B2C1", page: "/game/A3F9B2C1",
      state: { phase: "rolling", dice: [3, 5] }, logs,
    }, signAccessToken(USER_ID));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ reportId: "ABCD1234" });

    const [userId, isGuest, roomId, note, page, userAgent, client, snapshot] = insertParams();
    expect([userId, isGuest, roomId, note, page, userAgent]).toEqual(
      [USER_ID, false, "A3F9B2C1", "The dice did not roll", "/game/A3F9B2C1", "jest"]);
    expect(client).toEqual({ state: { phase: "rolling", dice: [3, 5] }, logs });
    expect(snapshot).toMatchObject({ ttlSeconds: 3600, connections: [], room: ROOM });

    const line = info.mock.calls.map(([l]) => JSON.parse(l)).find(e => e.msg === "Support report received");
    expect(line).toMatchObject({ reportId: "ABCD1234", userId: USER_ID, roomId: "A3F9B2C1" });
  });

  test("works signed out and for guests; no room means no snapshot", async () => {
    expect((await post({ note: "help" })).status).toBe(201);
    expect(insertParams().slice(0, 3)).toEqual([null, false, null]);
    expect(insertParams()[6]).toBeNull();
    expect(insertParams()[7]).toBeNull();

    query.mockClear();
    expect((await post({ note: "help" }, signGuestToken(GUEST_ID, "Guest"))).status).toBe(201);
    expect(insertParams().slice(0, 2)).toEqual([GUEST_ID, true]);
  });

  test("a room that has expired is reported without a snapshot", async () => {
    expect((await post({ note: "x", roomId: "A3F9B2C1" })).status).toBe(201);
    expect(insertParams()[7]).toBeNull();
  });

  test("accepts a report with 50 full log lines, over the general 10 kB limit", async () => {
    const logs = Array.from({ length: 50 }, (_, i) => ({
      t: "2026-10-25T10:00:00.000Z", level: "info", msg: "x".repeat(300), ctx: { attempt: i },
    }));
    expect((await post({ note: "slow", logs })).status).toBe(201);
  });

  test("allows 5 reports an hour from one IP", async () => {
    const ip = "10.9.9.9";
    for (let i = 0; i < 5; i++) expect((await post({ note: `n${i}` }, undefined, ip)).status).toBe(201);
    expect((await post({ note: "one more" }, undefined, ip)).status).toBe(429);
    expect(query).toHaveBeenCalledTimes(5);
  });

  test.each([
    ["an empty note",             { note: "   " }],
    ["a note over 2000 chars",    { note: "x".repeat(2001) }],
    ["a malformed room id",       { note: "x", roomId: "nope" }],
    ["more than 50 log lines",    { note: "x", logs: Array(51).fill({ t: "t", level: "info", msg: "m" }) }],
    ["a log line with bad level", { note: "x", logs: [{ t: "t", level: "debug", msg: "m" }] }],
    ["an unknown field",          { note: "x", extra: 1 }],
  ])("rejects %s with 400 and stores nothing", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("pruneSupportReports", () => {
  afterEach(() => jest.restoreAllMocks());

  test("deletes reports older than 90 days", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    query.mockClear();
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await pruneSupportReports();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM support_reports WHERE created_at < now\(\) - make_interval\(days => \$1\)/);
    expect(params).toEqual([90]);
  });
});

test("shortReportId is the UUID's first 8 characters in upper case", () => {
  expect(shortReportId(REPORT_UUID)).toBe("ABCD1234");
});
