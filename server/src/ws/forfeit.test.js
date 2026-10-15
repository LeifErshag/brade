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
// Test-only export: number of pending (scheduled or fired but not yet run)
// disconnect-forfeit entries.
const { pendingForfeitCount, scheduleDisconnectForfeit } = await import("./handlers.js");
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
    expect(pendingForfeitCount()).toBe(0);
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
    expect(jest.getTimerCount()).toBe(1);
    await connect(fakeWs(), BLACK_ID);
    // Checked before time moves on: the cancel cleared the pending timer.
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);

    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    await settle();

    expect(saved().status).toBe("playing");
    expect(saved().matchResult).toBeUndefined();
    expect(gameRecorded()).toBe(false);
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
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
    expect(pendingForfeitCount()).toBe(0);
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
    expect(pendingForfeitCount()).toBe(0);
  });

  // Issue #70: black reconnects ahead of a queued forfeit (the first
  // disconnect's timer has fired and waits for the lock) and drops again
  // before that forfeit's locked section runs. The first disconnect's forfeit
  // must not resign the game; only the second disconnect's 60 s may.
  //
  // Two orderings of the second close handler versus the queued forfeit:
  // - "held": the second close handler's Redis read is held until the queued
  //   first forfeit's section has run (as in production, a network round
  //   trip), so only the reconnect's cancel can make that forfeit stale;
  // - "unheld": the fake read resolves at once, so the second close handler
  //   schedules a new forfeit before the queued one runs. The reconnect's
  //   cancel has already removed the first entry, so this does not replace
  //   it; it checks that the queued forfeit is not revived by the mere
  //   existence of a newer pending forfeit (e.g. one shared token). The
  //   replace path is pinned by the two-tab test below.
  test.each([
    ["held", true],
    ["unheld", false],
  ])("a queued forfeit from an earlier disconnect does not fire for a later disconnect (%s close read)", async (_label, holdCloseRead) => {
    const { whiteWs } = await blackDisconnects();
    const firstDisconnectAt = Date.now();

    const gate = deferred();
    expireGate = gate.promise;
    const blackWs2 = fakeWs();
    // When the reconnect registers (its first ROOM_STATE goes out), drop the
    // socket again in a microtask, i.e. right after connectToRoom's
    // synchronous registration, before the queued forfeit gets the lock.
    // (A promise job, not queueMicrotask, which the fake timers replace.)
    const closeGate = deferred();
    let dropped = false;
    blackWs2.send.mockImplementation(() => {
      if (dropped) return;
      dropped = true;
      Promise.resolve().then(() => {
        if (holdCloseRead) nextGetGate = closeGate.promise;
        disconnect(blackWs2);
      });
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
    // When held, the close handler's read consumed the one-shot gate.
    expect(nextGetGate).toBeNull();
    // Drain the lock so the queued first forfeit's section has run.
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);
    // Now let the (held) second close handler schedule its forfeit.
    closeGate.resolve();
    await settle();
    expect(pendingForfeitCount()).toBe(1);
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
    expect(pendingForfeitCount()).toBe(0);
  });

  // Issue #70, replace path: forfeit A for black has fired and is queued
  // behind a connect that holds the room lock when a newer schedule B for the
  // same player replaces A's entry. A must be a no-op; only B, 60 s after it
  // was scheduled, may forfeit. Since #79 the close handler no longer
  // schedules while the player has another registered connection, so two
  // tabs can no longer produce this order; the schedules are made directly
  // here to keep the token check covered. Black is not connected throughout.
  test("a newer forfeit schedule replaces one that has fired and is still queued", async () => {
    const whiteWs = fakeWs();
    await connect(whiteWs, WHITE_ID);
    const startAt = Date.now();

    scheduleDisconnectForfeit(ROOM_ID, "black", BLACK_ID); // A
    expect(pendingForfeitCount()).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    // White opens a second tab; its connect holds the lock at the TTL refresh.
    const gate = deferred();
    expireGate = gate.promise;
    const whiteTab2 = fakeWs();
    const lockHolder = connect(whiteTab2, WHITE_ID);
    await jest.advanceTimersByTimeAsync(0);

    // A fires and queues behind the held connect.
    await jest.advanceTimersByTimeAsync(FORFEIT_MS);
    expect(jest.getTimerCount()).toBe(0);

    // B is scheduled while A is still queued.
    scheduleDisconnectForfeit(ROOM_ID, "black", BLACK_ID); // B
    const secondScheduleAt = Date.now();
    expect(secondScheduleAt).toBe(startAt + FORFEIT_MS);
    expect(pendingForfeitCount()).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    // Release the lock: the held connect, then A's section, run.
    expireGate = null;
    gate.resolve();
    await lockHolder;
    await settle();
    expect(saved().status).toBe("playing");
    expect(saved().matchResult).toBeUndefined();
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(whiteWs)).not.toContain("MATCH_OVER");
    expect(pendingForfeitCount()).toBe(1);

    // Not forfeited shortly before B's schedule + 60 s.
    await jest.advanceTimersByTimeAsync(FORFEIT_MS - 1_000);
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    // Forfeited by B's schedule + 60 s (about 120 s from the start).
    await jest.advanceTimersByTimeAsync(secondScheduleAt + FORFEIT_MS - Date.now());
    await settle();
    const room = saved();
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(gameRecorded()).toBe(true);
    expect(sentTypes(whiteWs)).toContain("MATCH_OVER");
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  // Two black tabs drop 10 s apart: a single forfeit happens 60 s after the
  // second drop, none 60 s after the first (since #79 the first drop, with
  // tab 2 still registered, schedules nothing; before, the second schedule
  // replaced the first).
  test("two tabs dropping 10 s apart forfeit once, 60 s after the second drop", async () => {
    const whiteWs = fakeWs();
    const blackTab1 = fakeWs();
    const blackTab2 = fakeWs();
    await connect(whiteWs, WHITE_ID);
    await connect(blackTab1, BLACK_ID);
    await connect(blackTab2, BLACK_ID);

    disconnect(blackTab1);
    await settle();
    await jest.advanceTimersByTimeAsync(10_000);
    disconnect(blackTab2);
    await settle();
    const secondDropAt = Date.now();
    expect(pendingForfeitCount()).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    // The first drop's 60 s pass without a forfeit.
    await jest.advanceTimersByTimeAsync(FORFEIT_MS - 1_000);
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    // Forfeited once, 60 s after the second drop.
    await jest.advanceTimersByTimeAsync(secondDropAt + FORFEIT_MS - Date.now());
    await settle();
    expect(saved().status).toBe("finished");
    expect(saved().matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(sentTypes(whiteWs).filter(t => t === "MATCH_OVER")).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => /UPDATE\s+games/i.test(sql))).toHaveLength(1);
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
