// ── A slow master-AI move choice must not block the room (issue #60) ────────
// Redis and Postgres are replaced with in-memory fakes, the Anthropic SDK is
// replaced with a fake whose messages.create stays pending until the test
// releases it, and timers are faked. The real WebSocket layer (server.js) is
// used with fake sockets, so reconnects go through handleConnection.
//
// While the master AI waits for its move from the API:
//   1. a human RESIGN completes and is persisted, and a reconnect is served a
//      ROOM_STATE, without waiting for the API call;
//   2. when the call finally returns after the room changed (match finished,
//      turn changed, or dice and move sequence changed), the AI applies no
//      stale move and does not overwrite the newer state;
//   3. when nothing changed, the AI applies the move it was given.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order: { key, room }
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => {
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

// Fake Anthropic SDK. In "hold" mode each messages.create call returns a
// promise that settles only when the test calls release(); otherwise it
// answers "0" (the first legal move) at once.
const createCalls = []; // { params, reqOpts, ctorOpts, settled, release(text) }
let holdCreate = true;
class FakeAnthropic {
  constructor(opts = {}) {
    this.opts = opts;
    this.messages = {
      create: (params, reqOpts) => {
        const call = { params, reqOpts, ctorOpts: this.opts, settled: false };
        createCalls.push(call);
        const reply = (text) => ({ content: [{ type: "text", text }] });
        if (!holdCreate) { call.settled = true; return Promise.resolve(reply("0")); }
        return new Promise((resolve) => {
          call.release = (text = "0") => { call.settled = true; resolve(reply(text)); };
        });
      },
    };
  }
  withOptions(opts) { return new FakeAnthropic({ ...this.opts, ...opts }); }
}
jest.unstable_mockModule("@anthropic-ai/sdk", () => ({
  default:   FakeAnthropic,
  Anthropic: FakeAnthropic,
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.ANTHROPIC_API_KEY = "test-key";

const { handleMessage } = await import("./handlers.js");
const { handleConnection, rooms, userConnections, inFlightConnections } = await import("./server.js");
const { initGame, getLegalMoves } = await import("../game/engine.js");
const { AI_USER_ID } = await import("../game/ai.js");
const { signAccessToken } = await import("../auth/tokens.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID = "11111111-1111-1111-1111-111111111111";

function makeRoom(roomId) {
  const gs = initGame();
  gs.turn      = "black";
  gs.phase     = "rolling";
  gs.firstMove = false;
  gs.moveSeq   = 20;
  return {
    roomId,
    matchLength:  3,
    createdBy:    HUMAN_ID,
    isAi:         true,
    aiDifficulty: "master",
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

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

function sentTo(ws) {
  return ws.send.mock.calls.map(([data]) => JSON.parse(data));
}

function connect(ws, roomId, userId = HUMAN_ID) {
  return handleConnection(ws, { url: `/ws?token=${signAccessToken(userId)}&room=${roomId}` });
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

function savesOf(roomId) {
  return saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);
}

function moveLogs() {
  return query.mock.calls.filter(([sql]) => /INSERT INTO moves/.test(sql));
}

// Advance fake time in small steps, letting promises settle between timers.
async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

// Start the AI's turn by connecting the human (the connect kicks off the AI
// when black is to roll), then run until the AI is waiting for the API.
async function startAiWaitingForApi(roomId) {
  store.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));
  const ws = fakeWs();
  await connect(ws, roomId);
  for (let t = 0; t < 10_000 && createCalls.length === 0; t += 100) {
    await jest.advanceTimersByTimeAsync(100);
  }
  expect(createCalls).toHaveLength(1);
  const room = await getRoom(roomId);
  // The AI has rolled and is choosing its first move.
  expect(room.gameState).toMatchObject({ turn: "black", phase: "moving" });
  expect(room.gameState.legalMoves.length).toBeGreaterThan(0);
  return { ws, room };
}

// Settle `promise` while fake time advances by at most `ms`; returns whether
// it settled in that window (the slow API call is still pending meanwhile).
async function settlesWithin(promise, ms) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await jest.advanceTimersByTimeAsync(0);
  for (let t = 0; t < ms && !settled; t += 10) await jest.advanceTimersByTimeAsync(10);
  return settled;
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  createCalls.length = 0;
  holdCreate = true;
  query.mockClear();
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  // Release anything still pending and let the AI turn finish.
  holdCreate = false;
  for (const c of createCalls) if (!c.settled) c.release?.("0");
  await runFor(20_000);
  for (const c of createCalls) if (!c.settled) c.release?.("0");
  await runFor(5_000);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Other work on the room is not blocked ────────────────────────────────────

describe("while the master AI waits for the API", () => {
  test("a human RESIGN completes and is persisted before the API answers", async () => {
    const roomId = "SLOWRS01";
    const { ws } = await startAiWaitingForApi(roomId);

    const resign = handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws });
    expect(await settlesWithin(resign, 200)).toBe(true);
    expect(createCalls[0].settled).toBe(false);

    const room = await getRoom(roomId);
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "black", winType: "resign" });
    expect(query.mock.calls.some(([sql]) => /UPDATE games/.test(sql))).toBe(true);
    expect(sentTo(ws)).toContainEqual(expect.objectContaining({ type: "MATCH_OVER", winner: "black" }));
  }, 30_000);

  test("a reconnect is served a ROOM_STATE before the API answers", async () => {
    const roomId = "SLOWRC01";
    await startAiWaitingForApi(roomId);

    const ws2 = fakeWs();
    expect(await settlesWithin(connect(ws2, roomId), 200)).toBe(true);
    expect(createCalls[0].settled).toBe(false);

    const states = sentTo(ws2).filter((m) => m.type === "ROOM_STATE");
    expect(states.length).toBeGreaterThan(0);
    expect(states[0].room.gameState).toMatchObject({ turn: "black", phase: "moving" });
  }, 30_000);

  test("a reconnect after a RESIGN is served the finished room before the API answers", async () => {
    const roomId = "SLOWRC02";
    const { ws } = await startAiWaitingForApi(roomId);

    const resign = handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws });
    const ws2 = fakeWs();
    const reconnect = connect(ws2, roomId);
    expect(await settlesWithin(Promise.all([resign, reconnect]), 200)).toBe(true);
    expect(createCalls[0].settled).toBe(false);

    const states = sentTo(ws2).filter((m) => m.type === "ROOM_STATE");
    expect(states.length).toBeGreaterThan(0);
    expect(states.at(-1).room.status).toBe("finished");
  }, 30_000);
});

