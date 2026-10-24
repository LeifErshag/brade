// ── GET /api/games/:roomId/debug ─────────────────────────────────────────────
// Returns the room snapshot (shared with problem reports, ws/roomSnapshot.js)
// to the room's players only.

import { jest } from "@jest/globals";

jest.unstable_mockModule("../db/postgres.js", () => ({
  query: jest.fn(async () => ({ rows: [] })),
  connectPostgres: async () => {},
}));

const redisGet = jest.fn(async () => null);
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => ({ get: redisGet, ttl: async () => 1234 }),
  keys: { room: (id) => `room:${id}` },
  TTL: { room: 86400 },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { default: gamesRouter } = await import("./games.js");
const { rooms } = await import("../ws/server.js");
const { signAccessToken } = await import("../auth/tokens.js");
const { default: express } = await import("express");

const WHITE = "11111111-1111-1111-1111-111111111111";
const OTHER = "33333333-3333-3333-3333-333333333333";
const ROOM  = { players: { white: WHITE, black: null }, status: "waiting" };

describe("GET /api/games/:roomId/debug", () => {
  let server, base;

  beforeAll(async () => {
    const app = express();
    app.use("/api/games", gamesRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/games`;
  });

  afterAll(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  afterEach(() => {
    redisGet.mockReset();
    rooms.clear();
  });

  const get = (roomId, userId) => fetch(`${base}/${roomId}/debug`, {
    headers: { Authorization: `Bearer ${signAccessToken(userId)}` },
  });

  test("a player gets the room, its TTL and live connections", async () => {
    redisGet.mockResolvedValue(JSON.stringify(ROOM));
    rooms.set("A3F9B2C1", new Set([{ ws: {}, userId: WHITE }]));
    const res = await get("A3F9B2C1", WHITE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ttlSeconds: 1234, connections: [WHITE], room: ROOM });
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  test("someone who is not a player is refused", async () => {
    redisGet.mockResolvedValue(JSON.stringify(ROOM));
    expect((await get("A3F9B2C1", OTHER)).status).toBe(403);
  });

  test("a missing room is 404 and a malformed id 400", async () => {
    expect((await get("A3F9B2C1", WHITE)).status).toBe(404);
    expect((await get("nope", WHITE)).status).toBe(400);
  });
});
