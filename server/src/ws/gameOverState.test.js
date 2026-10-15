// ── Game-over state (issue #72) ──────────────────────────────────────────────
// After the match is over, the client kept saying "Your turn — move a checker"
// because the finished room's gameState still looked like a live turn: the
// winner (the last mover) was still `turn` with phase "moving" (or, after a
// resign, the resigner's live "rolling" phase).
//
// Contract checked here: once room.status is "finished", the saved AND the
// broadcast gameState must not describe a live turn. Its phase is neither
// "rolling" nor "moving", and legalMoves is empty. This must hold for every
// way a match can end: the last game won by bearing off, a jan on PASS, and
// RESIGN, in rated and tutorial rooms.
//
// A game that ends but does not end the match must, as before, start the next
// game at once: status stays "playing", gameNum goes up, and the loser of the
// game is to roll with no dice and no legal moves (§1).
//
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes.

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

// Everything the handlers broadcast, in order, deep-copied at send time.
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
  broadcastToRoom: (roomId, payload) =>
    broadcasts.push({ roomId, payload: JSON.parse(JSON.stringify(payload)) }),
  broadcastState:  (roomId, room) =>
    broadcasts.push({ roomId, payload: { type: "ROOM_STATE", room: JSON.parse(JSON.stringify(room)) } }),
}));

