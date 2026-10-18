// ── A slow AI move choice must not block the room (issue #60) ───────────────
// Redis and Postgres are replaced with in-memory fakes, the AI's move choice
// (pickMove) is replaced with a fake that stays pending until the test
// releases it, and timers are faked. The real WebSocket layer (server.js) is
// used with fake sockets, so reconnects go through handleConnection.
//
// While the AI is still choosing its move:
//   1. a human RESIGN completes and is persisted, and a reconnect is served a
//      ROOM_STATE, without waiting for the move choice;
//   2. when the choice finally arrives after the room changed (match finished,
//      turn changed, move sequence, dice or game changed), the AI applies no
//      stale move and does not overwrite the newer state; if it is still the
//      AI's move, it chooses again for the newer position and finishes its
//      turn;
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

// Fake move choice. In "hold" mode each pickMove call returns a promise that
// settles only when the test calls release(k); otherwise it answers at once
// with the next entry of `answers`, or 0 (the first legal move) when there is
// none. k is an index into the legal moves the call was given. Each call
// records how many room saves had been made when it was issued.
const pickCalls = []; // { legalMoves, savesAt, settled, release(k) }
const answers = [];
let holdPick = true;
const AI_USER_ID_FAKE = "00000000-0000-0000-0000-000000000001";
jest.unstable_mockModule("../game/ai.js", () => ({
  AI_USER_ID: AI_USER_ID_FAKE,
  AI_DISPLAY: { display_name: "Computer", avatar_url: null },
  pickMove: (gs, color, legalMoves) => {
    const call = { legalMoves, savesAt: saves.length, settled: false };
    pickCalls.push(call);
    if (!holdPick) {
      call.settled = true;
      return Promise.resolve(legalMoves[answers.shift() ?? 0]);
    }
    return new Promise((resolve) => {
      call.release = (k = 0) => { call.settled = true; resolve(legalMoves[k]); };
    });
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

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

function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && a.die === b.die;
}

// The params of the move log row for `move` (points are 1-based).
function logParams(gameDbId, seq, move) {
  return [
    gameDbId, seq, "black",
    move.from === "bar" ? "bar" : String(move.from + 1),
    move.to   === "off" ? "off" : String(move.to + 1),
    move.die,
  ];
}

// A non-double roll that contains `die` but differs from `rolled`.
function otherDice(rolled, die) {
  const old = rolled.slice().sort().join(",");
  for (let x = 1; x <= 6; x++) {
    if (x === die) continue;
    const dice = [die, x];
    if (dice.slice().sort().join(",") !== old) return dice;
  }
  throw new Error("no other roll found");
}

// Advance fake time in small steps, letting promises settle between timers.
async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

// Start the AI's turn by connecting the human (the connect kicks off the AI
// when black is to roll), then run until the AI is choosing its first move.
async function startAiChoosing(roomId) {
  store.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));
  const ws = fakeWs();
  await connect(ws, roomId);
  for (let t = 0; t < 10_000 && pickCalls.length === 0; t += 100) {
    await jest.advanceTimersByTimeAsync(100);
  }
  expect(pickCalls).toHaveLength(1);
  const room = await getRoom(roomId);
  // The AI has rolled and is choosing its first move.
  expect(room.gameState).toMatchObject({ turn: "black", phase: "moving" });
  expect(room.gameState.legalMoves.length).toBeGreaterThan(0);
  return { ws, room };
}

// Settle `promise` while fake time advances by at most `ms`; returns whether
// it settled in that window (the slow move choice is still pending meanwhile).
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
  pickCalls.length = 0;
  answers.length = 0;
  holdPick = true;
  query.mockClear();
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  // Release anything still pending and let the AI turn finish.
  holdPick = false;
  for (const c of pickCalls) if (!c.settled) c.release?.(0);
  await runFor(20_000);
  for (const c of pickCalls) if (!c.settled) c.release?.(0);
  await runFor(5_000);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Other work on the room is not blocked ────────────────────────────────────

describe("while the AI is still choosing its move", () => {
  test("a human RESIGN completes and is persisted before the move is chosen", async () => {
    const roomId = "SLOWRS01";
    const { ws } = await startAiChoosing(roomId);

    const resign = handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws });
    expect(await settlesWithin(resign, 200)).toBe(true);
    expect(pickCalls[0].settled).toBe(false);

    const room = await getRoom(roomId);
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "black", winType: "resign" });
    expect(query.mock.calls.some(([sql]) => /UPDATE games/.test(sql))).toBe(true);
    expect(sentTo(ws)).toContainEqual(expect.objectContaining({ type: "MATCH_OVER", winner: "black" }));
  }, 30_000);

  test("a reconnect is served a ROOM_STATE before the move is chosen", async () => {
    const roomId = "SLOWRC01";
    await startAiChoosing(roomId);

    const ws2 = fakeWs();
    expect(await settlesWithin(connect(ws2, roomId), 200)).toBe(true);
    expect(pickCalls[0].settled).toBe(false);

    const states = sentTo(ws2).filter((m) => m.type === "ROOM_STATE");
    expect(states.length).toBeGreaterThan(0);
    expect(states[0].room.gameState).toMatchObject({ turn: "black", phase: "moving" });
  }, 30_000);

  test("a reconnect after a RESIGN is served the finished room before the move is chosen", async () => {
    const roomId = "SLOWRC02";
    const { ws } = await startAiChoosing(roomId);

    const resign = handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws });
    const ws2 = fakeWs();
    const reconnect = connect(ws2, roomId);
    expect(await settlesWithin(Promise.all([resign, reconnect]), 200)).toBe(true);
    expect(pickCalls[0].settled).toBe(false);

    const states = sentTo(ws2).filter((m) => m.type === "ROOM_STATE");
    expect(states.length).toBeGreaterThan(0);
    expect(states.at(-1).room.status).toBe("finished");
  }, 30_000);
});

