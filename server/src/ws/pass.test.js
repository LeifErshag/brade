// ── PASS handling (issue #17) ────────────────────────────────────────────────
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes.
// Verifies that:
//   1. PASS is rejected outside the moving phase (a client must not be able to
//      skip its own roll), and the room is left untouched.
//   2. After a legitimate PASS in an AI or tutorial room, the AI takes its turn
//      instead of stalling until the player reconnects.
//   3. A PASS while closed out on the bar ends the game by jan (§10).
//
// The fixtures below store a moving phase with no legal moves left. In real
// play the server auto-passes as soon as a player has no legal moves, so a
// client-sent PASS in that state is only a fallback; these tests exercise it.

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
  ttl:    async () => 100,
};

const query = jest.fn(async () => ({ rows: [] }));

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

const { handleMessage } = await import("./handlers.js");
const { initGame, pathToIdx } = await import("../game/engine.js");
const { AI_USER_ID } = await import("../game/ai.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID = "11111111-1111-1111-1111-111111111111";

function makeRoom(roomId, gameState, { isTutorial = false } = {}) {
  return {
    roomId,
    matchLength:  1,
    createdBy:    HUMAN_ID,
    isAi:         true,
    aiDifficulty: "beginner",
    ...(isTutorial ? { isTutorial: true, gameDbId: null } : { gameDbId: "game-uuid" }),
    players:      { white: HUMAN_ID, black: AI_USER_ID },
    playerInfo:   { white: { display_name: "Human" }, black: { display_name: "Computer" } },
    ready:        { white: true, black: true },
    status:       "playing",
    score:        { white: 0, black: 0 },
    gameNum:      1,
    gameState,
  };
}

// White to play, opening position.
function whiteState(phase) {
  const gs = initGame();
  gs.turn      = "white";
  gs.phase     = phase;
  gs.firstMove = false;
  return gs;
}

async function putRoom(room) {
  await fakeRedis.set(`room:${room.roomId}`, JSON.stringify(room));
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

function fakeWs() {
  const sent = [];
  return { sent, ws: { readyState: 1, send: (s) => sent.push(JSON.parse(s)) } };
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

beforeEach(() => {
  store.clear();
  query.mockClear();
});

// ── Phase check ──────────────────────────────────────────────────────────────

describe("PASS outside the moving phase", () => {
  test("is rejected in the rolling phase and leaves the room unchanged", async () => {
    await putRoom(makeRoom("PASS0001", whiteState("rolling")));
    const before = await fakeRedis.get("room:PASS0001");

    const { sent, ws } = fakeWs();
    await handleMessage({ msg: { type: "PASS" }, userId: HUMAN_ID, roomId: "PASS0001", ws });

    expect(sent).toContainEqual({ type: "ERROR", message: "Not moving phase" });
    expect(await fakeRedis.get("room:PASS0001")).toBe(before);
  });
});

// ── AI follow-up ─────────────────────────────────────────────────────────────

describe.each([
  ["an AI room",      "PASSAI01", false],
  ["a tutorial room", "PASSTU01", true],
])("PASS in %s", (_label, roomId, isTutorial) => {
  test("hands the turn to the AI, which then plays", async () => {
    // White has rolled and has no dice left to use (e.g. all moves blocked):
    // a legitimate pass.
    const gs = whiteState("moving");
    gs.dice       = [];
    gs.rolledDice = [6, 5];
    gs.legalMoves = [];
    await putRoom(makeRoom(roomId, gs, { isTutorial }));

    const { sent, ws } = fakeWs();
    await handleMessage({ msg: { type: "PASS" }, userId: HUMAN_ID, roomId, ws });
    expect(sent).toEqual([]);

    const afterPass = (await getRoom(roomId)).gameState;
    expect(afterPass.turn).toBe("black");
    expect(afterPass.phase).toBe("rolling");

    // The AI rolls and plays its whole turn, handing the turn back to white.
    const aiPlayed = await waitFor(async () => {
      const { gameState: s } = await getRoom(roomId);
      return s.turn === "white" && s.phase === "rolling" && s.moveSeq > afterPass.moveSeq;
    }, 12_000);
    expect(aiPlayed).toBe(true);
  }, 15_000);
});

// ── Jan on PASS ──────────────────────────────────────────────────────────────

describe("PASS while closed out on the bar", () => {
  test("ends the game by jan against the passer (§10)", async () => {
    // White is to move with three checkers on the bar, and its own checkers
    // block four of its six entry points (available 2 < bar 3): white is jan.
    // The position is deliberately partial (7 white checkers, not 15): only
    // the bar count and the blocked entry points matter for the jan check.
    const gs = whiteState("moving");
    gs.board = new Array(24).fill(0);
    for (const pos of [0, 1, 2, 3]) gs.board[pathToIdx("white", pos)] = 1;
    gs.board[pathToIdx("black", 18)] = -15;   // clear of white's entry quarter
    gs.bar        = { white: 3, black: 0 };
    gs.off        = { white: 0, black: 0 };
    gs.dice       = [];
    gs.rolledDice = [6, 5];
    gs.legalMoves = [];
    // Tutorial room: game over is handled without touching Postgres.
    await putRoom(makeRoom("PASSJAN1", gs, { isTutorial: true }));

    const { sent, ws } = fakeWs();
    await handleMessage({ msg: { type: "PASS" }, userId: HUMAN_ID, roomId: "PASSJAN1", ws });
    expect(sent).toEqual([]);

    const room = await getRoom("PASSJAN1");
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "black", winType: "jan" });
    expect(room.score.black).toBeGreaterThan(0);
  });
});
