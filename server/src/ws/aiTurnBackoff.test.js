// ── AI turn retry backoff: timing (issue #87) ───────────────────────────────
// Redis, Postgres, the WebSocket layer and the move choice are fakes; timers
// are faked. The AI waits a "thinking" delay of 0.7-1.5 s before each pass,
// and a failed pass is retried after a backoff of 1, 2, 4, 8 and then 16 s.
// Every room read is timestamped, so the gap between a failing attempt and
// the next one shows how long the loop waited in between. Verifies that:
//   1. the backoff restarts from its shortest delay after a successful pass:
//      in one trigger's loop, a failure that follows a success (the success
//      had a rerun pending) is retried after the shortest delay again;
//   2. a rerun requested while a pass was failing runs at once after that
//      pass, without waiting out a backoff delay;
//   3. a trigger that arrives while the loop sleeps in a backoff delay cuts
//      that sleep short: once Redis is back, the AI resumes within about one
//      thinking delay of the trigger (e.g. a player's reconnect), not up to
//      16 s later, and finishes its turn with the dice it already rolled;
//      the trigger itself returns at once (it joins the running loop), also
//      when the dice were rolled before the loop started;
//   4. a second trigger still wakes a later backoff sleep: after one trigger
//      woke the loop and the next pass failed, the timer of the sleep it cut
//      short must not clear the wake of the longer sleep that follows;
//   5. triggers while Redis stays down do not make the loop spin, whether
//      they come every 3 s or every 100 ms: every attempt costs at least one
//      thinking delay, and the loop settles once the triggers stop.

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = [];     // every room state written, in order: { key, room }
const reads = [];     // every room read attempted: { at, failed }
// Decides whether the room read being attempted throws. Gets the 1-based
// index of the read.
let failRead = () => false;

const fakeRedis = {
  get: async (k) => {
    if (k.startsWith("room:")) {
      const n = reads.length + 1;
      const failed = failRead(n);
      reads.push({ at: Date.now(), failed });
      if (failed) throw new Error("redis read failed");
    }
    return store.get(k) ?? null;
  },
  set: async (k, v) => {
    store.set(k, v);
    saves.push({ key: k, room: JSON.parse(v) });
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
  pickMove,
}));

