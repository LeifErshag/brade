// ── An AI turn abandoned mid-turn must recover by itself (issue #79) ────────
// Redis, Postgres, the WebSocket layer and the AI's move choice (pickMove)
// are replaced with fakes, and timers are faked so the AI's "thinking" delays
// and any retry backoff run instantly.
//
// When a pass of the AI turn fails mid-turn (a Redis error in a move step) or
// the move choice yields no move (pickMove returns null/undefined), and no
// rerun is pending, nothing else would trigger the AI again: the game would
// stall with black to move. Verifies that:
//   1. after one transient Redis failure in the move step (a failing read or
//      a failing write), the AI still finishes its turn within a bounded time
//      with no further trigger, without re-rolling its dice;
//   2. when pickMove returns no move (once, or every time), the AI still
//      finishes its turn with legal moves, and pickMove is called a bounded
//      number of times;
//   3. with Redis failing permanently, the retries are bounded: within a
//      fixed time the trigger settles and the room is not read again, the room is left as
//      the last successful write left it, and once Redis recovers a new
//      trigger completes the turn (resuming the moving phase, not re-rolling).

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order: { key, room }
let roomReads = 0;  // number of room reads attempted (including failing ones)
let roomWrites = 0; // number of room writes attempted (including failing ones)
// Predicates on the 1-based index of the room read/write being attempted;
// true makes that attempt throw.
let failRead  = () => false;
let failWrite = () => false;

const fakeRedis = {
  get: async (k) => {
    if (k.startsWith("room:")) {
      roomReads++;
      if (failRead(roomReads)) throw new Error("redis read failed");
    }
    return store.get(k) ?? null;
  },
  set: async (k, v) => {
    if (k.startsWith("room:")) {
      roomWrites++;
      if (failWrite(roomWrites)) throw new Error("redis write failed");
    }
    store.set(k, v);
    saves.push({ key: k, room: JSON.parse(v) });
    return "OK";
  },
  expire: async () => 1,
  ttl:    async () => 100,
};

const query = jest.fn(async (sql) => {
  if (/SELECT elo FROM users/.test(sql)) return { rows: [{ elo: 1200 }] };
  return { rows: [] };
});

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
  broadcastToRoom: () => {},
  broadcastState:  () => {},
}));

// Fake move choice. By default it plays the first legal move it is given.
const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
const pickMove = jest.fn(async (gs, color, legalMoves) => legalMoves[0] ?? null);
jest.unstable_mockModule("../game/ai.js", () => ({
  AI_USER_ID,
  AI_DISPLAY: { display_name: "Computer", avatar_url: null },
  MASTER_API_TIMEOUT_MS:  8_000,
  MASTER_API_MAX_RETRIES: 0,
  pickMove,
}));

const { triggerAiTurn } = await import("./handlers.js");
const { pendingRoomLockCount } = await import("./roomLock.js");
const { initGame } = await import("../game/engine.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID  = "11111111-1111-1111-1111-111111111111";
const START_SEQ = 10;
// Time within which a turn hit by one transient failure must be finished.
const RECOVERY_MS = 30_000;
// Time within which a trigger must give up when Redis keeps failing.
const GIVE_UP_MS = 120_000;
// Upper bound on failing attempts while Redis keeps failing.
const MAX_FAILING_ATTEMPTS = 10;

function makeRoom(roomId) {
  const gs = initGame();
  gs.turn      = "black";
  gs.phase     = "rolling";
  gs.firstMove = false;
  gs.moveSeq   = START_SEQ;
  return {
    roomId,
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

function putRoom(roomId, room = makeRoom(roomId)) {
  store.set(`room:${roomId}`, JSON.stringify(room)); // not counted as a write
}

function getRoom(roomId) {
  return JSON.parse(store.get(`room:${roomId}`));
}

function savesOf(roomId) {
  return saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);
}

// Number of times the AI rolled and got moves to play (a rolling → moving
// transition for black between consecutive saved states).
function aiRollsWithMoves(roomId) {
  const history = [makeRoom(roomId), ...savesOf(roomId)];
  let n = 0;
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].gameState, cur = history[i].gameState;
    if (prev.turn === "black" && prev.phase === "rolling" &&
        cur.turn  === "black" && cur.phase  === "moving") n++;
  }
  return n;
}

