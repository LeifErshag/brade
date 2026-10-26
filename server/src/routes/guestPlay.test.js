// ── Guest play: named guests, guest-hosted lobbies, user-only routes ─────────
// Postgres and Redis are replaced with in-memory fakes. A signed-out player
// picks a name, which goes into their guest token; they can host a human lobby
// (unrated, white_id NULL); and guest tokens are refused on routes that need a
// users row.

import { jest } from "@jest/globals";

const query = jest.fn(async (sql) =>
  (/^SELECT id FROM games/.test(sql) ? { rows: [{ id: "game-uuid" }] } : { rows: [] }));
jest.unstable_mockModule("../db/postgres.js", () => ({
  query,
  connectPostgres: async () => {},
}));

const store = new Map();
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => ({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); return "OK"; },
    ttl: async () => 100,
  }),
  keys: {
    room: (id) => `room:${id}`,
    matchResult: (id) => `match:result:${id}`,
    matchQueue: () => "queue:match",
    matchInfo: (id) => `match:info:${id}`,
  },
  TTL: { room: 86400 },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.CLIENT_ORIGIN = "http://client.test";

const { default: guestRouter } = await import("./guest.js");
const { default: gamesRouter } = await import("./games.js");
const { default: usersRouter } = await import("./users.js");
const { default: matchmakingRouter } = await import("./matchmaking.js");
const { signGuestToken, verifyAccessToken } = await import("../auth/tokens.js");
const { default: express } = await import("express");

let server, base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/guest", guestRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/matchmaking", matchmakingRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
}));

beforeEach(() => {
  store.clear();
  query.mockClear();
});

const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe("POST /api/guest", () => {
  test("puts the trimmed name into the guest token", async () => {
    const res = await post("/api/guest", { displayName: "  Kalle  " });
    expect(res.status).toBe(200);
    const { token, guestId } = await res.json();
    const payload = verifyAccessToken(token);
    expect(payload).toMatchObject({ sub: guestId, isGuest: true, display_name: "Kalle" });
  });

  test("defaults to Guest when no body is sent", async () => {
    const res = await fetch(`${base}/api/guest`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(verifyAccessToken((await res.json()).token).display_name).toBe("Guest");
  });

  test.each([["empty", "   "], ["too long", "x".repeat(31)], ["not a string", 42]])(
    "rejects a name that is %s", async (_label, displayName) => {
      const res = await post("/api/guest", { displayName });
      expect(res.status).toBe(400);
    });
});

describe("POST /api/games/guest", () => {
  test("creates an unrated lobby hosted by the guest", async () => {
    const res = await post("/api/games/guest", { matchLength: 3, displayName: "Kalle" });
    expect(res.status).toBe(201);
    const { roomId, inviteUrl, token, guestId } = await res.json();
    expect(roomId).toMatch(/^[A-Z0-9]{8}$/);
    expect(inviteUrl).toBe(`http://client.test/game/${roomId}`);
    expect(verifyAccessToken(token)).toMatchObject({ sub: guestId, isGuest: true, display_name: "Kalle" });

    const room = JSON.parse(store.get(`room:${roomId}`));
    expect(room).toMatchObject({
      matchLength: 3,
      createdBy:   guestId,
      hasGuest:    true,
      status:      "waiting",
      players:     { white: guestId, black: null },
      playerInfo:  { white: { display_name: "Kalle", isGuest: true }, black: null },
    });

    const sql = query.mock.calls.map(([s, p]) => [s, p]);
    expect(sql).toHaveLength(1);
    expect(sql[0][0]).toMatch(/INSERT INTO games \(room_id, white_id, match_length\) VALUES \(\$1, NULL, \$2\)/);
    expect(sql[0][1]).toEqual([roomId, 3]);
    for (const [s] of sql) expect(s).not.toMatch(/users/i);
  });

  test("requires a name", async () => {
    expect((await post("/api/games/guest", { matchLength: 5 })).status).toBe(400);
    expect((await post("/api/games/guest", { matchLength: 5, displayName: " " })).status).toBe(400);
    expect(store.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

test("POST /api/games/ai-guest uses the chosen name", async () => {
  const res = await post("/api/games/ai-guest", { matchLength: 1, displayName: "Kalle" });
  expect(res.status).toBe(201);
  const { roomId, token } = await res.json();
  expect(verifyAccessToken(token).display_name).toBe("Kalle");
  const room = JSON.parse(store.get(`room:${roomId}`));
  expect(room.playerInfo.white).toMatchObject({ display_name: "Kalle", isGuest: true });
});

describe("guest tokens on user-only routes", () => {
  const auth = { Authorization: `Bearer ${signGuestToken("44444444-4444-4444-4444-444444444444", "Kalle")}` };

  // Every row fills the body slot: jest would treat a missing one as `done`.
  test.each([
    ["POST", "/api/games", { matchLength: 5 }],
    ["POST", "/api/matchmaking/join", { matchLength: 5 }],
    ["GET",  "/api/users/me", null],
    ["PATCH", "/api/users/me", { display_name: "X" }],
    ["GET",  "/api/users/search?q=ab", null],
  ])("%s %s is forbidden", async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json", ...auth } : auth,
      body: body ? JSON.stringify(body) : undefined,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
    expect(query).not.toHaveBeenCalled();
  });
});