const { handleMessage } = await import("./handlers.js");
const { pathToIdx, getLegalMoves, initGame } = await import("../game/engine.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const WHITE_ID = "11111111-1111-1111-1111-111111111111";
const BLACK_ID = "22222222-2222-2222-2222-222222222222";

const LIVE_PHASES = ["rolling", "moving"];

function makeRoom(roomId, gameState, { matchLength = 1, gameNum = 1, isTutorial = false } = {}) {
  return {
    roomId,
    matchLength,
    createdBy:  WHITE_ID,
    isAi:       false,
    ...(isTutorial ? { isTutorial: true, gameDbId: null } : { gameDbId: "game-uuid" }),
    players:    { white: WHITE_ID, black: BLACK_ID },
    playerInfo: { white: { display_name: "Alice" }, black: { display_name: "Bob" } },
    ready:      { white: true, black: true },
    status:     "playing",
    score:      { white: 0, black: 0 },
    gameNum,
    gameResults: [],
    gameState,
  };
}

// White has 14 checkers off and its last one on path pos 23, with a 1 to play:
// the only legal move bears it off and wins by hemspel (§7). Black is spread
// over its own Quarter 4 with nothing borne off and nothing on the bar.
function whiteAboutToBearOffLast() {
  const gs = {
    board:      new Array(24).fill(0),
    bar:        { white: 0, black: 0 },
    off:        { white: 14, black: 0 },
    turn:       "white",
    phase:      "moving",
    dice:       [1],
    rolledDice: [1, 1, 1, 1],
    legalMoves: [],
    moveSeq:    40,
    firstMove:  false,
  };
  gs.board[pathToIdx("white", 23)] = 1;
  gs.board[pathToIdx("black", 18)] = -15;
  gs.legalMoves = getLegalMoves(gs, "white");
  return gs;
}

const BEAR_OFF = () => ({ type: "MOVE", from: pathToIdx("white", 23), to: "off", die: 1 });

async function putRoom(room) {
  await fakeRedis.set(`room:${room.roomId}`, JSON.stringify(room));
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

function fakeWs() {
  const sent = [];
  return { sent, ws: { readyState: 1, send: (s) => sent.push(JSON.parse(s)) } };
}

function lastRoomState(roomId) {
  const b = broadcasts.filter(x => x.roomId === roomId && x.payload.type === "ROOM_STATE");
  return b.at(-1)?.payload.room;
}

function expectNotALiveTurn(gs) {
  expect(gs).toBeTruthy();
  expect(LIVE_PHASES).not.toContain(gs.phase);
  expect(gs.legalMoves).toEqual([]);
}

beforeEach(() => {
  store.clear();
  broadcasts.length = 0;
  query.mockClear();
});

// ── Sanity check of the fixture ──────────────────────────────────────────────

test("fixture: white's only legal move bears off the last checker", () => {
  const gs = whiteAboutToBearOffLast();
  expect(gs.legalMoves).toEqual([{ from: pathToIdx("white", 23), to: "off", die: 1 }]);
});

// ── Match over ───────────────────────────────────────────────────────────────

describe.each([
  ["a rated room",    "GOVR0001", false],
  ["a tutorial room", "GOVT0001", true],
])("winning the last game of the match in %s", (_label, roomId, isTutorial) => {
  test("leaves no live turn in the saved or the broadcast gameState", async () => {
    await putRoom(makeRoom(roomId, whiteAboutToBearOffLast(), { isTutorial }));

    const { sent, ws } = fakeWs();
    await handleMessage({ msg: BEAR_OFF(), userId: WHITE_ID, roomId, ws });
    expect(sent).toEqual([]);

    const saved = await getRoom(roomId);
    expect(saved.status).toBe("finished");
    expect(saved.matchResult).toMatchObject({ winner: "white", winType: "hemspel" });
    expect(saved.gameState.off.white).toBe(15);   // final position is kept
    expectNotALiveTurn(saved.gameState);

    const broadcast = lastRoomState(roomId);
    expect(broadcast.status).toBe("finished");
    expectNotALiveTurn(broadcast.gameState);
  });
});

test("RESIGN ends the match with no live turn left in gameState", async () => {
  const gs = initGame();
  gs.turn      = "white";
  gs.phase     = "rolling";
  gs.firstMove = false;
  await putRoom(makeRoom("GOVRES01", gs, { matchLength: 3 }));

  const { sent, ws } = fakeWs();
  await handleMessage({ msg: { type: "RESIGN" }, userId: WHITE_ID, roomId: "GOVRES01", ws });
  expect(sent).toEqual([]);

  const saved = await getRoom("GOVRES01");
  expect(saved.status).toBe("finished");
  expect(saved.matchResult).toMatchObject({ winner: "black", winType: "resign" });
  expectNotALiveTurn(saved.gameState);
  expectNotALiveTurn(lastRoomState("GOVRES01").gameState);
});

test("a jan on PASS that ends the match leaves no live turn in gameState", async () => {
  // White is to move with three checkers on the bar and only two open entry
  // points (same position as pass.test.js): white is jan (§10).
  const gs = initGame();
  gs.turn      = "white";
  gs.phase     = "moving";
  gs.firstMove = false;
  gs.board = new Array(24).fill(0);
  for (const pos of [0, 1, 2, 3]) gs.board[pathToIdx("white", pos)] = 1;
  gs.board[pathToIdx("black", 18)] = -15;
  gs.bar        = { white: 3, black: 0 };
  gs.off        = { white: 0, black: 0 };
  gs.dice       = [];
  gs.rolledDice = [6, 5];
  gs.legalMoves = [];
  await putRoom(makeRoom("GOVJAN01", gs));

  const { sent, ws } = fakeWs();
  await handleMessage({ msg: { type: "PASS" }, userId: WHITE_ID, roomId: "GOVJAN01", ws });
  expect(sent).toEqual([]);

  const saved = await getRoom("GOVJAN01");
  expect(saved.status).toBe("finished");
  expect(saved.matchResult).toMatchObject({ winner: "black", winType: "jan" });
  expectNotALiveTurn(saved.gameState);
  expectNotALiveTurn(lastRoomState("GOVJAN01").gameState);
});

// ── Game over within a match (regression guard, passes on main) ──────────────

test("winning a game that does not end the match starts the next game with the loser to roll", async () => {
  await putRoom(makeRoom("GOVNXT01", whiteAboutToBearOffLast(), { matchLength: 3, gameNum: 1 }));

  const { sent, ws } = fakeWs();
  await handleMessage({ msg: BEAR_OFF(), userId: WHITE_ID, roomId: "GOVNXT01", ws });
  expect(sent).toEqual([]);

  const saved = await getRoom("GOVNXT01");
  expect(saved.status).toBe("playing");
  expect(saved.gameNum).toBe(2);
  expect(saved.score).toEqual({ white: 1, black: 0 });
  expect(saved.gameState).toMatchObject({ turn: "black", phase: "rolling", dice: [], legalMoves: [] });
  expect(saved.gameState.off).toEqual({ white: 0, black: 0 });

  // The new game's state goes out, followed by a GAME_OVER naming the winner.
  const mine = broadcasts.filter(b => b.roomId === "GOVNXT01").map(b => b.payload);
  const iState = mine.findIndex(p => p.type === "ROOM_STATE" && p.room.gameNum === 2);
  const iOver  = mine.findIndex(p => p.type === "GAME_OVER");
  expect(iState).toBeGreaterThanOrEqual(0);
  expect(iOver).toBeGreaterThan(iState);
  expect(mine[iOver]).toMatchObject({ winner: "white", winType: "hemspel", score: { white: 1, black: 0 } });
});
