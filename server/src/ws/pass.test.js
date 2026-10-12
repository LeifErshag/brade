// ── PASS handling (issue #17) ────────────────────────────────────────────────
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes.
// Verifies that:
//   1. PASS is rejected outside the moving phase (a client must not be able to
//      skip its own roll), and the room is left untouched.
//   2. After a legitimate PASS in an AI or tutorial room, the AI takes its turn
//      instead of stalling until the player reconnects.

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
const { initGame } = await import("../game/engine.js");
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
