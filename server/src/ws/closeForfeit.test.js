// ── Close handler: schedule a disconnect forfeit only for the last connection
// (issue #79) ─────────────────────────────────────────────────────────────────
// When a socket closes mid-game, the close handler schedules a 60 s
// disconnect forfeit for its player. It must not do so while the same user
// still has another open, registered connection in that room (e.g. a second
// tab): that timer would be needless at best. The decision is made at
// schedule time, after the close handler's Redis read, so a reconnect that
// registered during that read also prevents the schedule. Otherwise a stale
// timer from the first drop could fire during a later drop's close handler
// and forfeit at once instead of 60 s after the later drop (#74 review).
//
// Real server.js, handlers.js and roomLock.js; Redis and Postgres are fakes.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

const store = new Map();
// Lets a test hold the next Redis GET (one-shot), e.g. the close handler's.
let nextGetGate = null;
const fakeRedis = {
  get:    async (k) => {
    if (nextGetGate) { const g = nextGetGate; nextGetGate = null; await g; }
    return store.get(k) ?? null;
  },
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
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
const { pendingForfeitCount } = await import("./handlers.js");
const { initGame } = await import("../game/engine.js");
const { signAccessToken } = await import("../auth/tokens.js");

const ROOM_ID    = "CLSF1234";
const WHITE_ID   = "11111111-1111-1111-1111-111111111111";
const BLACK_ID   = "22222222-2222-2222-2222-222222222222";
const FORFEIT_MS = 60_000;
// Allowed slack between a drop and the start of its 60 s (one Redis round
// trip in the close handler).
const SLACK_MS   = 1_000;
// How long a test holds a close handler's Redis read (well over SLACK_MS).
const HELD_READ_MS = 5_000;

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

const saved = () => JSON.parse(store.get(`room:${ROOM_ID}`));

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

const connect = (ws, userId) =>
  handleConnection(ws, { url: `/ws?token=${signAccessToken(userId)}&room=${ROOM_ID}` });

function disconnect(ws) {
  ws.readyState = 3;
  ws.emit("close");
}

// Let pending promise chains run (without advancing fake time) and wait for
// everything queued on the room's lock to finish.
async function settle() {
  for (let i = 0; i < 5; i++) {
    await jest.advanceTimersByTimeAsync(0);
    await withRoomLock(ROOM_ID, async () => {});
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
const blackRegistered = () =>
  [...(rooms.get(ROOM_ID) ?? [])].some((c) => c.userId === BLACK_ID);

beforeEach(() => {
  jest.useFakeTimers();
  store.clear();
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  query.mockClear();
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

describe("close handler forfeit scheduling", () => {
  test("closing one of two open tabs of a player schedules no forfeit", async () => {
    const whiteWs = fakeWs();
    const blackTab1 = fakeWs();
    const blackTab2 = fakeWs();
    await connect(whiteWs, WHITE_ID);
    await connect(blackTab1, BLACK_ID);
    await connect(blackTab2, BLACK_ID);

    disconnect(blackTab1);
    await settle();

    expect(blackRegistered()).toBe(true);
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);

    // Long after: the game goes on, the remaining tab is untouched.
    await jest.advanceTimersByTimeAsync(2 * FORFEIT_MS);
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(blackTab2)).not.toContain("MATCH_OVER");
    expect(pendingForfeitCount()).toBe(0);
  });

  test("closing the player's last tab schedules one forfeit, which fires 60 s later", async () => {
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
    const lastDropAt = Date.now();
    expect(pendingForfeitCount()).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(FORFEIT_MS - SLACK_MS);
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    await jest.advanceTimersByTimeAsync(lastDropAt + FORFEIT_MS + SLACK_MS - Date.now());
    await settle();
    const room = saved();
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(sentTypes(whiteWs).filter((t) => t === "MATCH_OVER")).toHaveLength(1);
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a single tab's close schedules one forfeit", async () => {
    await connect(fakeWs(), WHITE_ID);
    const blackWs = fakeWs();
    await connect(blackWs, BLACK_ID);

    disconnect(blackWs);
    await settle();
    expect(pendingForfeitCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(FORFEIT_MS + SLACK_MS);
    await settle();
    expect(saved().status).toBe("finished");
    expect(pendingForfeitCount()).toBe(0);
  });

  // #74 review: the close handler awaits Redis before it decides. If the
  // player reconnects and registers during that read, scheduling anyway
  // leaves a stale timer T1 (the reconnect's cancel already ran). If the
  // player then drops again just before T1 fires and T1 fires while the
  // second close handler is still in its Redis read, T1 forfeits at once.
  // The decision must see the registered reconnect and schedule nothing, so
  // only the last drop's forfeit runs, 60 s after that drop. The 60 s count
  // from the drop (the close event), not from the end of the close handler's
  // Redis read, which is held here for HELD_READ_MS.
  test("a reconnect that registers during the close handler's read prevents a stale forfeit; the forfeit comes 60 s after the last drop", async () => {
    const whiteWs = fakeWs();
    const blackWs = fakeWs();
    await connect(whiteWs, WHITE_ID);
    await connect(blackWs, BLACK_ID);
    const firstDropAt = Date.now();

    // First drop; hold the close handler at its Redis read.
    const gate1 = deferred();
    nextGetGate = gate1.promise;
    disconnect(blackWs);
    await jest.advanceTimersByTimeAsync(0);
    expect(nextGetGate).toBeNull(); // the close handler's read took the gate

    // Black reconnects (and, unless the close handler holds the room lock,
    // registers) while that read is still pending.
    const blackWs2 = fakeWs();
    const reconnecting = connect(blackWs2, BLACK_ID);
    for (let i = 0; i < 5; i++) await jest.advanceTimersByTimeAsync(0);

    // The first close handler resumes and decides.
    gate1.resolve();
    await reconnecting;
    await settle();
    expect(blackRegistered()).toBe(true);

    // Black drops again just before the first drop + 60 s, and that close
    // handler's Redis read is held across the first drop + 60 s.
    await jest.advanceTimersByTimeAsync(FORFEIT_MS - 100);
    const gate2 = deferred();
    nextGetGate = gate2.promise;
    disconnect(blackWs2);
    const lastDropAt = Date.now();
    await jest.advanceTimersByTimeAsync(200);
    expect(Date.now()).toBeGreaterThan(firstDropAt + FORFEIT_MS);
    await settle();

    // No immediate forfeit from the first drop.
    expect(saved().status).toBe("playing");
    expect(saved().matchResult).toBeUndefined();
    expect(gameRecorded()).toBe(false);
    expect(sentTypes(whiteWs)).not.toContain("MATCH_OVER");

    // Keep the second close handler's read pending for well over SLACK_MS,
    // so a forfeit timed from the end of the read (read end + 60 s) would
    // land clearly later than one timed from the drop (drop + 60 s).
    await jest.advanceTimersByTimeAsync(lastDropAt + HELD_READ_MS - Date.now());
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    // The second close handler resumes and schedules the one forfeit.
    const readEndAt = Date.now();
    expect(readEndAt - lastDropAt).toBeGreaterThanOrEqual(HELD_READ_MS);
    gate2.resolve();
    await settle();
    expect(pendingForfeitCount()).toBe(1);

    // Not forfeited shortly before the last drop + 60 s.
    await jest.advanceTimersByTimeAsync(lastDropAt + FORFEIT_MS - SLACK_MS - Date.now());
    await settle();
    expect(saved().status).toBe("playing");
    expect(gameRecorded()).toBe(false);

    // Forfeited by the last drop + 60 s (within the slack), i.e. well before
    // the end of the held read + 60 s.
    await jest.advanceTimersByTimeAsync(lastDropAt + FORFEIT_MS + SLACK_MS - Date.now());
    expect(Date.now()).toBeLessThan(readEndAt + FORFEIT_MS - SLACK_MS);
    await settle();
    const room = saved();
    expect(room.status).toBe("finished");
    expect(room.matchResult).toMatchObject({ winner: "white", winType: "resign" });
    expect(sentTypes(whiteWs).filter((t) => t === "MATCH_OVER")).toHaveLength(1);
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a reconnect that registers during the close handler's read leaves no pending forfeit", async () => {
    await connect(fakeWs(), WHITE_ID);
    const blackWs = fakeWs();
    await connect(blackWs, BLACK_ID);

    const gate = deferred();
    nextGetGate = gate.promise;
    disconnect(blackWs);
    await jest.advanceTimersByTimeAsync(0);
    const reconnecting = connect(fakeWs(), BLACK_ID);
    for (let i = 0; i < 5; i++) await jest.advanceTimersByTimeAsync(0);
    gate.resolve();
    await reconnecting;
    await settle();

    expect(blackRegistered()).toBe(true);
    expect(pendingForfeitCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
