// ── Tutorial games are never recorded as rated games ─────────────────────────
// Postgres, Redis and the WebSocket broadcast layer are replaced with in-memory
// fakes so we can watch every SQL statement the server issues. Verifies that:
//   1. POST /api/games/tutorial creates an `isTutorial` room vs the random-move tutorial AI
//      without inserting a `games` row (guest and logged-in).
//   2. Finishing a tutorial game (by winning or resigning) issues no SQL at all:
//      no move log, no games update, no ELO / wins / losses.
//   3. Control: the same finish in a normal AI game DOES update the user, so the
//      fakes really would catch a write.

import { jest } from "@jest/globals";

// ── Fakes ────────────────────────────────────────────────────────────────────

const store = new Map();
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
  ttl:    async () => 100,
};

const query = jest.fn(async (sql) => {
  if (/SELECT display_name, avatar_url FROM users/.test(sql)) {
    return { rows: [{ display_name: "Lärling", avatar_url: null }] };
  }
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
  broadcastToRoom: (roomId, payload) => broadcasts.push(payload),
  broadcastState:  () => {},
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { handleMessage, triggerAiTurn } = await import("./handlers.js");
const { default: gamesRouter } = await import("../routes/games.js");
const { signAccessToken } = await import("../auth/tokens.js");
const { getLegalMoves } = await import("../game/engine.js");
const { AI_USER_ID } = await import("../game/ai.js");
const { default: express } = await import("express");

// ── Helpers ──────────────────────────────────────────────────────────────────

const HUMAN_ID = "11111111-1111-1111-1111-111111111111";

const RATING_SQL = /INSERT INTO games|UPDATE games|UPDATE users|INSERT INTO moves|elo|wins|losses/i;

function sqlCalls() {
  return query.mock.calls.map(([sql]) => sql);
}

// White has 14 checkers off and one on point 24 with a 1 to play: the next
// move bears off the last checker and wins (hemspel).
function oneMoveFromWin() {
  const board = new Array(24).fill(0);
  board[23] = 1;
  board[12] = -15;
  const gs = {
    board,
    bar:        { white: 0, black: 0 },
    off:        { white: 14, black: 0 },
    turn:       "white",
    phase:      "moving",
    dice:       [1, 3],
    rolledDice: [1, 3],
    legalMoves: [],
    moveSeq:    40,
    firstMove:  false,
  };
  gs.legalMoves = getLegalMoves(gs, "white");
  return gs;
}

function makeRoom(roomId, { isTutorial }) {
  return {
    roomId,
    matchLength:  1,
    createdBy:    HUMAN_ID,
    isAi:         true,
    ...(isTutorial ? { isTutorial: true, gameDbId: null } : { gameDbId: "game-uuid" }),
    players:      { white: HUMAN_ID, black: AI_USER_ID },
    playerInfo:   { white: { display_name: "Lärling" }, black: { display_name: "Computer" } },
    ready:        { white: true, black: true },
    status:       "playing",
    score:        { white: 0, black: 0 },
    gameNum:      1,
    gameState:    oneMoveFromWin(),
  };
}

async function putRoom(room) {
  await fakeRedis.set(`room:${room.roomId}`, JSON.stringify(room));
}

async function getRoom(roomId) {
  return JSON.parse(await fakeRedis.get(`room:${roomId}`));
}

beforeEach(() => {
  store.clear();
  broadcasts.length = 0;
  query.mockClear();
});

// ── Room creation ────────────────────────────────────────────────────────────

describe("POST /api/games/tutorial", () => {
  let server, base;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/games", gamesRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/games`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test("guest: creates an unrated tutorial room vs the AI and no games row", async () => {
    const res = await fetch(`${base}/tutorial`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isTutorial).toBe(true);
    expect(body.token).toEqual(expect.any(String));
    expect(body.roomId).toMatch(/^[A-Z0-9]{8}$/);

    const room = await getRoom(body.roomId);
    expect(room.isTutorial).toBe(true);
    expect(room.isAi).toBe(true);
    expect(room.matchLength).toBe(1);
    expect(room.gameDbId).toBeNull();
    expect(room.players).toEqual({ white: body.guestId, black: AI_USER_ID });
    expect(room.gameState.turn).toBe("white");

    expect(query).not.toHaveBeenCalled();
  });

  test("logged in: uses the user's identity but still writes no games row", async () => {
    const token = signAccessToken(HUMAN_ID);
    const res = await fetch(`${base}/tutorial`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    "{}",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeUndefined();

    const room = await getRoom(body.roomId);
    expect(room.isTutorial).toBe(true);
    expect(room.players.white).toBe(HUMAN_ID);
    expect(room.playerInfo.white.display_name).toBe("Lärling");

    for (const sql of sqlCalls()) expect(sql).not.toMatch(RATING_SQL);
  });

  test("rejects an invalid token instead of silently becoming a guest", async () => {
    const res = await fetch(`${base}/tutorial`, {
      method: "POST", headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
    expect(store.size).toBe(0);
  });

  test("end to end: create via the endpoint, play to a win, and nothing is written", async () => {
    const res = await fetch(`${base}/tutorial`, { method: "POST" });
    const { roomId, guestId } = await res.json();

    // Fast-forward the created room to one move before the learner wins.
    const room = await getRoom(roomId);
    room.gameState = oneMoveFromWin();
    await putRoom(room);

    await handleMessage({
      msg: { type: "MOVE", from: 23, to: "off", die: 1 },
      userId: guestId, roomId, ws: null,
    });

    const after = await getRoom(roomId);
    expect(after.status).toBe("finished");
    expect(after.matchResult).toMatchObject({ winner: "white", winType: "hemspel", unrated: true });
    expect(query).not.toHaveBeenCalled();
  });

  test("accepts no options from the client", async () => {
    const res = await fetch(`${base}/tutorial`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ isTutorial: false }),
    });
    expect(res.status).toBe(400);
    expect(store.size).toBe(0);
  });
});

