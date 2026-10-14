// ── AI keeps playing after losing a non-final game on its own turn (#57) ─────
// Redis, Postgres and the WebSocket layer are replaced with in-memory fakes,
// and timers are faked so the AI's "thinking" delays run instantly.
//
// In a match, the loser of a game starts the next one (§1). When the AI
// (black) loses a game during its own turn, black starts the next game and
// the AI must roll for it straight away, without the human reconnecting or
// sending anything. Both places where the AI's turn can end the game are
// covered:
//   1. the roll: the AI rolls, has no legal move and is jan (closed out on
//      the bar);
//   2. a move: the AI enters a checker from the bar, then has no move left
//      while still closed out on the bar, which is jan.
// Regression: a normal AI turn is never played twice, even when the AI turn
// is triggered more than once for the same room.

import { jest } from "@jest/globals";

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

const broadcasts = [];
jest.unstable_mockModule("./server.js", () => ({
  rooms:           new Map(),
  userConnections: new Map(),
  send:            (ws, payload) => ws?.send?.(JSON.stringify(payload)),
  sendToUser:      () => {},
  broadcastToRoom: (roomId, payload) => broadcasts.push({ roomId, payload }),
  broadcastState:  () => {},
}));

const { handleMessage, triggerAiTurn } = await import("./handlers.js");
const { initGame, getLegalMoves, pathToIdx } = await import("../game/engine.js");
const { AI_USER_ID } = await import("../game/ai.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID = "11111111-1111-1111-1111-111111111111";

// Every possible roll, as the engine represents it (doubles give four dice).
const ALL_ROLLS = [];
for (let a = 1; a <= 6; a++) {
  for (let b = a; b <= 6; b++) ALL_ROLLS.push(a === b ? [a, a, a, a] : [a, b]);
}

function makeRoom(roomId, gameState, { matchLength = 3, gameNum = 1 } = {}) {
  return {
    roomId,
    matchLength,
    createdBy:    HUMAN_ID,
    isAi:         true,
    aiDifficulty: "beginner",
    gameDbId:     "game-uuid",
    players:      { white: HUMAN_ID, black: AI_USER_ID },
    playerInfo:   { white: { display_name: "Human" }, black: { display_name: "Computer" } },
    ready:        { white: true, black: true },
    status:       "playing",
    score:        { white: 0, black: 0 },
    gameNum,
    gameState,
  };
}

function blackToRoll(board, bar) {
  return {
    ...initGame(),
    board,
    bar,
    off:        { white: 0, black: 0 },
    turn:       "black",
    phase:      "rolling",
    dice:       [],
    rolledDice: [],
    legalMoves: [],
    moveSeq:    30,
    firstMove:  false,
  };
}

// Jan at the roll: black's own checkers stand on all six of its entry points
// (path pos 0–5) and five more are on the bar. Whatever the AI rolls it cannot
// enter, so it has no legal move and is jan (§10): white wins the game.
function janOnRollState() {
  const board = new Array(24).fill(0);
  for (let pos = 0; pos <= 5; pos++) board[pathToIdx("black", pos)] = -1;
  board[pathToIdx("black", 8)] = -4;
  board[pathToIdx("black", 14)] = 15;   // all white checkers, out of the way
  return blackToRoll(board, { white: 0, black: 5 });
}

// Jan after a move: white has two checkers on each of black's six entry
// points, three more white checkers elsewhere, and black has seven on the
// bar. Whatever the AI rolls it enters at least one checker, then runs out of
// moves while still closed out on the bar: jan (§10), white wins the game.
function janAfterMoveState() {
  const board = new Array(24).fill(0);
  for (let pos = 0; pos <= 5; pos++) board[pathToIdx("black", pos)] = 2;
  board[pathToIdx("black", 18)] = 3;
  board[pathToIdx("black", 12)] = -8;
  return blackToRoll(board, { white: 0, black: 7 });
}

async function putRoom(room) {
  await fakeRedis.set(`room:${room.roomId}`, JSON.stringify(room));
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

function savesOf(roomId) {
  return saves.filter((s) => s.key === `room:${roomId}`).map((s) => s.room);
}

// Number of times the AI rolled in game `gameNum` and got moves to play: a
// save that moves black from its rolling phase into its moving phase.
function aiRollsWithMoves(roomId, gameNum) {
  const history = savesOf(roomId);
  let n = 0;
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1], cur = history[i];
    if (cur.gameNum !== gameNum || prev.gameNum !== gameNum) continue;
    if (prev.gameState.turn === "black" && prev.gameState.phase === "rolling" &&
        cur.gameState.turn  === "black" && cur.gameState.phase  === "moving") n++;
  }
  return n;
}

// Advance fake time in small steps, letting promises settle between timers.
async function runFor(ms) {
  for (let t = 0; t < ms; t += 100) await jest.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  saves.length = 0;
  broadcasts.length = 0;
  query.mockClear();
});

afterEach(async () => {
  // Let any AI turn still in flight finish before the next test.
  await runFor(20_000);
  jest.useRealTimers();
});

// ── Fixture sanity ───────────────────────────────────────────────────────────

