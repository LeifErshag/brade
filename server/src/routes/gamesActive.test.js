// ── GET /api/games/active ─────────────────────────────────────────────────────
// Lists the signed-in user's live games so the home page can offer "rejoin".

import { jest } from "@jest/globals";

const query = jest.fn(async () => ({ rows: [] }));
jest.unstable_mockModule("../db/postgres.js", () => ({
  query,
  connectPostgres: async () => {},
}));

const redisMget = jest.fn(async () => []);
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => ({ mget: redisMget }),
  keys: { room: (id) => `room:${id}` },
  TTL: { room: 86400 },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { default: gamesRouter } = await import("./games.js");
const { signAccessToken, signGuestToken } = await import("../auth/tokens.js");
const { default: express } = await import("express");

const ME    = "11111111-1111-1111-1111-111111111111";
const OTHER = "33333333-3333-3333-3333-333333333333";

const room = (roomId, over = {}) => ({
  roomId,
  matchLength: 5,
  status:      "playing",
  players:     { white: OTHER, black: ME },
  playerInfo:  { white: { display_name: "Anna" }, black: { display_name: "Me" } },
  score:       { white: 1, black: 2 },
  ...over,
});

describe("GET /api/games/active", () => {
  let server, base;

  beforeAll(async () => {
    const app = express();
    app.use("/api/games", gamesRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/games/active`;
  });

  afterAll(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  afterEach(() => { query.mockReset(); redisMget.mockReset(); });

  const get = (token) => fetch(base, { headers: { Authorization: `Bearer ${token}` } });

  test("returns only live, non-tutorial rooms the user plays in", async () => {
    query.mockResolvedValue({ rows: ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC", "DDDDDDDD", "EEEEEEEE"].map(room_id => ({ room_id })) });
    redisMget.mockResolvedValue([
      JSON.stringify(room("AAAAAAAA")),
      null,                                                         // expired
      JSON.stringify(room("CCCCCCCC", { status: "finished" })),
      JSON.stringify(room("DDDDDDDD", { players: { white: OTHER, black: "x" } })),
      JSON.stringify(room("EEEEEEEE", { status: "waiting" })),
    ]);
    const res = await get(signAccessToken(ME));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{
      roomId: "AAAAAAAA", matchLength: 5, isAi: false,
      score: { white: 1, black: 2 }, color: "black", opponentName: "Anna",
    }]);
    expect(query.mock.calls[0][1]).toEqual([ME]);
    expect(redisMget).toHaveBeenCalledWith("room:AAAAAAAA", "room:BBBBBBBB", "room:CCCCCCCC", "room:DDDDDDDD", "room:EEEEEEEE");
  });

  test("no unfinished games → empty list without touching Redis", async () => {
    const res = await get(signAccessToken(ME));
    expect(await res.json()).toEqual([]);
    expect(redisMget).not.toHaveBeenCalled();
  });

  test("guests and signed-out requests are refused", async () => {
    expect((await fetch(base)).status).toBe(401);
    const guest = signGuestToken("44444444-4444-4444-4444-444444444444", "G");
    expect((await get(guest)).status).toBe(403);
  });
});