// ── START_GAME ───────────────────────────────────────────────────────────────

describe("START_GAME in a tutorial room", () => {
  test("is rejected, issues no SQL and leaves the room unchanged", async () => {
    // The learner is the host, black is the AI and both are "ready" — this
    // used to pass every check and then crash on the missing games row.
    await putRoom(makeRoom("TUTOR004", { isTutorial: true }));
    const before = await fakeRedis.get("room:TUTOR004");

    const sent = [];
    const ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
    await expect(handleMessage({
      msg: { type: "START_GAME" }, userId: HUMAN_ID, roomId: "TUTOR004", ws,
    })).resolves.toBeUndefined();

    expect(sent).toContainEqual(expect.objectContaining({ type: "ERROR" }));
    expect(query).not.toHaveBeenCalled();
    expect(await fakeRedis.get("room:TUTOR004")).toBe(before);
  });
});

// ── Game over ────────────────────────────────────────────────────────────────

describe("finishing a tutorial game", () => {
  test("winning by bearing off issues no SQL (no move log, no games row, no ELO/stats)", async () => {
    await putRoom(makeRoom("TUTOR001", { isTutorial: true }));

    await handleMessage({
      msg: { type: "MOVE", from: 23, to: "off", die: 1 },
      userId: HUMAN_ID, roomId: "TUTOR001", ws: null,
    });

    const room = await getRoom("TUTOR001");
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", winType: "hemspel", unrated: true });
    expect(room.matchResult.whiteEloAfter).toBeUndefined();
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "MATCH_OVER", winner: "white" }));

    expect(query).not.toHaveBeenCalled();
  });

  test("resigning issues no SQL", async () => {
    await putRoom(makeRoom("TUTOR002", { isTutorial: true }));

    await handleMessage({ msg: { type: "RESIGN" }, userId: HUMAN_ID, roomId: "TUTOR002", ws: null });

    const room = await getRoom("TUTOR002");
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "black", winType: "resign", unrated: true });
    expect(query).not.toHaveBeenCalled();
  });

  test("an AI win (via triggerAiTurn) issues no SQL", async () => {
    // Black (the AI) has 14 off and its last checker on its point 24 (index
    // 11): any roll bears it off and wins.
    const room = makeRoom("TUTOR003", { isTutorial: true });
    const board = new Array(24).fill(0);
    board[0]  = 15;
    board[11] = -1;
    room.gameState = {
      ...room.gameState,
      board,
      off:        { white: 0, black: 14 },
      turn:       "black",
      phase:      "rolling",
      dice:       [],
      rolledDice: [],
      legalMoves: [],
    };
    await putRoom(room);

    await triggerAiTurn("TUTOR003");

    const after = await getRoom("TUTOR003");
    expect(after.status).toBe("finished");
    expect(after.matchResult).toMatchObject({ winner: "black", winType: "hemspel", unrated: true });
    expect(query).not.toHaveBeenCalled();
  }, 10_000);

  test("control: the same win in a normal AI game is rated", async () => {
    await putRoom(makeRoom("RATED001", { isTutorial: false }));

    await handleMessage({
      msg: { type: "MOVE", from: 23, to: "off", die: 1 },
      userId: HUMAN_ID, roomId: "RATED001", ws: null,
    });

    const calls = sqlCalls();
    expect(calls.some((sql) => /INSERT INTO moves/.test(sql))).toBe(true);
    expect(calls.some((sql) => /UPDATE games/.test(sql))).toBe(true);
    expect(calls.some((sql) => /UPDATE users SET elo = \$2, wins = wins \+ 1/.test(sql))).toBe(true);
    const room = await getRoom("RATED001");
    expect(room.matchResult.whiteEloAfter).toEqual(expect.any(Number));
  });
});
