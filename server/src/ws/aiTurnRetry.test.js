// ── AI turn retry after a failed pass, and pickMove fallback (issue #79) ─────
// Redis, Postgres, the WebSocket layer and the move choice are fakes; timers
// are faked. Verifies that:
//   1. a pass that throws mid-turn (a failing Redis write in a move step)
//      with no rerun pending is retried, and the retry finishes the turn
//      with the dice already rolled, never re-rolling;
//   2. a trigger that finds the AI already moving continues with its dice;
//   3. when pickMove returns nothing, the AI still finishes its turn by
//      playing a legal move, with a bounded number of pickMove calls;
//   4. when Redis fails for good, the retries are bounded and end, the
//      stored room is left as last saved (or untouched, if the roll failed),
//      and a later trigger finishes the turn once Redis is back.

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order
let roomReads = 0;
let failedReads = 0;
let failGets = false;      // every room read throws while true
let failSets = 0;          // number of upcoming room writes that throw
let failSetsAfter = 0;     // ... after this many more writes succeed
const fakeRedis = {
  get: async (k) => {
    if (k.startsWith("room:")) {
      roomReads++;
      if (failGets) { failedReads++; throw new Error("redis read failed"); }
    }
    return store.get(k) ?? null;
  },
  set: async (k, v) => {
    if (k.startsWith("room:")) {
      if (failSetsAfter > 0) failSetsAfter--;
      else if (failSets > 0) { failSets--; throw new Error("redis write failed"); }
    }
    store.set(k, v);
    saves.push(JSON.parse(v));
    return "OK";
  },
  expire: async () => 1,
  ttl:    async () => 100,
  del:    async () => 1,
};

jest.unstable_mockModule("../db/postgres.js", () => ({
  query: jest.fn(async () => ({ rows: [{ elo: 1200 }] })),
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
  send:            () => {},
  sendToUser:      () => {},
  broadcastToRoom: () => {},
  broadcastState:  () => {},
}));

const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
const pickMove = jest.fn(async (gs, color, legalMoves) => legalMoves[0]);
jest.unstable_mockModule("../game/ai.js", () => ({
  AI_USER_ID,
  AI_DISPLAY:             { display_name: "Computer", avatar_url: null },
  MASTER_API_TIMEOUT_MS:  8_000,
  MASTER_API_MAX_RETRIES: 0,
  pickMove,
}));

