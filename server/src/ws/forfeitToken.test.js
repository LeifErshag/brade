// ── Disconnect forfeit: per-disconnect token (issue #70) ─────────────────────
// A forfeit belongs to one disconnect. If the player reconnects (cancelling
// it) or disconnects again (superseding it) before the forfeit's locked
// section runs, that forfeit must do nothing; only the latest disconnect's
// timer may forfeit.
//
// Real server.js, handlers.js and roomLock.js; Redis and Postgres are fakes.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

const store = new Map();
// Lets a test hold a connect inside the room lock (at its TTL refresh).
let expireGate = null;
// Lets a test hold the next Redis get (e.g. the close handler's read).
let getGate = null;
const fakeRedis = {
  get:    async (k) => {
    if (getGate) { const g = getGate; getGate = null; await g; }
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
  getGate = null;
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

describe("disconnect forfeit token", () => {
  test("a forfeit scheduled by a close handler after a quick reconnect registered is a no-op", async () => {
    const whiteWs = fakeWs();
    const blackWs = fakeWs();
    await connect(whiteWs, WHITE_ID);
    await connect(blackWs, BLACK_ID);

    // Hold the close handler's Redis read (outside the lock).
    const gate = deferred();
    getGate = gate.promise;
    disconnect(blackWs);
    await jest.advanceTimersByTimeAsync(0);

    await connect(fakeWs(), BLACK_ID);
    expect(rooms.get(ROOM_ID)?.size).toBe(2);

    gate.resolve();
    await settle();
    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    await settle();

    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(whiteWs)).not.toContain("MATCH_OVER");
  });

  test("a forfeit queued behind a reconnect is void when the player disconnects again before it runs", async () => {
    const { whiteWs } = await blackDisconnects();

    const gate = deferred();
    expireGate = gate.promise;
    const ws = fakeWs();
    // Close the new socket in the promise job right after it registers
    // (its first ROOM_STATE), before the queued forfeit's section starts.
    let closed = false;
    ws.send.mockImplementation((raw) => {
      if (!closed && JSON.parse(raw).type === "ROOM_STATE") {
        closed = true;
        // Not queueMicrotask: Jest's fake timers fake it.
        Promise.resolve().then(() => disconnect(ws));
      }
    });
    const reconnect = connect(ws, BLACK_ID);
    await jest.advanceTimersByTimeAsync(0);

    // T0 + 60 s: the first disconnect's forfeit fires and queues for the lock.
    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    expireGate = null;
    gate.resolve();
    await reconnect;
    await settle();
    expect(closed).toBe(true);

    await jest.advanceTimersByTimeAsync(1);
    await settle();
    expect(saved().status).toBe("playing");

    await jest.advanceTimersByTimeAsync(FORFEIT_MS - 1_000);
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    await jest.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(saved().status).toBe("finished");
    expect(saved().matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(gameRecorded()).toBe(true);
    expect(sentTypes(whiteWs)).toContain("MATCH_OVER");
  });
});