describe("fixtures", () => {
  test("jan-on-roll: no roll lets the AI enter from the bar", () => {
    for (const dice of ALL_ROLLS) {
      const gs = { ...janOnRollState(), phase: "moving", dice: dice.slice(), rolledDice: dice.slice() };
      expect(getLegalMoves(gs, "black")).toEqual([]);
    }
  });

  test("jan-after-move: every roll lets the AI enter from the bar", () => {
    for (const dice of ALL_ROLLS) {
      const gs = { ...janAfterMoveState(), phase: "moving", dice: dice.slice(), rolledDice: dice.slice() };
      expect(getLegalMoves(gs, "black").length).toBeGreaterThan(0);
    }
  });
});

// ── Bug #57 ──────────────────────────────────────────────────────────────────

describe.each([
  ["at its roll (no legal move, closed out on the bar)", "NEXTRL01", janOnRollState],
  ["after a move (entered, then stuck on the bar)",      "NEXTMV01", janAfterMoveState],
])("AI loses a non-final game by jan %s", (_label, roomId, makeState) => {
  test("black starts the next game and the AI rolls for it without a reconnect", async () => {
    await putRoom(makeRoom(roomId, makeState()));

    // The AI's turn starts once (as after the human hands over the turn);
    // nothing else triggers it afterwards.
    const turn = triggerAiTurn(roomId, "beginner");
    await runFor(20_000);
    await turn;

    const room = await getRoom(roomId);

    // Game 1 went to white by jan, the match goes on with game 2.
    expect(room.status).toBe("playing");
    expect(room.gameNum).toBe(2);
    expect(room.gameResults).toEqual([expect.objectContaining({ winner: "white", winType: "jan" })]);
    expect(room.score.white).toBeGreaterThan(0);
    expect(broadcasts).toContainEqual({
      roomId,
      payload: expect.objectContaining({ type: "GAME_OVER", winner: "white", winType: "jan" }),
    });

    // Black (the loser) was given the first turn of game 2 ...
    const game2 = savesOf(roomId).filter((r) => r.gameNum === 2);
    expect(game2[0].gameState).toMatchObject({ turn: "black", phase: "rolling", moveSeq: 0 });

    // ... and the AI rolled once and played its turn, handing it to white.
    expect(aiRollsWithMoves(roomId, 2)).toBe(1);
    expect(room.gameState.rolledDice.length).toBeGreaterThan(0);
    expect(room.gameState.moveSeq).toBeGreaterThan(0);
    expect(room.gameState.turn).toBe("white");
    expect(room.gameState.phase).toBe("rolling");
  }, 30_000);
});

// ── Regression: one AI turn at a time ────────────────────────────────────────

describe("a normal AI turn", () => {
  test("is played once when the AI turn is triggered twice for the same room", async () => {
    const gs = initGame();
    gs.turn      = "black";
    gs.firstMove = false;
    await putRoom(makeRoom("ONCEAI01", gs));

    const first  = triggerAiTurn("ONCEAI01", "beginner");
    const second = triggerAiTurn("ONCEAI01", "beginner");
    await runFor(20_000);
    await Promise.all([first, second]);

    const room = await getRoom("ONCEAI01");
    expect(aiRollsWithMoves("ONCEAI01", 1)).toBe(1);
    expect(room.gameNum).toBe(1);
    expect(room.gameState.turn).toBe("white");
    expect(room.gameState.phase).toBe("rolling");
    expect(room.gameState.moveSeq).toBeGreaterThan(0);
    // Every save after the roll belongs to that one turn: the AI only moved
    // while it was black's moving phase, then handed the turn over once.
    const handovers = savesOf("ONCEAI01").filter(
      (r, i, all) => i > 0 && all[i - 1].gameState.turn === "black" && r.gameState.turn === "white"
    );
    expect(handovers).toHaveLength(1);
  }, 30_000);

  test("handed over by a human move is played once, and nothing runs after it", async () => {
    // White has one die left and any move ends white's turn: the turn passes
    // to the AI through the normal message path.
    const gs = initGame();
    gs.turn       = "white";
    gs.phase      = "moving";
    gs.firstMove  = false;
    gs.dice       = [3];
    gs.rolledDice = [5, 3];
    gs.legalMoves = getLegalMoves(gs, "white");
    expect(gs.legalMoves.length).toBeGreaterThan(0);
    await putRoom(makeRoom("ONCEAI02", gs));

    const { from, to, die } = gs.legalMoves[0];
    await handleMessage({ msg: { type: "MOVE", from, to, die }, userId: HUMAN_ID, roomId: "ONCEAI02", ws: null });
    // A second trigger for the same turn (e.g. the player reconnecting while
    // the AI is thinking) must not start a second turn.
    const extra = triggerAiTurn("ONCEAI02", "beginner");
    await runFor(20_000);
    await extra;

    const room = await getRoom("ONCEAI02");
    expect(aiRollsWithMoves("ONCEAI02", 1)).toBe(1);
    expect(room.gameState.turn).toBe("white");
    expect(room.gameState.phase).toBe("rolling");

    const savedCount = savesOf("ONCEAI02").length;
    await runFor(10_000);
    expect(savesOf("ONCEAI02")).toHaveLength(savedCount);
  }, 30_000);
});