const { triggerAiTurn } = await import("./handlers.js");
const { pendingRoomLockCount } = await import("./roomLock.js");
const { initGame, getLegalMoves } = await import("../game/engine.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID  = "11111111-1111-1111-1111-111111111111";
const START_SEQ = 10;
// The thinking delay before each pass is at most this long.
const MAX_THINK_MS = 1_500;
// The shortest backoff delay.
const SHORTEST_BACKOFF_MS = 1_000;
// Fake time advances in steps of this size, so measured gaps can be off by
// up to one step.
const STEP_MS = 100;

// dice: the AI has already rolled these (they are in the saved state).
function makeRoom(roomId, { dice = null } = {}) {
  const gs = initGame();
  gs.turn      = "black";
  gs.phase     = "rolling";
  gs.firstMove = false;
  gs.moveSeq   = START_SEQ;
  if (dice) {
    gs.dice       = dice.slice();
    gs.rolledDice = dice.slice();
    gs.phase      = "moving";
    gs.legalMoves = getLegalMoves(gs, "black");
  }
  return {
    roomId,
    matchLength:  3,
    createdBy:    HUMAN_ID,
    isAi:         true,
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

function putRoom(roomId, opts) {
  const room = makeRoom(roomId, opts);
  store.set(`room:${roomId}`, JSON.stringify(room));
  return room;
}

const getRoom = (roomId) => JSON.parse(store.get(`room:${roomId}`));
const savesOf = (roomId) =>
  saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);

function checkers(gs, color) {
  const onBoard = gs.board.reduce(
    (n, v) => n + (color === "white" ? Math.max(v, 0) : Math.max(-v, 0)), 0);
  return onBoard + gs.bar[color] + gs.off[color];
}

function expectTurnFinished(roomId) {
  const gs = getRoom(roomId).gameState;
  expect(gs.turn).toBe("white");
  expect(gs.phase).toBe("rolling");
  expect(gs.dice).toEqual([]);
  expect(gs.legalMoves).toEqual([]);
  expect(gs.moveSeq).toBeGreaterThan(START_SEQ);
  expect(checkers(gs, "white")).toBe(15);
  expect(checkers(gs, "black")).toBe(15);
}

// Every black state saved belongs to a single roll.
function expectOneRoll(roomId) {
  const rolls = new Set(savesOf(roomId)
    .filter((r) => r.gameState.turn === "black")
    .map((r) => JSON.stringify(r.gameState.rolledDice)));
  expect(rolls.size).toBe(1);
}

async function runFor(ms) {
  for (let t = 0; t < ms; t += STEP_MS) await jest.advanceTimersByTimeAsync(STEP_MS);
}

async function runUntil(cond, ms) {
  let t = 0;
  while (!cond() && t < ms) { await jest.advanceTimersByTimeAsync(STEP_MS); t += STEP_MS; }
  return t;
}

function track(promise) {
  const t = { settled: false };
  promise.then(() => { t.settled = true; }, () => { t.settled = true; });
  return t;
}

// Time from the read at index i (0-based) to the next read.
const gapAfter = (i) => reads[i + 1].at - reads[i].at;

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  reads.length = 0;
  failRead = () => false;
  pickMove.mockReset();
  pickMove.mockImplementation(async (gs, color, legalMoves) => legalMoves[0]);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  failRead = () => false;
  await runFor(120_000);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── 1. The backoff restarts after a successful pass ─────────────────────────

describe("AI retry backoff", () => {
  test("restarts from the shortest delay after a successful pass (fail, success, fail in one loop)", async () => {
    const roomId = "BACKOF01";
    putRoom(roomId);
    // Read 1 (the first pass's roll) fails. The retry plays the whole turn.
    // The first read after the turn has been saved as finished (by the rerun
    // requested during the successful pass) fails too.
    let turnDoneFailed = false;
    failRead = (n) => {
      if (n === 1) return true;
      if (!turnDoneFailed && getRoom(roomId).gameState.turn === "white") {
        turnDoneFailed = true;
        return true;
      }
      return false;
    };

    const turn = track(triggerAiTurn(roomId));
    // The retry has read the room and saved its roll: the successful pass is
    // under way. A trigger now asks for a rerun after it.
    await runUntil(() => savesOf(roomId).length >= 1, 30_000);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads[0].failed).toBe(true);
    expect(getRoom(roomId).gameState).toMatchObject({ turn: "black", phase: "moving" });
    triggerAiTurn(roomId);

    await runUntil(() => turn.settled, 60_000);
    expect(turn.settled).toBe(true);
    expectTurnFinished(roomId);
    expectOneRoll(roomId);

    // The rerun's read failed and was retried by the same loop.
    expect(turnDoneFailed).toBe(true);
    const second = reads.findIndex((r, i) => i > 0 && r.failed);
    expect(second).toBeGreaterThan(1);
    expect(reads.length).toBeGreaterThan(second + 1);

    // Both failures are retried after the shortest backoff (plus a thinking
    // delay): the success in between reset the count of failures. Without
    // the reset the second retry waits the next delay (2 s) instead.
    const bound = SHORTEST_BACKOFF_MS + MAX_THINK_MS + STEP_MS;
    expect(gapAfter(0)).toBeLessThanOrEqual(bound);
    expect(gapAfter(second)).toBeLessThanOrEqual(bound);
    expect(pendingRoomLockCount()).toBe(0);
  }, 120_000);

  // ── 2. A rerun pending after a failed pass runs at once ──────────────────

  test("a rerun requested during a failing pass runs at once after it, without a backoff delay", async () => {
    const roomId = "BACKOF02";
    putRoom(roomId);
    failRead = (n) => n === 1; // the first pass fails at its roll

    const turn = track(triggerAiTurn(roomId));
    // A second trigger while the first pass is still thinking: a rerun is
    // pending when that pass fails.
    triggerAiTurn(roomId);

    await runUntil(() => turn.settled, 60_000);
    expect(turn.settled).toBe(true);
    expect(reads[0].failed).toBe(true);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    // The rerun starts straight after the failure: only its thinking delay
    // separates the two reads, no backoff on top of it.
    expect(gapAfter(0)).toBeLessThanOrEqual(MAX_THINK_MS + STEP_MS);
    expectTurnFinished(roomId);
    expectOneRoll(roomId);
    expect(pendingRoomLockCount()).toBe(0);
  }, 120_000);
});

// ── 3. A trigger cuts a backoff sleep short ─────────────────────────────────

describe("a trigger arriving during a backoff sleep", () => {
  // Resuming within this long of the trigger is "about one thinking delay".
  const RESUME_MS = 2_000;

  // failingAttempts: how many attempts fail before Redis recovers; the loop
  // is then sleeping the backoff that follows the last of them (4 s after the
  // third failure, 16 s after the fifth).
  test.each([[3], [5]])(
    "after %i failures: once Redis is back the AI resumes within about a thinking delay of the trigger and finishes its turn",
    async (failingAttempts) => {
      const roomId = `WAKEUP0${failingAttempts}`;
      putRoom(roomId);
      // The roll (read 1) succeeds; the move steps fail until `recovered`.
      let recovered = false;
      failRead = (n) => n >= 2 && !recovered;

      const turn = track(triggerAiTurn(roomId));
      await runUntil(() => reads.filter((r) => r.failed).length >= failingAttempts, 60_000);
      expect(reads.filter((r) => r.failed)).toHaveLength(failingAttempts);
      const readsBefore = reads.length;

      // The loop is now sleeping its backoff. Let a moment pass, then Redis
      // recovers and the human reconnects (which triggers the AI).
      await runFor(500);
      expect(reads.length).toBe(readsBefore); // still sleeping
      recovered = true;
      const triggeredAt = Date.now();
      const again = track(triggerAiTurn(roomId));
      await jest.advanceTimersByTimeAsync(0);
      expect(again.settled).toBe(true); // joined the running loop

      await runUntil(() => reads.length > readsBefore, 30_000);
      expect(reads.length).toBeGreaterThan(readsBefore);
      expect(reads[readsBefore].at - triggeredAt).toBeLessThanOrEqual(RESUME_MS);

      // The resumed pass finishes the turn with the dice already rolled.
      await runUntil(() => getRoom(roomId).gameState.turn === "white", 30_000);
      expectTurnFinished(roomId);
      expectOneRoll(roomId);
      expect(Date.now() - triggeredAt).toBeLessThanOrEqual(RESUME_MS + 4 * 1_000);

      await runUntil(() => turn.settled, 60_000);
      expect(turn.settled).toBe(true);
      expect(pendingRoomLockCount()).toBe(0);
    }, 180_000);

  test("with dice rolled before the loop started: a trigger during a backoff sleep resumes the turn without re-rolling", async () => {
    const roomId = "WAKEUP04";
    // Fixed dice with two moves to play, so the resumed pass saves a black
    // state before its last move. A random roll made this flaky (#192): on
    // 6-6 black has a single legal move from the start position, which ends
    // the turn, so no black state was ever saved.
    const dice = [3, 1];
    putRoom(roomId, { dice });
    let recovered = false;
    failRead = () => !recovered; // every read fails until Redis is back

    const turn = track(triggerAiTurn(roomId));
    // After the fourth failure the loop sleeps 8 s.
    await runUntil(() => reads.filter((r) => r.failed).length >= 4, 60_000);
    expect(reads.filter((r) => r.failed)).toHaveLength(4);
    const readsBefore = reads.length;

    recovered = true;
    const triggeredAt = Date.now();
    const again = track(triggerAiTurn(roomId));
    await jest.advanceTimersByTimeAsync(0);
    expect(again.settled).toBe(true); // joined the running loop
    await runUntil(() => reads.length > readsBefore, 30_000);
    expect(reads[readsBefore].at - triggeredAt).toBeLessThanOrEqual(RESUME_MS);

    await runUntil(() => turn.settled, 60_000);
    expect(turn.settled).toBe(true);
    expectTurnFinished(roomId);
    expectOneRoll(roomId);
    // Never re-rolled: every state saved, the finished turn included, keeps
    // the dice rolled before the loop started.
    for (const r of savesOf(roomId)) expect(r.gameState.rolledDice).toEqual(dice);
    expect(pendingRoomLockCount()).toBe(0);
  }, 180_000);

  // ── 4. Two wakes in a row during an outage ──────────────────────────────

  test("a second trigger still wakes the loop after an earlier trigger woke it and the next pass failed", async () => {
    const roomId = "WAKEUP10";
    putRoom(roomId);
    // The roll (read 1) succeeds; the move steps fail until `recovered`.
    let recovered = false;
    failRead = (n) => n >= 2 && !recovered;
    const failedReads = () => reads.filter((r) => r.failed);

    const turn = track(triggerAiTurn(roomId));
    // After the third failure the loop sleeps 4 s.
    await runUntil(() => failedReads().length >= 3, 60_000);
    expect(failedReads()).toHaveLength(3);
    const thirdFailAt = failedReads()[2].at;

    // A first trigger wakes that sleep while Redis is still down: the pass
    // it starts fails, and the loop enters the 8 s sleep.
    await runFor(500);
    triggerAiTurn(roomId);
    await runUntil(() => failedReads().length >= 4, 30_000);
    expect(failedReads()).toHaveLength(4);
    const fourthFailAt = failedReads()[3].at;
    expect(fourthFailAt - thirdFailAt).toBeLessThanOrEqual(500 + MAX_THINK_MS + STEP_MS);

    // Let the 4 s timer of the sleep that was cut short come due. The loop
    // is still in its 8 s sleep.
    await runUntil(() => Date.now() - thirdFailAt >= 4_000 + 2 * STEP_MS, 10_000);
    const readsBefore = reads.length;
    expect(Date.now() - fourthFailAt).toBeLessThan(8_000 - RESUME_MS);

    // Redis recovers and a second trigger arrives: it must wake the 8 s
    // sleep, not wait it out.
    recovered = true;
    const triggeredAt = Date.now();
    triggerAiTurn(roomId);
    await runUntil(() => reads.length > readsBefore, 30_000);
    expect(reads.length).toBeGreaterThan(readsBefore);
    expect(reads[readsBefore].at - triggeredAt).toBeLessThanOrEqual(RESUME_MS);

    await runUntil(() => turn.settled, 60_000);
    expect(turn.settled).toBe(true);
    expectTurnFinished(roomId);
    expectOneRoll(roomId);
    expect(pendingRoomLockCount()).toBe(0);
  }, 180_000);

  // ── 5. No spin under triggers during an outage ──────────────────────────

  test("a trigger while Redis is still down does not make the loop spin: attempts stay bounded", async () => {
    const roomId = "WAKEUP09";
    putRoom(roomId);
    failRead = (n) => n >= 2; // every move step fails for good

    const turn = track(triggerAiTurn(roomId));
    // A trigger every 3 s for a minute, each one possibly cutting a sleep
    // short; each attempt still costs at least a thinking delay.
    for (let i = 0; i < 20; i++) {
      await runFor(3_000);
      triggerAiTurn(roomId);
    }
    await runFor(120_000);
    expect(turn.settled).toBe(true);
    // At most one attempt per thinking delay (0.7 s) over the minute, plus
    // the retries after the last trigger.
    expect(reads.length).toBeLessThanOrEqual(1 + Math.ceil(60_000 / 700) + 10);
    const readsAtSettle = reads.length;
    await runFor(600_000);
    expect(reads.length).toBe(readsAtSettle);
    expect(getRoom(roomId).gameState).toMatchObject({ turn: "black", phase: "moving" });
    expect(pendingRoomLockCount()).toBe(0);
  }, 240_000);

  test("a trigger every 100 ms while Redis is down does not make the loop spin, and it settles without writing", async () => {
    const roomId = "WAKEUP11";
    putRoom(roomId);
    failRead = () => true; // every read fails, the roll included

    const turn = track(triggerAiTurn(roomId));
    for (let i = 0; i < 100; i++) {
      triggerAiTurn(roomId);
      await jest.advanceTimersByTimeAsync(100);
    }
    // 10 s of triggers: at most one read per 0.7 s thinking delay.
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(reads.length).toBeLessThanOrEqual(15);

    await runFor(120_000);
    expect(turn.settled).toBe(true);
    expect(pendingRoomLockCount()).toBe(0);
    const readsAtSettle = reads.length;
    await runFor(120_000);
    expect(reads.length).toBe(readsAtSettle);
    expect(savesOf(roomId)).toHaveLength(0);
  }, 240_000);
});
