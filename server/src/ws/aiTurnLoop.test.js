// ── The AI turn loop per room: guard, reruns and errors (issue #60) ─────────
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes,
// and timers are faked so the AI's "thinking" delays run instantly.
//
// triggerAiTurn runs at most one AI turn loop per room. A trigger that
// arrives while a turn is running asks for (at most) one more pass after it,
// it does not start a second loop. Verifies that:
//   1. many triggers for one room cost at most one extra pass, not one pass
//      each (a missing per-room guard is detected by counting the AI's reads
//      of the room);
//   2. once the turn and its rerun are over, the loop stops: the trigger
//      promises settle and the AI reads the room no more (an always-rerun
//      loop is detected);
//   3. if one pass throws (here: a Redis read fails) while a rerun is
//      pending, the pending rerun still runs and the AI plays its turn;
//   4. a turn whose passes keep throwing with no rerun pending does not leave
//      the room's guard behind once it gives up: a later trigger plays the
//      turn. (Recovery from a single failing pass is in aiTurnRecovery.test.js.)

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order: { key, room }
const reads = []; // every key read, in order
let failReads = 0; // number of upcoming room reads that throw
const fakeRedis = {
  get: async (k) => {
    reads.push(k);
    if (k.startsWith("room:") && failReads > 0) {
      failReads--;
      throw new Error("redis read failed");
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

const { triggerAiTurn } = await import("./handlers.js");
const { initGame } = await import("../game/engine.js");
const { AI_USER_ID } = await import("../game/ai.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID = "11111111-1111-1111-1111-111111111111";
const START_SEQ = 10;

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

async function getRoom(roomId) {
  return JSON.parse(store.get(`room:${roomId}`));
}

function readsOf(roomId) {
  return reads.filter((k) => k === `room:${roomId}`).length;
}

function savesOf(roomId) {
  return saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);
}

// Number of times the AI rolled and got moves to play.
function aiRollsWithMoves(roomId) {
  const history = savesOf(roomId);
  let n = 0;
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].gameState, cur = history[i].gameState;
    if (prev.turn === "black" && prev.phase === "rolling" &&
        cur.turn  === "black" && cur.phase  === "moving") n++;
  }
  return n;
}

// Advance fake time in small steps, letting promises settle between timers.
async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
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
  reads.length = 0;
  failReads = 0;
  query.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  failReads = 0;
  await runFor(10_000);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Guard and reruns ─────────────────────────────────────────────────────────

describe("many triggers for the same room", () => {
  const TRIGGERS = 20;

  test("play the turn once and cost at most one extra pass", async () => {
    const roomId = "LOOPGD01";
    await fakeRedis.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));

    const turns = [];
    for (let i = 0; i < TRIGGERS; i++) {
      turns.push(triggerAiTurn(roomId, "beginner").catch(() => {}));
    }
    const all = track(Promise.all(turns));
    await runFor(20_000);
    expect(all.settled).toBe(true);

    const room = await getRoom(roomId);
    expect(aiRollsWithMoves(roomId)).toBe(1);
    expect(room.gameState.turn).toBe("white");
    expect(room.gameState.phase).toBe("rolling");

    // One pass plays the turn: one read for the roll plus at most two per
    // move. A rerun pass may add up to two reads more. A loop per trigger
    // would read the room at least once per trigger.
    const aiMoves = room.gameState.moveSeq - START_SEQ;
    expect(aiMoves).toBeGreaterThan(0);
    expect(readsOf(roomId)).toBeLessThanOrEqual(2 * (aiMoves + 2));
    expect(readsOf(roomId)).toBeLessThan(TRIGGERS);
  }, 40_000);

  test("stop once the turn is over: the triggers settle and the AI reads the room no more", async () => {
    const roomId = "LOOPGD02";
    await fakeRedis.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));

    const first  = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    const second = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runFor(20_000);
    expect(first.settled).toBe(true);
    expect(second.settled).toBe(true);
    expect((await getRoom(roomId)).gameState.turn).toBe("white");

    const readCount = readsOf(roomId);
    const saveCount = savesOf(roomId).length;
    await runFor(20_000);
    expect(readsOf(roomId)).toBe(readCount);
    expect(savesOf(roomId)).toHaveLength(saveCount);
  }, 60_000);
});

// ── A pass that throws ───────────────────────────────────────────────────────

describe("a pass of the AI turn that throws", () => {
  test("does not drop a pending rerun: the AI still rolls and plays", async () => {
    const roomId = "LOOPER01";
    await fakeRedis.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));

    // The first room read by the AI fails; a second trigger is pending.
    failReads = 1;
    const first  = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    const second = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runFor(20_000);

    expect(failReads).toBe(0); // the failing read did happen
    expect(first.settled).toBe(true);
    expect(second.settled).toBe(true);

    const room = await getRoom(roomId);
    expect(aiRollsWithMoves(roomId)).toBe(1);
    expect(room.gameState.moveSeq).toBeGreaterThan(START_SEQ);
    expect(room.gameState.turn).toBe("white");
    expect(room.gameState.phase).toBe("rolling");
  }, 40_000);

  test("with no rerun pending, does not block a later trigger once the turn gives up", async () => {
    const roomId = "LOOPER02";
    await fakeRedis.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));

    // Every room read fails, so the turn (with any bounded retries, issue
    // #79) gives up without playing.
    failReads = Infinity;
    const first = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runFor(120_000);
    expect(first.settled).toBe(true);
    expect(aiRollsWithMoves(roomId)).toBe(0);
    failReads = 0;

    const later = track(triggerAiTurn(roomId, "beginner").catch(() => {}));
    await runFor(20_000);
    expect(later.settled).toBe(true);

    const room = await getRoom(roomId);
    expect(aiRollsWithMoves(roomId)).toBe(1);
    expect(room.gameState.turn).toBe("white");
  }, 120_000);
});
