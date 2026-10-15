// ── The master AI's API call does not hold the room lock (#60) ───────────────
// Redis, Postgres, the WebSocket layer and the Anthropic SDK are replaced with
// in-memory fakes, and timers are faked so the AI's delays run instantly.
//
// The master AI chooses its move with a network call. That call runs outside
// the room lock, so a RESIGN or reconnect is not stuck behind it, and the
// chosen move is applied only if the room has not changed in the meantime.
// Also covered: the Anthropic client is bounded (timeout, retries), and a
// failing AI pass does not drop a rerun that was requested meanwhile.

import { jest } from "@jest/globals";

process.env.ANTHROPIC_API_KEY = "test-dummy-key";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order: { key, room }
let failNextGet = 0;
const fakeRedis = {
  get: async (k) => {
    if (failNextGet > 0) { failNextGet--; throw new Error("redis down"); }
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

// Anthropic: every create() call stays pending until the test answers it.
const apiCalls = []; // { params, requestOptions, clientOptions, answer(text) }
class FakeAnthropic {
  constructor(options = {}) { this.options = options; }
  get messages() {
    return {
      create: (params, requestOptions) => new Promise((resolve) => {
        apiCalls.push({
          params, requestOptions, clientOptions: this.options,
          answer: (text) => resolve({ content: [{ type: "text", text }] }),
        });
      }),
    };
  }
  withOptions(opts) { return new FakeAnthropic({ ...this.options, ...opts }); }
}
jest.unstable_mockModule("@anthropic-ai/sdk", () => ({
  default:   FakeAnthropic,
  Anthropic: FakeAnthropic,
}));

const { handleMessage, triggerAiTurn } = await import("./handlers.js");
const { initGame } = await import("../game/engine.js");
const { AI_USER_ID, pickMove } = await import("../game/ai.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID = "22222222-2222-2222-2222-222222222222";

function makeRoom(roomId, aiDifficulty) {
  return {
    roomId,
    matchLength:  1,
    createdBy:    HUMAN_ID,
    isAi:         true,
    aiDifficulty,
    gameDbId:     "game-uuid",
    players:      { white: HUMAN_ID, black: AI_USER_ID },
    playerInfo:   { white: { display_name: "Human" }, black: { display_name: "Computer" } },
    ready:        { white: true, black: true },
    status:       "playing",
    score:        { white: 0, black: 0 },
    gameNum:      1,
    gameState:    { ...initGame(), turn: "black", phase: "rolling", moveSeq: 10, firstMove: false },
  };
}

async function putRoom(room) {
  store.set(`room:${room.roomId}`, JSON.stringify(room));
}

function getRoom(roomId) {
  return JSON.parse(store.get(`room:${roomId}`));
}

function savesOf(roomId) {
  return saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);
}

function movesLogged() {
  return query.mock.calls.filter(([sql]) => /INSERT INTO moves/.test(sql));
}

async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

// Start the AI turn and run until its first API call is pending. The turn's
// promise is returned wrapped, so awaiting this helper does not wait for it.
async function startUntilApiCall(roomId) {
  const done = triggerAiTurn(roomId, "master");
  await runFor(3_000);
  expect(apiCalls).toHaveLength(1);
  return { done };
}

// Answer every pending API call (and later ones) with "0" until the turn ends.
async function answerAll(done) {
  let settled = false;
  done.finally(() => { settled = true; });
  for (let i = 0; i < 200 && !settled; i++) {
    while (apiCalls.some((c) => !c.answered)) {
      const c = apiCalls.find((x) => !x.answered);
      c.answered = true;
      c.answer("0");
    }
    await jest.advanceTimersByTimeAsync(100);
  }
  expect(settled).toBe(true);
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  apiCalls.length = 0;
  failNextGet = 0;
  query.mockClear();
});

afterEach(async () => {
  for (const c of apiCalls) if (!c.answered) { c.answered = true; c.answer("0"); }
  await runFor(20_000);
  jest.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("master AI move choice runs outside the room lock", () => {
  test("a RESIGN during the API call settles at once and is not overwritten", async () => {
    const roomId = "LOCKRS01";
    await putRoom(makeRoom(roomId, "master"));
    const { done } = await startUntilApiCall(roomId);

    const sent = [];
    const ws = { send: (s) => sent.push(JSON.parse(s)) };
    let resigned = false;
    handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws })
      .then(() => { resigned = true; });
    await jest.advanceTimersByTimeAsync(200);
    expect(resigned).toBe(true);

    const finished = getRoom(roomId);
    expect(finished.status).toBe("finished");
    expect(finished.matchResult).toMatchObject({ winner: "black", winType: "resign" });

    const savesBefore = savesOf(roomId).length;
    await answerAll(done);
    expect(savesOf(roomId)).toHaveLength(savesBefore);
    expect(getRoom(roomId)).toEqual(finished);
    expect(movesLogged()).toHaveLength(0);
  });

  test("a move chosen for an older roll is not applied", async () => {
    const roomId = "LOCKST01";
    await putRoom(makeRoom(roomId, "master"));
    const { done } = await startUntilApiCall(roomId);

    const room = getRoom(roomId);
    const oldSeq = room.gameState.moveSeq;
    room.gameState.rolledDice = [9, 9];
    room.gameState.moveSeq = oldSeq + 5;
    await putRoom(room);
    const savesBefore = savesOf(roomId).length;

    await answerAll(done);
    const later = savesOf(roomId).slice(savesBefore);
    for (const s of later) {
      expect(s.gameState.moveSeq).toBeGreaterThanOrEqual(oldSeq + 5);
    }
    expect(movesLogged().filter(([, p]) => p[1] === oldSeq + 1)).toHaveLength(0);
  });

  test("an unchanged room gets the late move applied", async () => {
    const roomId = "LOCKOK01";
    await putRoom(makeRoom(roomId, "master"));
    const { done } = await startUntilApiCall(roomId);
    const before = getRoom(roomId).gameState;
    const expectedDie = before.legalMoves[0].die;

    apiCalls[0].answered = true;
    apiCalls[0].answer("0");
    await runFor(200);
    const after = savesOf(roomId).at(-1).gameState;
    expect(after.moveSeq).toBe(before.moveSeq + 1);
    expect(after.rolledDice).toEqual(before.rolledDice);
    const logged = movesLogged().map(([, p]) => p);
    expect(logged[0]).toEqual(expect.arrayContaining([before.moveSeq + 1, "black", expectedDie]));

    await answerAll(done);
    const end = getRoom(roomId).gameState;
    expect(end.turn).toBe("white");
    expect(end.phase).toBe("rolling");
  });
});

describe("Anthropic client is bounded", () => {
  test("timeout and maxRetries are explicit and small", async () => {
    const gs = { ...initGame(), turn: "black", phase: "moving", dice: [3, 5], rolledDice: [3, 5] };
    const legal = [{ from: 12, to: 15, die: 3 }, { from: 12, to: 17, die: 5 }];
    const p = pickMove(gs, "black", legal, "master", "BOUND001");
    await Promise.resolve();
    expect(apiCalls).toHaveLength(1);
    const { requestOptions = {}, clientOptions = {} } = apiCalls[0];
    const timeout = requestOptions.timeout ?? clientOptions.timeout;
    const retries = requestOptions.maxRetries ?? clientOptions.maxRetries;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(60_000);
    expect(Number.isInteger(retries)).toBe(true);
    expect(retries).toBeGreaterThanOrEqual(0);
    expect(retries).toBeLessThanOrEqual(2);
    apiCalls[0].answered = true;
    apiCalls[0].answer("1");
    await expect(p).resolves.toEqual(legal[1]);
  });
});

describe("AI turn loop", () => {
  test("a failing pass does not drop a pending rerun", async () => {
    const roomId = "LOCKRR01";
    await putRoom(makeRoom(roomId, "beginner"));
    failNextGet = 1;
    const first  = triggerAiTurn(roomId, "beginner");
    const second = triggerAiTurn(roomId, "beginner");
    await runFor(20_000);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    const end = getRoom(roomId).gameState;
    expect(end.moveSeq).toBeGreaterThan(10);
    expect(end.turn).toBe("white");
    expect(end.phase).toBe("rolling");
  });
});