// ── The late answer is not applied to a newer state ──────────────────────────

describe("when the move arrives after the room changed", () => {
  test("a finished match stays finished and no move is applied", async () => {
    const roomId = "SLOWST01";
    const { ws } = await startAiChoosing(roomId);

    const resign = handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId, ws });
    expect(await settlesWithin(resign, 200)).toBe(true);
    const finished = await getRoom(roomId);
    expect(finished.status).toBe("finished");
    const savesBefore = savesOf(roomId).length;
    const logsBefore  = moveLogs().length;

    pickCalls[0].release(0);
    await runFor(20_000);

    expect(await getRoom(roomId)).toEqual(finished);
    expect(savesOf(roomId)).toHaveLength(savesBefore);
    expect(moveLogs()).toHaveLength(logsBefore);
  }, 40_000);

  test("a turn that has passed to white is not overwritten", async () => {
    const roomId = "SLOWST02";
    const { room } = await startAiChoosing(roomId);

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

    pickCalls[0].release(0);
    await runFor(20_000);

    expect(await getRoom(roomId)).toEqual(newer);
    expect(savesOf(roomId)).toHaveLength(savesBefore);
    expect(moveLogs()).toHaveLength(logsBefore);
  }, 40_000);

  // Each case keeps it the AI's move but changes one part of what the pending
  // move was chosen for. The stale move (the first legal move of the old
  // position) stays legal in the newer position, so only a check of the
  // position itself (not mere legality) can reject it. The AI must then choose
  // again for the newer position (a second pickMove call, made before anything is
  // written) and finish its turn on it.
  describe.each([
    ["only the move sequence changed", "SLOWSQ01", (r) => {
      r.gameState.moveSeq += 5;
    }],
    ["only the dice changed", "SLOWDC01", (r, stale) => {
      r.gameState.dice       = otherDice(r.gameState.rolledDice, stale.die);
      r.gameState.rolledDice = r.gameState.dice.slice();
    }],
    ["the dice and the move sequence changed", "SLOWST03", (r, stale) => {
      r.gameState.dice       = otherDice(r.gameState.rolledDice, stale.die);
      r.gameState.rolledDice = r.gameState.dice.slice();
      r.gameState.moveSeq   += 5;
    }],
    ["the room moved on to the next game", "SLOWGN01", (r) => {
      r.gameNum  = 2;
      r.gameDbId = "game-uuid-2";
    }],
  ])("%s", (_label, roomId, change) => {
    test("the stale move is not applied and the AI plays its turn on the newer position", async () => {
      const { room } = await startAiChoosing(roomId);
      const stale = room.gameState.legalMoves[0];

      const newer = JSON.parse(JSON.stringify(room));
      change(newer, stale);
      newer.gameState.legalMoves = getLegalMoves(newer.gameState, "black");
      expect(newer.gameState.legalMoves).toContainEqual(stale);
      await fakeRedis.set(`room:${roomId}`, JSON.stringify(newer));
      const savesBefore = saves.length;
      const logsBefore  = moveLogs().length;

      // The next pickMove call answers with a move other than the stale one when
      // the newer position has one; any calls after that answer "0".
      const legal = newer.gameState.legalMoves;
      const k = Math.max(0, legal.findIndex((m) => !sameMove(m, stale)));
      answers.push(k);
      holdPick = false;
      pickCalls[0].release(0);
      await runFor(20_000);

      // The AI chose again for the newer position before writing anything.
      expect(pickCalls.length).toBeGreaterThanOrEqual(2);
      expect(pickCalls[1].savesAt).toBe(savesBefore);

      // Nothing written afterwards derives from the old position.
      for (const s of saves.slice(savesBefore)) {
        expect(s.room.gameNum).toBe(newer.gameNum);
        expect(s.room.gameState.rolledDice).toEqual(newer.gameState.rolledDice);
        expect(s.room.gameState.moveSeq).toBeGreaterThan(newer.gameState.moveSeq);
      }

      // The first move applied is the one chosen for the newer position,
      // logged at the newer sequence + 1 against the newer game.
      const logs = moveLogs().slice(logsBefore);
      expect(logs.length).toBeGreaterThan(0);
      const [, params] = logs[0];
      expect(params).toEqual(logParams(newer.gameDbId, newer.gameState.moveSeq + 1, legal[k]));
      expect(newer.gameState.rolledDice).toContain(params[5]);

      // ... and the AI finished its turn on the newer roll.
      const final = await getRoom(roomId);
      expect(final.status).toBe("playing");
      expect(final.gameNum).toBe(newer.gameNum);
      expect(final.gameState.rolledDice).toEqual(newer.gameState.rolledDice);
      expect(final.gameState.moveSeq).toBeGreaterThan(newer.gameState.moveSeq);
      expect(final.gameState.turn).toBe("white");
      expect(final.gameState.phase).toBe("rolling");
    }, 40_000);
  });
});

// ── Unchanged room: the slow choice is used ──────────────────────────────────

describe("when the move arrives and nothing changed", () => {
  test("the AI applies the move and goes on with its turn", async () => {
    const roomId = "SLOWOK01";
    const { room } = await startAiChoosing(roomId);
    const chosen = room.gameState.legalMoves[0];

    holdPick = false;
    pickCalls[0].release(0);
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
