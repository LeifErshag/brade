// ── AI rolls in the next game after losing during its own turn (issue #57) ───
// Redis, Postgres and the WebSocket layer are in-memory fakes; the real engine
// and AI are used. The AI (black) is closed out on the bar in game 1 of a
// 3-game match, so it loses by jan when it rolls. The loser starts game 2, and
// the AI must roll there by itself instead of waiting for a reconnect.

import { jest } from "@jest/globals";

const store = new Map();
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
  ttl:    async () => 100,
};

const broadcasts = [];

jest.unstable_mockModule("../db/postgres.js", () => ({
  query:           jest.fn(async () => ({ rows: [] })),
  connectPostgres: async () => {},
}));

jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis:     () => fakeRedis,
  connectRedis: async () => {},
  keys: { room: (id) => `room:${id}` },
  TTL:  { room: 86400, refresh: 604800, invite: 172800 },
}));

jest.unstable_mockModule("./server.js", () => ({
  rooms:           new Map(),
  userConnections: new Map(),
  send:            () => {},
  sendToUser:      () => {},
  broadcastToRoom: (_roomId, payload) => broadcasts.push(payload),
  broadcastState:  () => {},
}));

const { triggerAiTurn } = await import("./handlers.js");
const { initGame } = await import("../game/engine.js");
const { AI_USER_ID } = await import("../game/ai.js");

const HUMAN_ID = "11111111-1111-1111-1111-111111111111";

// Black on the bar with its own checkers on every Quarter-1 point: no entry
// is possible, so black is jan as soon as it rolls.
function closedOutBlack() {
  const gs = initGame();
  gs.turn      = "black";
  gs.phase     = "rolling";
  gs.firstMove = false;
  gs.board[12] = -9;
  for (let i = 13; i <= 17; i++) gs.board[i] = -1;
  gs.bar.black = 1;
  return gs;
}

function makeRoom(roomId) {
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
    gameNum:      1,
    gameState:    closedOutBlack(),
  };
}

async function advance(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  broadcasts.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

test("AI loses game 1 by jan at its roll, then rolls in game 2 by itself", async () => {
  const roomId = "AINEXT01";
  store.set(`room:${roomId}`, JSON.stringify(makeRoom(roomId)));

  const turn = triggerAiTurn(roomId, "beginner");
  await advance(20_000);
  await turn;

  const room = JSON.parse(store.get(`room:${roomId}`));
  expect(room.status).toBe("playing");
  expect(room.gameNum).toBe(2);
  expect(room.gameResults).toEqual([{ winner: "white", winType: "jan", points: 4 }]);
  expect(broadcasts).toContainEqual(expect.objectContaining({ type: "GAME_OVER", winner: "white", winType: "jan" }));

  // Black started game 2 and played its turn without a new trigger.
  const gs = room.gameState;
  expect(gs.rolledDice.length).toBeGreaterThan(0);
  expect(gs.moveSeq).toBeGreaterThan(0);
  expect(gs.turn).toBe("white");
  expect(gs.phase).toBe("rolling");
});

test("two concurrent triggers play one AI turn and then stop writing", async () => {
  const roomId = "AINEXT02";
  const gs = initGame();
  gs.turn = "black";
  store.set(`room:${roomId}`, JSON.stringify({ ...makeRoom(roomId), gameState: gs }));

  const writes = [];
  const origSet = fakeRedis.set;
  fakeRedis.set = async (k, v) => { writes.push(JSON.parse(v)); return origSet(k, v); };
  try {
    const a = triggerAiTurn(roomId, "beginner");
    const b = triggerAiTurn(roomId, "beginner");
    await advance(20_000);
    await Promise.all([a, b]);

    const rolls = writes.filter(r => r.gameState.turn === "black" && r.gameState.phase === "moving" && r.gameState.moveSeq === 0);
    expect(rolls).toHaveLength(1);
    const room = JSON.parse(store.get(`room:${roomId}`));
    expect(room.gameState.turn).toBe("white");

    const n = writes.length;
    await advance(10_000);
    expect(writes.length).toBe(n);
  } finally {
    fakeRedis.set = origSet;
  }
});
