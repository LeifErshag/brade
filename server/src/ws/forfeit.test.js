// ── Disconnect forfeit vs. reconnect (issue #59) ─────────────────────────────
// A player who disconnects mid-game is forfeited after 60 s unless they
// reconnect. The forfeit's RESIGN runs under the room's lock, so it can queue
// behind a reconnect of the same player that already holds the lock. By then
// the timer has fired and cancelDisconnectForfeit cannot stop it; the queued
// forfeit must see that the player is connected again and leave the game be.
//
// Real server.js, handlers.js and roomLock.js; Redis and Postgres are fakes.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

const store = new Map();
// Lets a test hold a connect inside the room lock (at its TTL refresh).
let expireGate = null;
// Lets a test hold the next Redis GET (one-shot), e.g. the close handler's.
let nextGetGate = null;
const fakeRedis = {
  get:    async (k) => {
    if (nextGetGate) { const g = nextGetGate; nextGetGate = null; await g; }
    return store.get(k) ?? null;
  },
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => { if (expireGate) await expireGate; return 1; },
  ttl:    async () => 100,
  del:    async () => 1,
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

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { handleConnection, rooms, userConnections, inFlightConnections } = await import("./server.js");
const { withRoomLock } = await import("./roomLock.js");
const { initGame } = await import("../game/engine.js");
const { signAccessToken } = await import("../auth/tokens.js");

const ROOM_ID    = "FORF1234";
const OTHER_ID   = "OTHR1234";
const WHITE_ID   = "11111111-1111-1111-1111-111111111111";
const BLACK_ID   = "22222222-2222-2222-2222-222222222222";
const FORFEIT_MS = 60_000;

function playingRoom(roomId) {
  const gs = initGame();
  gs.turn  = "white";
  gs.phase = "rolling";
  return {
    roomId,
    matchLength: 1,
    createdBy:   WHITE_ID,
    gameDbId:    "game-uuid",
    players:     { white: WHITE_ID, black: BLACK_ID },
    playerInfo:  { white: { display_name: "White" }, black: { display_name: "Black" } },
    ready:       { white: true, black: true },
    status:      "playing",
    score:       { white: 0, black: 0 },
    gameNum:     1,
    gameState:   gs,
  };
}

const saved = (roomId = ROOM_ID) => JSON.parse(store.get(`room:${roomId}`));

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

const connect = (ws, userId, roomId = ROOM_ID) =>
  handleConnection(ws, { url: `/ws?token=${signAccessToken(userId)}&room=${roomId}` });

function disconnect(ws) {
  ws.readyState = 3;
  ws.emit("close");
}

// Let pending promise chains run (without advancing fake time) and wait for
// everything queued on the room's lock to finish.
async function settle(roomId = ROOM_ID) {
  for (let i = 0; i < 5; i++) {
    await jest.advanceTimersByTimeAsync(0);
    await withRoomLock(roomId, async () => {});
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const sentTypes = (ws) => ws.send.mock.calls.map(([raw]) => JSON.parse(raw).type);
const gameRecorded = () =>
  query.mock.calls.some(([sql]) => /UPDATE\s+games/i.test(sql));

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  query.mockClear();
  expireGate = null;
  nextGetGate = null;
  store.set(`room:${ROOM_ID}`, JSON.stringify(playingRoom(ROOM_ID)));
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Both players connected, then black's socket drops (scheduling the forfeit).
async function blackDisconnects() {
  const whiteWs = fakeWs();
  const blackWs = fakeWs();
  await connect(whiteWs, WHITE_ID);
  await connect(blackWs, BLACK_ID);
  disconnect(blackWs);
  await settle();
  return { whiteWs };
}

// Black reconnects while the forfeit timer fires: the connect holds the room
// lock (stuck at its TTL refresh) when the timer goes off, so the forfeit
// queues behind it. Resolves once the reconnect has registered and the
// queued forfeit section has run.
async function reconnectWhileForfeitFires() {
  const gate = deferred();
  expireGate = gate.promise;
  const ws = fakeWs();
  const reconnect = connect(ws, BLACK_ID);
  await jest.advanceTimersByTimeAsync(0);

  await jest.advanceTimersByTimeAsync(FORFEIT_MS);

  expireGate = null;
  gate.resolve();
  await reconnect;
  await settle();
  return ws;
}

describe("disconnect forfeit", () => {
  test("forfeits a player who is still disconnected when the forfeit runs", async () => {
    const { whiteWs } = await blackDisconnects();

    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    await settle();

    const room = saved();
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(gameRecorded()).toBe(true);
    expect(sentTypes(whiteWs)).toContain("MATCH_OVER");
  });

  test("a connection of the same player to another room does not prevent the forfeit", async () => {
    store.set(`room:${OTHER_ID}`, JSON.stringify(playingRoom(OTHER_ID)));
    await blackDisconnects();
    await connect(fakeWs(), BLACK_ID, OTHER_ID);

    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    await settle();

    expect(saved().status).toBe("finished");
    expect(saved().matchResult).toMatchObject({ winner: "white", winType: "resign" });
  });

  test("a reconnect before the timer fires cancels the forfeit", async () => {
    await blackDisconnects();
    await jest.advanceTimersByTimeAsync(FORFEIT_MS - 1_000);
    await connect(fakeWs(), BLACK_ID);

    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    await settle();

    expect(saved().status).toBe("playing");
    expect(saved().matchResult).toBeUndefined();
    expect(gameRecorded()).toBe(false);
  });

  test("a forfeit queued behind the same player's reconnect does not resign the game", async () => {
    const { whiteWs } = await blackDisconnects();

    const blackWs2 = await reconnectWhileForfeitFires();

    expect(rooms.get(ROOM_ID)?.size).toBe(2);
    const room = saved();
    expect(room.status).toBe("playing");
    expect(room.matchResult).toBeUndefined();
    expect(room.score).toEqual({ white: 0, black: 0 });
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(whiteWs)).not.toContain("MATCH_OVER");
    expect(sentTypes(blackWs2)).not.toContain("MATCH_OVER");
  });

  test("after a reconnect beat the queued forfeit, a later disconnect forfeits again", async () => {
    await blackDisconnects();
    const blackWs2 = await reconnectWhileForfeitFires();
    expect(saved().status).toBe("playing");

    disconnect(blackWs2);
    await settle();
    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    await settle();

    expect(saved().status).toBe("finished");
    expect(saved().matchResult).toMatchObject({ winner: "white", winType: "resign" });
  });

  // Issue #70: the close handler awaits Redis outside the room lock before it
  // schedules the forfeit, so a quick reconnect can register first. The timer
  // scheduled afterwards is stale and must do nothing when it fires.
  test("a forfeit scheduled by the close handler after a quick reconnect registered is a no-op", async () => {
    const whiteWs = fakeWs();
    const blackWs = fakeWs();
    await connect(whiteWs, WHITE_ID);
    await connect(blackWs, BLACK_ID);

    // Hold the close handler at its Redis read.
    const gate = deferred();
    nextGetGate = gate.promise;
    disconnect(blackWs);
    await jest.advanceTimersByTimeAsync(0);

    // Black reconnects and registers while the close handler is still waiting.
    const blackWs2 = fakeWs();
    await connect(blackWs2, BLACK_ID);
    expect(rooms.get(ROOM_ID)?.size).toBe(2);

    // Now the close handler resumes and schedules the (stale) forfeit.
    gate.resolve();
    await settle();

    await jest.advanceTimersByTimeAsync(FORFEIT_MS + 1_000);
    await settle();

    expect(rooms.get(ROOM_ID)?.size).toBe(2);
    const room = saved();
    expect(room.status).toBe("playing");
    expect(room.matchResult).toBeUndefined();
    expect(room.score).toEqual({ white: 0, black: 0 });
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(whiteWs)).not.toContain("MATCH_OVER");
    expect(sentTypes(blackWs2)).not.toContain("MATCH_OVER");
  });

  // Issue #70: black reconnects ahead of a queued forfeit (the first
  // disconnect's timer has fired and waits for the lock) and drops again
  // before that forfeit's locked section runs. The first disconnect's forfeit
  // must not resign the game; only the second disconnect's 60 s may.
  test("a queued forfeit from an earlier disconnect does not fire for a later disconnect", async () => {
    const { whiteWs } = await blackDisconnects();
    const firstDisconnectAt = Date.now();

    const gate = deferred();
    expireGate = gate.promise;
    const blackWs2 = fakeWs();
    // When the reconnect registers (its first ROOM_STATE goes out), drop the
    // socket again in a microtask, i.e. right after connectToRoom's
    // synchronous registration, before the queued forfeit gets the lock.
    // (A promise job, not queueMicrotask, which the fake timers replace.)
    let dropped = false;
    blackWs2.send.mockImplementation(() => {
      if (dropped) return;
      dropped = true;
      Promise.resolve().then(() => disconnect(blackWs2));
    });
    const reconnect = connect(blackWs2, BLACK_ID);
    await jest.advanceTimersByTimeAsync(0);

    // The first disconnect's timer fires while the reconnect holds the lock.
    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    expireGate = null;
    gate.resolve();
    await reconnect;
    await settle();
    expect(dropped).toBe(true);
    const secondDisconnectAt = Date.now();
    expect(secondDisconnectAt).toBeGreaterThanOrEqual(firstDisconnectAt + FORFEIT_MS);

    // First disconnect + 60 s + epsilon: not forfeited.
    await jest.advanceTimersByTimeAsync(1);
    await settle();
    expect(Date.now()).toBeGreaterThan(firstDisconnectAt + FORFEIT_MS);
    expect(saved().status).toBe("playing");
    expect(saved().matchResult).toBeUndefined();
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(whiteWs)).not.toContain("MATCH_OVER");

    // Still not forfeited shortly before second disconnect + 60 s.
    await jest.advanceTimersByTimeAsync(secondDisconnectAt + FORFEIT_MS - 1_000 - Date.now());
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    // Forfeited by second disconnect + 60 s.
    await jest.advanceTimersByTimeAsync(secondDisconnectAt + FORFEIT_MS - Date.now());
    await settle();
    const room = saved();
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(gameRecorded()).toBe(true);
    expect(sentTypes(whiteWs)).toContain("MATCH_OVER");
  });
});