function blackCheckers(gs) {
  const onBoard = gs.board.reduce((n, v) => n + (v < 0 ? -v : 0), 0);
  return onBoard + gs.bar.black + gs.off.black;
}

function whiteCheckers(gs) {
  const onBoard = gs.board.reduce((n, v) => n + (v > 0 ? v : 0), 0);
  return onBoard + gs.bar.white + gs.off.white;
}

// The AI's turn is complete and the room is consistent: white to roll, no
// dice or legal moves left over, all checkers accounted for, black's moves
// played from a single roll.
function expectTurnFinished(roomId) {
  const room = getRoom(roomId);
  expect(room.status).toBe("playing");
  expect(room.gameState.turn).toBe("white");
  expect(room.gameState.phase).toBe("rolling");
  expect(room.gameState.dice).toEqual([]);
  expect(room.gameState.legalMoves).toEqual([]);
  expect(room.gameState.moveSeq).toBeGreaterThan(START_SEQ);
  expect(blackCheckers(room.gameState)).toBe(15);
  expect(whiteCheckers(room.gameState)).toBe(15);
  expect(aiRollsWithMoves(roomId)).toBe(1);
  return room;
}

// Advance fake time in small steps, letting promises settle between timers.
async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

// Advance until `cond()` holds or `ms` has passed; returns the time it took.
async function runUntil(cond, ms) {
  let t = 0;
  while (!cond() && t < ms) { await jest.advanceTimersByTimeAsync(100); t += 100; }
  return t;
}

