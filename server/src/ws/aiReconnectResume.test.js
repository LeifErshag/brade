// ── A reconnect resumes an AI turn abandoned mid-move (issue #79) ───────────
// Real server.js, handlers.js and roomLock.js; Redis, Postgres and the AI's
// move choice (pickMove) are fakes, and timers are faked.
//
// If Redis fails permanently during black's move step, the AI's bounded
// retries give up and the room is left with black in the "moving" phase
// (dice rolled, moves left). No trigger site that requires black to be
// "rolling" would ever resume that turn. Once Redis recovers, the human
// reconnecting must re-trigger the AI, which then finishes its turn with the
// dice it already rolled. Nothing here calls triggerAiTurn directly.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const saves = []; // every room state written, in order: { key, room }
let roomReads = 0;
// Set when a test wants every room read to fail.
let failRoomReads = false;
// When true, room reads start failing as soon as the AI's roll is saved
// (black moving): the AI's move step then fails.
let failAfterAiRoll = false;

const fakeRedis = {
  get: async (k) => {
    if (k.startsWith("room:")) {
      roomReads++;
      if (failRoomReads) throw new Error("redis read failed");
    }
    return store.get(k) ?? null;
  },
  set: async (k, v) => {
    if (k.startsWith("room:") && failRoomReads) throw new Error("redis write failed");
    store.set(k, v);
    const room = JSON.parse(v);
    saves.push({ key: k, room });
    if (failAfterAiRoll && k.startsWith("room:") &&
        room.gameState?.turn === "black" && room.gameState?.phase === "moving") {
      failAfterAiRoll = false;
      failRoomReads = true;
    }
    return "OK";
  },
  expire: async () => 1,
  ttl:    async () => 100,
  del:    async () => 1,
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

const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
const pickMove = jest.fn(async (gs, color, legalMoves) => legalMoves[0] ?? null);
jest.unstable_mockModule("../game/ai.js", () => ({
  AI_USER_ID,
  AI_DISPLAY: { display_name: "Computer", avatar_url: null },
  MASTER_API_TIMEOUT_MS:  8_000,
  MASTER_API_MAX_RETRIES: 0,
  pickMove,
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { handleConnection, rooms, userConnections, inFlightConnections } = await import("./server.js");
const { pendingRoomLockCount } = await import("./roomLock.js");
const { initGame } = await import("../game/engine.js");
const { signAccessToken } = await import("../auth/tokens.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOM_ID   = "AIRSUM01";
const HUMAN_ID  = "11111111-1111-1111-1111-111111111111";
const START_SEQ = 10;
const GIVE_UP_MS  = 120_000; // the AI's retries must be over by then
const RECOVERY_MS = 30_000;  // a resumed turn must be finished by then

function makeRoom() {
  const gs = initGame();
  gs.turn      = "black";
  gs.phase     = "rolling";
  gs.firstMove = false;
  gs.moveSeq   = START_SEQ;
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

const getRoom = () => JSON.parse(store.get(`room:${ROOM_ID}`));
const roomSaves = () => saves.filter((s) => s.key === `room:${ROOM_ID}`).map((s) => s.room);

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

const connect = (ws) =>
  handleConnection(ws, { url: `/ws?token=${signAccessToken(HUMAN_ID)}&room=${ROOM_ID}` });

function disconnect(ws) {
  ws.readyState = 3;
  ws.emit("close");
}

async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

async function runUntil(cond, ms) {
  let t = 0;
  while (!cond() && t < ms) { await jest.advanceTimersByTimeAsync(100); t += 100; }
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  roomReads = 0;
  failRoomReads = false;
  failAfterAiRoll = false;
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  query.mockClear();
  pickMove.mockClear();
  store.set(`room:${ROOM_ID}`, JSON.stringify(makeRoom()));
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  failRoomReads = false;
  failAfterAiRoll = false;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("after the AI gives up mid-move on a failing Redis, a reconnect of the human resumes and finishes the AI's turn with the same dice", async () => {
  // The human connects; black is to roll, so the connect starts the AI turn.
  failAfterAiRoll = true;
  const ws1 = fakeWs();
  await connect(ws1);

  // The AI rolls (saved), then Redis fails for good in its move step, and
  // its retries give up.
  await runFor(GIVE_UP_MS);
  expect(failRoomReads).toBe(true);
  const readsAtGiveUp = roomReads;
  await runFor(60_000);
  expect(roomReads).toBe(readsAtGiveUp); // no attempts left running

  const afterRoll = getRoom();
  expect(afterRoll.gameState).toMatchObject({ turn: "black", phase: "moving" });
  expect(afterRoll.gameState.legalMoves.length).toBeGreaterThan(0);
  expect(afterRoll.gameState.moveSeq).toBe(START_SEQ);
  expect(pendingRoomLockCount()).toBe(0);

  // Redis recovers. The human's socket drops and reconnects through the
  // real connect path; nothing calls triggerAiTurn directly.
  failRoomReads = false;
  disconnect(ws1);
  await jest.advanceTimersByTimeAsync(0);
  const ws2 = fakeWs();
  await connect(ws2);

  await runUntil(() => getRoom().gameState.turn === "white", RECOVERY_MS);

  const room = getRoom();
  expect(room.status).toBe("playing");
  expect(room.gameState.turn).toBe("white");
  expect(room.gameState.phase).toBe("rolling");
  expect(room.gameState.dice).toEqual([]);
  expect(room.gameState.legalMoves).toEqual([]);
  expect(room.gameState.moveSeq).toBeGreaterThan(START_SEQ);
  // Same dice: every black state saved during the turn has the one roll's
  // dice, i.e. the reconnect did not make the AI roll again.
  for (const s of roomSaves().filter((r) => r.gameState.turn === "black")) {
    expect(s.gameState.rolledDice).toEqual(afterRoll.gameState.rolledDice);
  }
  // The reconnect cancelled the human's disconnect forfeit.
  await runFor(70_000);
  expect(getRoom().status).toBe("playing");
}, 300_000);