const { triggerAiTurn } = await import("./handlers.js");
const { pendingRoomLockCount } = await import("./roomLock.js");
const { initGame, rollDice, getLegalMoves } = await import("../game/engine.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOM_ID   = "RETRY001";
const HUMAN_ID  = "11111111-1111-1111-1111-111111111111";
const START_SEQ = 10;

function makeRoom({ moving = false } = {}) {
  const gs = initGame();
  gs.turn      = "black";
  gs.phase     = "rolling";
  gs.firstMove = false;
  gs.moveSeq   = START_SEQ;
  if (moving) {
    const dice    = rollDice();
    gs.dice       = dice.slice();
    gs.rolledDice = dice.slice();
    gs.phase      = "moving";
    gs.legalMoves = getLegalMoves(gs, "black");
  }
  return {
    roomId:       ROOM_ID,
    matchLength:  3,
    createdBy:    HUMAN_ID,
    isAi:         true,
    aiDifficulty: "beginner",
    gameDbId:     "game-uuid",
    players:      { white: HUMAN_ID, black: AI_USER_ID },
    playerInfo:   { white: { display_name: "Human" }, black: { display_name: "Computer" } },
    ready:        { white: true, black: true },
    status:       "playing",
    score:        { white: 0, black: 0 },
    gameResults:  [],
    gameNum:      1,
    gameState:    gs,
  };
}

const stored = () => JSON.parse(store.get(`room:${ROOM_ID}`));

async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

function track(promise) {
  const t = { settled: false };
  promise.then(() => { t.settled = true; }, () => { t.settled = true; });
  return t;
}

function checkers(gs, color) {
  const onBoard = gs.board.reduce(
    (n, v) => n + (color === "white" ? Math.max(v, 0) : Math.max(-v, 0)), 0);
  return onBoard + gs.bar[color] + gs.off[color];
}

function expectTurnFinished(room) {
  const gs = room.gameState;
  expect(gs.turn).toBe("white");
  expect(gs.phase).toBe("rolling");
  expect(gs.dice).toEqual([]);
  expect(gs.legalMoves).toEqual([]);
  expect(gs.moveSeq).toBeGreaterThan(START_SEQ);
  expect(checkers(gs, "white")).toBe(15);
  expect(checkers(gs, "black")).toBe(15);
}

// Every black moving state saved shares one roll.
function expectOneRoll() {
  const rolls = new Set(saves
    .filter(r => r.gameState.turn === "black" && r.gameState.phase === "moving")
    .map(r => JSON.stringify(r.gameState.rolledDice)));
  expect(rolls.size).toBeLessThanOrEqual(1);
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  roomReads = 0;
  failedReads = 0;
  failGets = false;
  failSets = 0;
  failSetsAfter = 0;
  pickMove.mockReset();
  pickMove.mockImplementation(async (gs, color, legalMoves) => legalMoves[0]);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AI turn retry", () => {
  test("a pass failing in a move step is retried and finishes the turn without re-rolling", async () => {
    store.set(`room:${ROOM_ID}`, JSON.stringify(makeRoom()));
    failSetsAfter = 1; // the roll is saved, the first move's save fails
    failSets = 1;

    const t = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(30_000);

    expect(t.settled).toBe(true);
    expect(failSets).toBe(0);
    expectTurnFinished(stored());
    expectOneRoll();
  });

  test("a trigger finding the AI already moving continues with the same dice", async () => {
    const room = makeRoom({ moving: true });
    store.set(`room:${ROOM_ID}`, JSON.stringify(room));

    const t = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(30_000);

    expect(t.settled).toBe(true);
    expectTurnFinished(stored());
    expectOneRoll();
    expect(saves[0].gameState.rolledDice).toEqual(room.gameState.rolledDice);
  });

  test.each([
    ["once", () => pickMove.mockResolvedValueOnce(null)],
    ["always", () => pickMove.mockResolvedValue(undefined)],
  ])("pickMove returning nothing %s still finishes the turn", async (_label, setup) => {
    store.set(`room:${ROOM_ID}`, JSON.stringify(makeRoom()));
    setup();

    const t = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(30_000);

    expect(t.settled).toBe(true);
    const room = stored();
    expectTurnFinished(room);
    const movesPlayed = room.gameState.moveSeq - START_SEQ;
    expect(pickMove.mock.calls.length).toBeLessThanOrEqual(5 * movesPlayed);

    const calls = pickMove.mock.calls.length;
    await runFor(60_000);
    expect(pickMove.mock.calls.length).toBe(calls);
  });

  test("permanent failure in a move step gives up, keeps the last save and recovers later", async () => {
    store.set(`room:${ROOM_ID}`, JSON.stringify(makeRoom()));
    // Fail everything once the roll has been saved.
    const realSet = fakeRedis.set;
    fakeRedis.set = async (k, v) => {
      const r = await realSet(k, v);
      failGets = true;
      fakeRedis.set = async () => { throw new Error("redis write failed"); };
      return r;
    };

    const t = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(120_000);
    fakeRedis.set = realSet;

    expect(t.settled).toBe(true);
    expect(failedReads).toBeGreaterThanOrEqual(1);
    expect(failedReads).toBeLessThanOrEqual(10);
    expect(pendingRoomLockCount()).toBe(0);
    expect(saves).toHaveLength(1);
    expect(stored()).toEqual(saves[0]);
    const dice = saves[0].gameState.rolledDice;

    const readsBefore = roomReads;
    await runFor(600_000);
    expect(roomReads).toBe(readsBefore);

    failGets = false;
    const later = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(30_000);
    expect(later.settled).toBe(true);
    expectTurnFinished(stored());
    expectOneRoll();
    expect(saves[1].gameState.rolledDice).toEqual(dice);
  }, 60_000);

  test("permanent failure at the roll gives up and writes nothing", async () => {
    store.set(`room:${ROOM_ID}`, JSON.stringify(makeRoom()));
    failGets = true;

    const t = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(120_000);

    expect(t.settled).toBe(true);
    expect(failedReads).toBeGreaterThanOrEqual(1);
    expect(failedReads).toBeLessThanOrEqual(10);
    expect(saves).toHaveLength(0);
    expect(pendingRoomLockCount()).toBe(0);
  }, 60_000);
});