function track(promise) {
  const t = { settled: false };
  promise.then(() => { t.settled = true; }, () => { t.settled = true; });
  return t;
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  roomReads = 0;
  roomWrites = 0;
  failRead  = () => false;
  failWrite = () => false;
  query.mockClear();
  pickMove.mockReset();
  pickMove.mockImplementation(async (gs, color, legalMoves) => legalMoves[0] ?? null);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  failRead  = () => false;
  failWrite = () => false;
  await runFor(GIVE_UP_MS);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── 1. One transient Redis failure in the move step ─────────────────────────

describe("a pass of the AI turn that fails mid-turn with no rerun pending", () => {
  // The AI's first room read is its roll; the second is its first move step.
  // Likewise its first room write is the roll and the second the first move.
  test.each([
    ["read",  () => { failRead  = (n) => n === 2; }],
    ["write", () => { failWrite = (n) => n === 2; }],
  ])("the AI still finishes its turn without another trigger (failing %s)", async (_kind, arm) => {
    const roomId = "RECOV001";
    putRoom(roomId);
    arm();

    const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runUntil(() => getRoom(roomId).gameState.turn === "white", RECOVERY_MS);

    // The failure happened, and the room was left black to move by it.
    expect(roomReads + roomWrites).toBeGreaterThan(2);
    expectTurnFinished(roomId);

    await runFor(RECOVERY_MS);
    expect(turn.settled).toBe(true);
    expect(pendingRoomLockCount()).toBe(0);
  }, 60_000);

  test("the retry does not re-roll: the moves played use the dice of the one roll", async () => {
    const roomId = "RECOV002";
    putRoom(roomId);
    failRead = (n) => n === 2;

    triggerAiTurn(roomId, "beginner").catch(() => {});
    await runUntil(() => getRoom(roomId).gameState.turn === "white", RECOVERY_MS);

    const history = savesOf(roomId);
    const rolled = history[0].gameState.rolledDice;
    expect(history[0].gameState).toMatchObject({ turn: "black", phase: "moving" });
    // Every black moving state saved afterwards belongs to that roll.
    for (const s of history.filter((r) => r.gameState.turn === "black")) {
      expect(s.gameState.rolledDice).toEqual(rolled);
    }
    expectTurnFinished(roomId);
  }, 60_000);
});

// ── 2. pickMove yields no move ───────────────────────────────────────────────

describe("pickMove returning no move", () => {
  test.each([["null", null], ["undefined", undefined]])(
    "once (%s): the AI still finishes its turn without another trigger",
    async (_label, value) => {
      const roomId = "NOMOVE01";
      putRoom(roomId);
      pickMove.mockImplementationOnce(async () => value);

      const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
      await runUntil(() => getRoom(roomId).gameState.turn === "white", RECOVERY_MS);

      expect(pickMove).toHaveBeenCalled(); // the no-move answer was given
      expectTurnFinished(roomId);

      await runFor(RECOVERY_MS);
      expect(turn.settled).toBe(true);
      expect(pendingRoomLockCount()).toBe(0);
    }, 60_000);

  test.each([["null", null], ["undefined", undefined]])(
    "every time (%s): the AI falls back to legal moves, finishes its turn, and calls pickMove a bounded number of times",
    async (_label, value) => {
      const roomId = "NOMOVE02";
      putRoom(roomId);
      pickMove.mockImplementation(async () => value);

      const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
      await runUntil(() => getRoom(roomId).gameState.turn === "white", RECOVERY_MS);

      const room = expectTurnFinished(roomId);
      const movesPlayed = room.gameState.moveSeq - START_SEQ;
      expect(movesPlayed).toBeGreaterThan(0);
      // At most a few attempts per move played, never an unbounded loop.
      expect(pickMove.mock.calls.length).toBeLessThanOrEqual(5 * movesPlayed);

      await runFor(RECOVERY_MS);
      expect(turn.settled).toBe(true);
      const calls = pickMove.mock.calls.length;
      await runFor(GIVE_UP_MS);
      expect(pickMove.mock.calls.length).toBe(calls);
    }, 120_000);
});

// ── 3. Redis failing permanently ─────────────────────────────────────────────

describe("Redis failing permanently during the AI turn", () => {
  test("in the move step: retries are bounded and the room is left as last saved, then a later trigger finishes the turn", async () => {
    const roomId = "PERMFL01";
    putRoom(roomId);
    // The roll succeeds; every room read after it fails.
    failRead = (n) => n >= 2;

    // All retries are over within GIVE_UP_MS of the trigger, whether they
    // run inside the trigger's promise or on timers of their own.
    const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runFor(GIVE_UP_MS);
    expect(turn.settled).toBe(true);

    // Bounded number of attempts.
    const failingReads = roomReads - 1;
    expect(failingReads).toBeGreaterThanOrEqual(1);
    expect(failingReads).toBeLessThanOrEqual(MAX_FAILING_ATTEMPTS);

    // No further attempts after that.
    const readsAtSettle = roomReads;
    await runFor(10 * 60_000);
    expect(roomReads).toBe(readsAtSettle);

    // The room is left exactly as the roll saved it: black to move.
    expect(savesOf(roomId)).toHaveLength(1);
    const afterRoll = savesOf(roomId)[0];
    expect(getRoom(roomId)).toEqual(afterRoll);
    expect(afterRoll.gameState).toMatchObject({ turn: "black", phase: "moving" });
    expect(afterRoll.gameState.legalMoves.length).toBeGreaterThan(0);
    expect(pendingRoomLockCount()).toBe(0);

    // Redis recovers: a new trigger resumes the moving phase with the dice
    // already rolled, and finishes the turn.
    failRead = () => false;
    const later = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runUntil(() => getRoom(roomId).gameState.turn === "white", RECOVERY_MS);
    expectTurnFinished(roomId);
    for (const s of savesOf(roomId).filter((r) => r.gameState.turn === "black")) {
      expect(s.gameState.rolledDice).toEqual(afterRoll.gameState.rolledDice);
    }
    await runFor(RECOVERY_MS);
    expect(later.settled).toBe(true);
  }, 240_000);

  test("from the roll: retries are bounded, nothing is written, then a later trigger plays the turn", async () => {
    const roomId = "PERMFL02";
    putRoom(roomId);
    failRead = () => true;

    // All retries are over within GIVE_UP_MS of the trigger, whether they
    // run inside the trigger's promise or on timers of their own.
    const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runFor(GIVE_UP_MS);
    expect(turn.settled).toBe(true);

    expect(roomReads).toBeGreaterThanOrEqual(1);
    expect(roomReads).toBeLessThanOrEqual(MAX_FAILING_ATTEMPTS);
    const readsAtSettle = roomReads;
    await runFor(10 * 60_000);
    expect(roomReads).toBe(readsAtSettle);

    expect(savesOf(roomId)).toHaveLength(0);
    expect(getRoom(roomId)).toEqual(makeRoom(roomId));
    expect(pendingRoomLockCount()).toBe(0);

    failRead = () => false;
    triggerAiTurn(roomId, "beginner").catch(() => {});
    await runUntil(() => getRoom(roomId).gameState.turn === "white", RECOVERY_MS);
    expectTurnFinished(roomId);
  }, 240_000);
});