// ── The late answer is not applied to a newer state ──────────────────────────

describe("when the API answers after the room changed", () => {
  test("a finished match stays finished and no move is applied", async () => {
    const roomId = "SLOWST01";
    const { ws } = await startAiWaitingForApi(roomId);

    const resign = handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws });
    expect(await settlesWithin(resign, 200)).toBe(true);
    const finished = await getRoom(roomId);
    expect(finished.status).toBe("finished");
    const savesBefore = savesOf(roomId).length;
    const logsBefore  = moveLogs().length;

    createCalls[0].release("0");
    await runFor(20_000);

    expect(await getRoom(roomId)).toEqual(finished);
    expect(savesOf(roomId)).toHaveLength(savesBefore);
    expect(moveLogs()).toHaveLength(logsBefore);
  }, 40_000);

  test("a turn that has passed to white is not overwritten", async () => {
    const roomId = "SLOWST02";
    const { room } = await startAiWaitingForApi(roomId);

    // Some other writer has ended the AI's turn meanwhile.
    const newer = JSON.parse(JSON.stringify(room));
    newer.gameState.turn       = "white";
    newer.gameState.phase      = "rolling";
    newer.gameState.dice       = [];
    newer.gameState.legalMoves = [];
    newer.gameState.moveSeq    = room.gameState.moveSeq + 3;
    await fakeRedis.set(`room:${roomId}`, JSON.stringify(newer));
    const savesBefore = savesOf(roomId).length;
    const logsBefore  = moveLogs().length;

    createCalls[0].release("0");
    await runFor(20_000);

    expect(await getRoom(roomId)).toEqual(newer);
    expect(savesOf(roomId)).toHaveLength(savesBefore);
    expect(moveLogs()).toHaveLength(logsBefore);
  }, 40_000);

  test("a move chosen for other dice and an older move sequence is not applied", async () => {
    const roomId = "SLOWST03";
    const { room } = await startAiWaitingForApi(roomId);

    // Still the AI's moving phase, but with other dice and a later move
    // sequence (e.g. the room was replaced while the AI was thinking).
    const old = room.gameState.rolledDice.slice().sort().join(",");
    const dice = old === "1,2" ? [3, 4] : [1, 2];
    const newer = JSON.parse(JSON.stringify(room));
    newer.gameState.dice       = dice.slice();
    newer.gameState.rolledDice = dice.slice();
    newer.gameState.moveSeq    = room.gameState.moveSeq + 5;
    newer.gameState.legalMoves = getLegalMoves(newer.gameState, "black");
    expect(newer.gameState.legalMoves.length).toBeGreaterThan(0);
    await fakeRedis.set(`room:${roomId}`, JSON.stringify(newer));
    const savesBefore = savesOf(roomId).length;

    // Any later API call (for the newer state) answers at once.
    holdCreate = false;
    createCalls[0].release("0");
    await runFor(20_000);

    // Nothing written afterwards may derive from the state the stale move was
    // chosen for: every later save carries the newer roll and move sequence.
    const after = savesOf(roomId).slice(savesBefore);
    for (const r of after) {
      expect(r.gameState.rolledDice).toEqual(dice);
      expect(r.gameState.moveSeq).toBeGreaterThanOrEqual(newer.gameState.moveSeq);
    }
    const final = await getRoom(roomId);
    expect(final.gameState.rolledDice).toEqual(dice);
    expect(final.gameState.moveSeq).toBeGreaterThanOrEqual(newer.gameState.moveSeq);
    // No move was logged with the old sequence number.
    const staleSeq = room.gameState.moveSeq + 1;
    expect(moveLogs().some(([, params]) => params[1] === staleSeq)).toBe(false);
  }, 40_000);
});

// ── Unchanged room: the slow answer is used ──────────────────────────────────

describe("when the API answers and nothing changed", () => {
  test("the AI applies the move and goes on with its turn", async () => {
    const roomId = "SLOWOK01";
    const { room } = await startAiWaitingForApi(roomId);
    const chosen = room.gameState.legalMoves[0];

    holdCreate = false;
    createCalls[0].release("0");
    await runFor(20_000);

    const history = savesOf(roomId);
    const firstMove = history.find((r) => r.gameState.moveSeq === room.gameState.moveSeq + 1);
    expect(firstMove).toBeDefined();
    expect(firstMove.gameState.rolledDice).toEqual(room.gameState.rolledDice);
    expect(moveLogs()).toContainEqual([
      expect.stringMatching(/INSERT INTO moves/),
      expect.arrayContaining([room.gameState.moveSeq + 1, "black"]),
    ]);
    const logged = moveLogs().find(([, p]) => p[1] === room.gameState.moveSeq + 1)[1];
    expect(logged[5]).toBe(chosen.die);

    const final = await getRoom(roomId);
    expect(final.status).toBe("playing");
    expect(final.gameState.turn).toBe("white");
    expect(final.gameState.phase).toBe("rolling");
  }, 40_000);
});
