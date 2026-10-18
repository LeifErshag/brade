// ── Game state after the match ends (issue #72) ──────────────────────────────
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes.
// When a match ends, the saved game state must not describe a live turn
// (phase "over", no legal moves) but must keep the final position. A game
// that does not end the match still starts the next game as before.

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
  ttl:    async () => 100,
};

const query = jest.fn(async () => ({ rows: [] }));
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
  broadcastState:  (_roomId, room) =>
    broadcasts.push({ type: "ROOM_STATE", room: JSON.parse(JSON.stringify(room)) }),
}));

const { handleMessage } = await import("./handlers.js");
const { initGame, pathToIdx, getLegalMoves } = await import("../game/engine.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const WHITE_ID = "11111111-1111-1111-1111-111111111111";
const BLACK_ID = "22222222-2222-2222-2222-222222222222";

function makeRoom(roomId, gameState, { matchLength = 1, gameNum = 1, isTutorial = false, hasGuest = false, isAi = false } = {}) {
  return {
    roomId,
    matchLength,
    createdBy:  WHITE_ID,
    ...(isTutorial ? { isTutorial: true, gameDbId: null } : { gameDbId: "game-uuid" }),
    ...(hasGuest ? { hasGuest: true, guestColor: "black" } : {}),
    ...(isAi ? { isAi: true } : {}),
    players:    { white: WHITE_ID, black: BLACK_ID },
    playerInfo: { white: { display_name: "Alice" }, black: { display_name: "Bob" } },
    ready:      { white: true, black: true },
    status:     "playing",
    score:      { white: 0, black: 0 },
    gameNum,
    gameState,
  };
}

// White to move with one checker left on its last point and a 1 to play:
// bearing it off wins the game.
function bearOffState() {
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

// White is to move, closed out on the bar: a PASS is jan against white (§10).
function janState() {
  const gs = initGame();
  gs.board = new Array(24).fill(0);
  for (const pos of [0, 1, 2, 3]) gs.board[pathToIdx("white", pos)] = 1;
  gs.board[pathToIdx("black", 18)] = -15;
  gs.bar        = { white: 3, black: 0 };
  gs.off        = { white: 0, black: 0 };
  gs.turn       = "white";
  gs.phase      = "moving";
  gs.firstMove  = false;
  gs.dice       = [];
  gs.rolledDice = [6, 5];
  gs.legalMoves = [];
  return gs;
}

async function putRoom(room) {
  await fakeRedis.set(`room:${room.roomId}`, JSON.stringify(room));
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

async function bearOff(roomId) {
  const { gameState: gs } = await getRoom(roomId);
  const m = gs.legalMoves.find((x) => x.to === "off");
  expect(m).toBeDefined();
  await handleMessage({ msg: { type: "MOVE", ...m }, userId: WHITE_ID, roomId, ws: null });
}

function expectOver(gs) {
  expect(gs.phase).toBe("over");
  expect(gs.legalMoves).toEqual([]);
}

function lastRoomState() {
  return broadcasts.filter((b) => b.type === "ROOM_STATE").at(-1).room;
}

beforeEach(() => {
  store.clear();
  broadcasts.length = 0;
  query.mockClear();
});

// ── Match over ───────────────────────────────────────────────────────────────

describe.each([
  ["a rated room",    { }],
  ["a guest room",    { hasGuest: true }],
  ["an AI room",      { isAi: true }],
  ["a tutorial room", { isTutorial: true }],
])("match won by a bear-off in %s", (_label, opts) => {
  test("saves and broadcasts phase over with the final position", async () => {
    await putRoom(makeRoom("OVER0001", bearOffState(), opts));
    await bearOff("OVER0001");

    const room = await getRoom("OVER0001");
    expect(room.status).toBe("finished");
    expect(room.matchResult.winner).toBe("white");
    expectOver(room.gameState);
    expect(room.gameState.off.white).toBe(15);

    const sent = lastRoomState();
    expect(sent.status).toBe("finished");
    expectOver(sent.gameState);
    expect(sent.gameState.off.white).toBe(15);
  });
});

test("jan on PASS ends the match with phase over", async () => {
  await putRoom(makeRoom("OVERJAN1", janState()));
  await handleMessage({ msg: { type: "PASS" }, userId: WHITE_ID, roomId: "OVERJAN1", ws: null });

  const room = await getRoom("OVERJAN1");
  expect(room.status).toBe("finished");
  expect(room.matchResult).toMatchObject({ winner: "black", winType: "jan" });
  expectOver(room.gameState);
  expect(room.gameState.bar.white).toBe(3);
});

test("RESIGN ends the match with phase over and keeps the position", async () => {
  const gs = bearOffState();
  await putRoom(makeRoom("OVERRES1", gs, { matchLength: 3 }));
  await handleMessage({ msg: { type: "RESIGN" }, userId: WHITE_ID, roomId: "OVERRES1", ws: null });

  const room = await getRoom("OVERRES1");
  expect(room.status).toBe("finished");
  expect(room.matchResult).toMatchObject({ winner: "black", winType: "resign" });
  expectOver(room.gameState);
  expect(room.gameState.board).toEqual(gs.board);
  expect(room.gameState.off).toEqual(gs.off);
});

test("a finished match rejects further moves", async () => {
  const live = bearOffState();
  const winningMove = live.legalMoves.find((x) => x.to === "off");
  await putRoom(makeRoom("OVERMOV1", live));
  await bearOff("OVERMOV1");
  const before = await fakeRedis.get("room:OVERMOV1");
  const broadcastsBefore = broadcasts.length;

  // The move that just won, replayed, and a move from the other player: a
  // finished match must not accept either, nor any other game action.
  const moves = [
    { type: "MOVE", ...winningMove },
    { type: "MOVE", from: pathToIdx("black", 12), to: pathToIdx("black", 13), die: 1 },
  ];
  for (const userId of [WHITE_ID, BLACK_ID]) {
    for (const msg of [...moves, { type: "ROLL" }, { type: "PASS" }, { type: "RESIGN" }]) {
      const sent = [];
      const ws = { send: (data) => sent.push(JSON.parse(data)) };
      await handleMessage({ msg, userId, roomId: "OVERMOV1", ws });
      expect(sent.filter((m) => m.type === "ROOM_STATE")).toEqual([]);
    }
  }
  expect(await fakeRedis.get("room:OVERMOV1")).toBe(before);
  expect(broadcasts.length).toBe(broadcastsBefore);
});

// ── Game over within a match ─────────────────────────────────────────────────

test("a game that does not end the match starts the next game as before", async () => {
  await putRoom(makeRoom("OVERNXT1", bearOffState(), { matchLength: 3 }));
  await bearOff("OVERNXT1");

  const room = await getRoom("OVERNXT1");
  expect(room.status).toBe("playing");
  expect(room.gameNum).toBe(2);
  expect(room.gameState.turn).toBe("black");
  expect(room.gameState.phase).toBe("rolling");
  expect(room.gameState.dice).toEqual([]);
  expect(room.gameState.legalMoves).toEqual([]);

  const types = broadcasts.map((b) => b.type);
  expect(types.indexOf("ROOM_STATE")).toBeLessThan(types.indexOf("GAME_OVER"));
});
