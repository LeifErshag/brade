// ── Re-validation of the AI's chosen move before it is applied (issue #82) ──
// Redis, Postgres, the WebSocket layer and the AI's move choice (pickMove)
// are replaced with fakes, and timers are faked so the AI's "thinking" delays
// run instantly. Each test drives one AI turn with triggerAiTurn.
//
// Verifies that:
//   1. when the room is unchanged but pickMove answers a move that is not in
//      legalMoves, the AI plays the first legal move instead (never the
//      illegal one), does not ask pickMove again for that move, and finishes
//      its turn;
//   2. when another writer has ended the AI's move while it was choosing
//      (the turn passed to white, or the phase is no longer "moving"), the AI
//      writes nothing and stops, even though the stored state still has dice
//      and legal moves;
//   3. when the match has finished while the AI was choosing, but the stored
//      game state is still black/"moving" with legal moves, the AI writes
//      nothing and stops (no endless re-pick).

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order: { key, room }
let roomReads = 0;

const fakeRedis = {
  get: async (k) => {
    if (k.startsWith("room:")) roomReads++;
    return store.get(k) ?? null;
  },
  set: async (k, v) => {
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
const { initGame, getLegalMoves } = await import("../game/engine.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID  = "11111111-1111-1111-1111-111111111111";
const START_SEQ = 10;
const TURN_MS   = 30_000;

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
  store.set(`room:${roomId}`, JSON.stringify(room)); // not counted as a save
}

function getRoom(roomId) {
  return JSON.parse(store.get(`room:${roomId}`));
}

function savesOf(roomId) {
  return saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);
}

function moveLogs() {
  return query.mock.calls.filter(([sql]) => /INSERT INTO moves/.test(sql)).map(([, p]) => p);
}

// The params of the move log row for `move` (points are 1-based).
function logParams(seq, move) {
  return [
    "game-uuid", seq, "black",
    move.from === "bar" ? "bar" : String(move.from + 1),
    move.to   === "off" ? "off" : String(move.to + 1),
    move.die,
  ];
}

function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && a.die === b.die;
}

function checkers(gs, color) {
  const onBoard = gs.board.reduce(
    (n, v) => n + (color === "white" ? (v > 0 ? v : 0) : (v < 0 ? -v : 0)), 0);
  return onBoard + gs.bar[color] + gs.off[color];
}

// Advance fake time in small steps, letting promises settle between timers.
async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

