// ── Unrated games with guests on either side ──────────────────────────────────
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes.
// A room with a guest is never rated. Only signed-in players are written to the
// games row (guests have no users row, and games.*_id reference users), and
// nobody's ELO, wins or losses change.

import { jest } from "@jest/globals";

const store = new Map();
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
  ttl:    async () => 100,
};

const query = jest.fn(async (sql) =>
  (/^SELECT id FROM games/.test(sql) ? { rows: [{ id: "game-uuid" }] } : { rows: [] }));
const broadcasts = [];

jest.unstable_mockModule("../db/postgres.js", () => ({
  query,
  connectPostgres: async () => {},
}));

jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => fakeRedis,
  connectRedis: async () => {},
  keys: { room: (id) => `room:${id}` },
  TTL:  { room: 86400, refresh: 604800, invite: 172800 },
}));

jest.unstable_mockModule("./server.js", () => ({
  rooms:           new Map(),
  userConnections: new Map(),
  send:            (ws, payload) => ws?.send?.(JSON.stringify(payload)),
  sendToUser:      () => {},
  broadcastToRoom: (_roomId, payload) => broadcasts.push(payload),
  broadcastState:  () => {},
}));

const { handleMessage } = await import("./handlers.js");
const { initGame, pathToIdx, getLegalMoves } = await import("../game/engine.js");

const GUEST_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER    = "11111111-1111-1111-1111-111111111111";

const guest = (name) => ({ display_name: name, avatar_url: null, isGuest: true });
const user  = (name) => ({ display_name: name, avatar_url: null });

// Matches any SQL that would rate the game or touch a player's record.
const RATING_SQL = /UPDATE users|elo|wins|losses/i;

function sqlCalls() {
  return query.mock.calls.map(([sql, params]) => ({ sql, params }));
}

function makeRoom(roomId, { white, black, extra = {}, status = "playing", gameState = null }) {
  return {
    roomId,
    matchLength: 1,
    createdBy:   white.id,
    hasGuest:    true,
    players:     { white: white.id, black: black.id },
    playerInfo:  { white: white.info, black: black.info },
    ready:       { white: true, black: true },
    status,
    score:       { white: 0, black: 0 },
    gameNum:     1,
    gameDbId:    status === "playing" ? "game-uuid" : undefined,
    gameState,
    ...extra,
  };
}

// White to move with one checker left and a 1 to play: bearing off wins.
function whiteWinsState() {
  const gs = initGame();
  gs.board = new Array(24).fill(0);
  gs.board[pathToIdx("white", 23)] = 1;
  gs.board[pathToIdx("black", 12)] = -15;
  gs.bar        = { white: 0, black: 0 };
  gs.off        = { white: 14, black: 0 };
  gs.turn       = "white";
  gs.phase      = "moving";
  gs.firstMove  = false;
  gs.dice       = [1];
  gs.rolledDice = [1, 3];
  gs.legalMoves = getLegalMoves(gs, "white");
  return gs;
}

async function putRoom(room) {
  await fakeRedis.set(`room:${room.roomId}`, JSON.stringify(room));
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

async function whiteBearsOff(roomId, whiteId) {
  const { gameState: gs } = await getRoom(roomId);
  const m = gs.legalMoves.find((x) => x.to === "off");
  await handleMessage({ msg: { type: "MOVE", ...m }, userId: whiteId, roomId, ws: null });
}

function winnerIdWritten() {
  const update = sqlCalls().find(({ sql }) => /UPDATE games\s+SET winner_id/.test(sql));
  expect(update).toBeDefined();
  return update.params[1];
}

beforeEach(() => {
  store.clear();
  broadcasts.length = 0;
  query.mockClear();
});

describe("match over", () => {
  test.each([
    ["guest beats guest",          { id: GUEST_A, info: guest("A") }, { id: GUEST_B, info: guest("B") }, {}, null],
    ["guest host beats user",      { id: GUEST_A, info: guest("A") }, { id: USER,    info: user("U") },  { guestColor: "white" }, null],
    ["user beats guest joiner",    { id: USER,    info: user("U") },  { id: GUEST_B, info: guest("B") }, {}, USER],
    // Rooms created before playerInfo.isGuest existed: guestColor decides.
    ["legacy: user beats guest",   { id: USER,    info: user("U") },  { id: GUEST_B, info: user("B") },  {}, USER],
    ["legacy: AI-guest wins",      { id: GUEST_A, info: user("A") },  { id: USER,    info: user("AI") }, { guestColor: "white", isAi: true }, null],
  ])("%s: winner_id is a user or null, nobody is rated", async (_label, white, black, extra, expected) => {
    await putRoom(makeRoom("GUEST001", { white, black, extra, gameState: whiteWinsState() }));
    await whiteBearsOff("GUEST001", white.id);

    const room = await getRoom("GUEST001");
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", unrated: true });
    expect(winnerIdWritten()).toBe(expected);
    for (const { sql } of sqlCalls()) expect(sql).not.toMatch(RATING_SQL);
  });
});

describe("START_GAME", () => {
  async function start(white, black) {
    await putRoom(makeRoom("GUEST002", { white, black, status: "waiting" }));
    await handleMessage({ msg: { type: "START_GAME" }, userId: white.id, roomId: "GUEST002", ws: null });
    const room = await getRoom("GUEST002");
    expect(room.status).toBe("playing");
    expect(room.gameDbId).toBe("game-uuid");
    for (const { sql } of sqlCalls()) expect(sql).not.toMatch(RATING_SQL);
    return sqlCalls().filter(({ sql }) => /UPDATE games/.test(sql));
  }

  test("guest host with a signed-in joiner links the joiner to the games row", async () => {
    const updates = await start({ id: GUEST_A, info: guest("A") }, { id: USER, info: user("U") });
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/SET black_id = \$2/);
    expect(updates[0].params).toEqual(["GUEST002", USER]);
  });

  test("guest vs guest writes no player ids", async () => {
    const updates = await start({ id: GUEST_A, info: guest("A") }, { id: GUEST_B, info: guest("B") });
    expect(updates).toHaveLength(0);
  });
});
