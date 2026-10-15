// ── AI turn: a trigger ends a backoff sleep at once (issue #87) ──────────────
// Redis, Postgres, the WebSocket layer and the move choice are fakes; timers
// are faked. Verifies that:
//   1. a trigger arriving while the loop sleeps a backoff delay wakes it, so
//      the AI reads the room again within 2 s and finishes the turn with the
//      dice it already has;
//   2. while Redis stays down, frequent triggers do not make the loop spin:
//      every attempt costs at least one thinking delay, and the loop settles
//      once the triggers stop.

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

const ROOM_ID   = "WAKE0001";
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

describe("AI turn wake", () => {
  test("a trigger during a backoff sleep resumes the turn within 2 s, without re-rolling", async () => {
    const room = makeRoom({ moving: true });
    store.set(`room:${ROOM_ID}`, JSON.stringify(room));
    failGets = true;
    jest.spyOn(Math, "random").mockReturnValue(0.5); // 1.1 s thinking delay

    const t = track(triggerAiTurn(ROOM_ID, "beginner"));
    // Passes fail at 1.1, 3.2, 6.3 and 11.4 s; the loop then sleeps 8 s.
    await runFor(12_000);
    expect(t.settled).toBe(false);
    expect(failedReads).toBeGreaterThanOrEqual(3);

    failGets = false;
    const readsBefore = roomReads;
    const again = track(triggerAiTurn(ROOM_ID, "beginner"));
    await runFor(2_000);
    expect(again.settled).toBe(true); // joined the running loop
    expect(roomReads).toBeGreaterThan(readsBefore);

    await runFor(30_000);
    expect(t.settled).toBe(true);
    expectTurnFinished(stored());
    expectOneRoll();
    expect(saves[0].gameState.rolledDice).toEqual(room.gameState.rolledDice);
  });

  test("frequent triggers during an outage do not make the loop spin, and it settles", async () => {
    // A room of its own, so a loop left over from another test cannot absorb
    // these triggers.
    const roomId = "WAKE0002";
    store.set(`room:${roomId}`, JSON.stringify({ ...makeRoom(), roomId }));
    failGets = true;

    const t = track(triggerAiTurn(roomId, "beginner"));
    for (let i = 0; i < 100; i++) {
      triggerAiTurn(roomId, "beginner");
      await jest.advanceTimersByTimeAsync(100);
    }
    // 10 s of triggers: at most one read per 0.7 s thinking delay.
    expect(failedReads).toBeGreaterThanOrEqual(1);
    expect(failedReads).toBeLessThanOrEqual(15);

    await runFor(120_000);
    expect(t.settled).toBe(true);
    expect(pendingRoomLockCount()).toBe(0);
    const readsBefore = roomReads;
    await runFor(120_000);
    expect(roomReads).toBe(readsBefore);
    expect(saves).toHaveLength(0);
  }, 60_000);
});