// Advance until `cond()` holds or `ms` has passed.
async function runUntil(cond, ms) {
  for (let t = 0; !cond() && t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

function track(promise) {
  const t = { settled: false };
  promise.then(() => { t.settled = true; }, () => { t.settled = true; });
  return t;
}

// Make the first pickMove call behave as if another writer replaced the room
// while the AI was choosing: `change` gets a copy of the room as the AI's roll
// saved it and returns the newer room, which is stored before pickMove answers
// the first legal move of the old position. Later calls play legalMoves[0].
function changeRoomDuringFirstPick(roomId, change) {
  const h = {};
  pickMove.mockImplementationOnce(async (gs, color, legalMoves) => {
    h.newer = change(getRoom(roomId));
    putRoom(roomId, h.newer);
    h.savesAfterChange = savesOf(roomId).length;
    h.readsAfterChange = roomReads;
    return legalMoves[0];
  });
  return h;
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  roomReads = 0;
  query.mockClear();
  pickMove.mockReset();
  pickMove.mockImplementation(async (gs, color, legalMoves) => legalMoves[0] ?? null);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  // Removing the rooms ends an AI turn that is still looping (in a broken
  // build), so it cannot leak into the next test.
  store.clear();
  await runFor(TURN_MS);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── 1. Unchanged room, illegal pick ──────────────────────────────────────────

describe("pickMove answering a move that is not legal, in an unchanged room", () => {
  test.each([
    ["a die that was not rolled", (legal) => ({ ...legal[0], die: 7 })],
    ["a move from an empty bar",  (legal) => ({ from: "bar", to: legal[0].to, die: legal[0].die })],
  ])("(%s): the first legal move is played instead and the turn finishes", async (_label, illegal) => {
    const roomId = "ILLEGAL1";
    putRoom(roomId);
    const offered = []; // the legal moves offered to each pickMove call
    let pickedLegal = false;
    pickMove.mockImplementation(async (gs, color, legalMoves) => {
      offered.push(legalMoves);
      const move = illegal(legalMoves);
      if (legalMoves.some((m) => sameMove(m, move))) pickedLegal = true;
      return move;
    });

    const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runUntil(() => getRoom(roomId).gameState.turn === "white", TURN_MS);

    expect(pickedLegal).toBe(false);
    // Each move played is the first legal move of its position, logged in
    // sequence; pickMove was asked exactly once per move (no re-pick).
    const logs = moveLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.length).toBeLessThanOrEqual(4);
    expect(pickMove).toHaveBeenCalledTimes(logs.length);
    logs.forEach((params, i) => {
      expect(params).toEqual(logParams(START_SEQ + 1 + i, offered[i][0]));
    });

    // No saved state was corrupted by an illegal move.
    for (const r of savesOf(roomId)) {
      expect(r.gameState.bar.black).toBeGreaterThanOrEqual(0);
      expect(checkers(r.gameState, "black")).toBe(15);
      expect(checkers(r.gameState, "white")).toBe(15);
    }

    // The turn is over: white to roll, nothing left over.
    const room = getRoom(roomId);
    expect(room.status).toBe("playing");
    expect(room.gameState).toMatchObject({ turn: "white", phase: "rolling", dice: [], legalMoves: [] });
    expect(room.gameState.moveSeq).toBe(START_SEQ + logs.length);

    await runFor(TURN_MS);
    expect(turn.settled).toBe(true);
    expect(pickMove).toHaveBeenCalledTimes(logs.length);
    expect(pendingRoomLockCount()).toBe(0);
  }, 60_000);
});

// ── 2. The AI's move was ended by another writer while it was choosing ──────

describe("no longer the AI's move when its pick returns", () => {
  test.each([
    // White has rolled and is mid-turn: the dice and legal moves are white's.
    ["the turn passed to white, who is moving with dice and legal moves", (r) => {
      const gs = r.gameState;
      gs.turn       = "white";
      gs.phase      = "moving";
      gs.dice       = [3, 5];
      gs.rolledDice = [3, 5];
      gs.moveSeq   += 2;
      gs.legalMoves = getLegalMoves(gs, "white");
      return r;
    }],
    // White is to roll, but stale dice and legal moves are still stored.
    ["the turn passed to white, with stale dice and legal moves stored", (r) => {
      const gs = r.gameState;
      gs.turn     = "white";
      gs.phase    = "rolling";
      gs.moveSeq += 2;
      return r;
    }],
    // Black, but the phase is "rolling" while stale dice and moves remain.
    ["black is to roll again, with stale dice and legal moves stored", (r) => {
      const gs = r.gameState;
      gs.phase    = "rolling";
      gs.moveSeq += 2;
      return r;
    }],
  ])("(%s): the AI writes nothing and stops", async (_label, change) => {
    const roomId = "NOTAIMV1";
    putRoom(roomId);
    const h = changeRoomDuringFirstPick(roomId, change);

    const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runUntil(() => turn.settled, TURN_MS);

    // The stored state still has dice and legal moves, so only the turn/phase
    // check tells the AI that it is not its move.
    expect(h.newer.gameState.dice.length).toBeGreaterThan(0);
    expect(h.newer.gameState.legalMoves.length).toBeGreaterThan(0);

    expect(turn.settled).toBe(true);
    expect(getRoom(roomId)).toEqual(h.newer);
    expect(savesOf(roomId)).toHaveLength(h.savesAfterChange);
    expect(moveLogs()).toHaveLength(0);
    // The AI did not choose again; it read the room once (the move step).
    expect(pickMove).toHaveBeenCalledTimes(1);
    expect(roomReads - h.readsAfterChange).toBe(1);
    expect(pendingRoomLockCount()).toBe(0);
  }, 60_000);
});

// ── 3. The match finished while the AI was choosing ─────────────────────────

describe("the match finished while the AI was choosing", () => {
  test("a finished room still black/moving with legal moves: the AI writes nothing and stops", async () => {
    const roomId = "FINISHD1";
    putRoom(roomId);
    // E.g. a RESIGN that left the game state as it was.
    const h = changeRoomDuringFirstPick(roomId, (r) => {
      r.status      = "finished";
      r.matchResult = { winner: "black", winType: "resign" };
      return r;
    });

    const turn = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runUntil(() => turn.settled, TURN_MS);

    expect(h.newer.gameState).toMatchObject({ turn: "black", phase: "moving" });
    expect(h.newer.gameState.dice.length).toBeGreaterThan(0);
    expect(h.newer.gameState.legalMoves.length).toBeGreaterThan(0);

    expect(turn.settled).toBe(true);
    expect(getRoom(roomId)).toEqual(h.newer);
    expect(savesOf(roomId)).toHaveLength(h.savesAfterChange);
    expect(moveLogs()).toHaveLength(0);
    // No re-pick; the room was read once more (the move step).
    expect(pickMove).toHaveBeenCalledTimes(1);
    expect(roomReads - h.readsAfterChange).toBe(1);

    // It stays stopped: nothing more happens later.
    await runFor(TURN_MS);
    expect(pickMove).toHaveBeenCalledTimes(1);
    expect(roomReads - h.readsAfterChange).toBe(1);
    expect(savesOf(roomId)).toHaveLength(h.savesAfterChange);
    expect(pendingRoomLockCount()).toBe(0);
  }, 60_000);
});
