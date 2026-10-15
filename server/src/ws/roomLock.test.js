// ── Per-room serialization of room state updates (issue #54) ─────────────────
// Room state is read, modified and written back across awaits. These tests
// interleave two writers on one room through a Redis fake whose every command
// yields to the event loop, and check that neither update is lost. Without
// withRoomLock both writers read the same old state and the last write wins.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { setImmediate } from "timers";

const tick = () => new Promise((resolve) => setImmediate(resolve));

const store = new Map();
const fakeRedis = {
  get:    async (k) => { await tick(); return store.get(k) ?? null; },
  set:    async (k, v) => { await tick(); store.set(k, v); return "OK"; },
  expire: async () => { await tick(); return 1; },
};

// The seat lookup on connect is slow, so another writer gets a chance to run
// between the connect's read and its write.
const query = jest.fn(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { rows: [{ display_name: "Bob", avatar_url: null }] };
});

jest.unstable_mockModule("../db/postgres.js", () => ({ query }));
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => fakeRedis,
  keys: { room: (id) => `room:${id}` },
  TTL:  { room: 86400 },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { withRoomLock, pendingRoomLockCount } = await import("./roomLock.js");
const { handleConnection, rooms, userConnections } = await import("./server.js");
const { handleMessage } = await import("./handlers.js");
const { signAccessToken } = await import("../auth/tokens.js");

const ROOM_ID  = "LOCK1234";
const ROOM_KEY = `room:${ROOM_ID}`;
const HOST_ID  = "11111111-1111-1111-1111-111111111111";
const GUEST_ID = "22222222-2222-2222-2222-222222222222";

function lobby(black = null) {
  return {
    roomId:     ROOM_ID,
    createdBy:  HOST_ID,
    players:    { white: HOST_ID, black },
    playerInfo: { white: { display_name: "Host", avatar_url: null }, black: null },
    ready:      { white: false, black: false },
    status:     "waiting",
    gameState:  null,
  };
}

const saved = () => JSON.parse(store.get(ROOM_KEY));

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

beforeEach(() => {
  store.clear();
  rooms.clear();
  userConnections.clear();
  query.mockClear();
});

// ── withRoomLock itself ──────────────────────────────────────────────────────

describe("withRoomLock", () => {
  test("runs sections for one room one at a time, in call order", async () => {
    const log = [];
    const section = (name) => async () => {
      log.push(`${name}:start`);
      await tick(); await tick();
      log.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      withRoomLock("R1", section("a")),
      withRoomLock("R1", section("b")),
      withRoomLock("R1", section("c")),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  test("does not serialize different rooms against each other", async () => {
    const log = [];
    let releaseA;
    const a = withRoomLock("R1", async () => {
      log.push("a:start");
      await new Promise((resolve) => { releaseA = resolve; });
      log.push("a:end");
    });
    const b = withRoomLock("R2", async () => { log.push("b"); });

    await b;
    expect(log).toEqual(["a:start", "b"]);
    releaseA();
    await a;
  });

  test("a failing section rejects its caller but does not block the queue", async () => {
    const failing = withRoomLock("R1", async () => { throw new Error("boom"); });
    const next    = withRoomLock("R1", async () => "ran");

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  test("forgets a room once its queue has drained", async () => {
    await withRoomLock("R1", async () => {});
    // The entry is removed a few microtasks after the section settles; drain
    // with a bounded number of ticks rather than relying on exactly one.
    for (let i = 0; i < 10 && pendingRoomLockCount() > 0; i++) await tick();
    expect(pendingRoomLockCount()).toBe(0);
  });
});

// ── Interleaved writers on one room ──────────────────────────────────────────

describe("concurrent room updates", () => {
  test("two PLAYER_READY messages at once both stick", async () => {
    store.set(ROOM_KEY, JSON.stringify(lobby(GUEST_ID)));

    await Promise.all([
      handleMessage({ msg: { type: "PLAYER_READY" }, userId: HOST_ID,  roomId: ROOM_ID, ws: null }),
      handleMessage({ msg: { type: "PLAYER_READY" }, userId: GUEST_ID, roomId: ROOM_ID, ws: null }),
    ]);

    expect(saved().ready).toEqual({ white: true, black: true });
  });

  test("a host ready toggle during a joining player's seat assignment is kept", async () => {
    store.set(ROOM_KEY, JSON.stringify(lobby()));

    // The joining player's connect reads the room and then awaits the
    // (slow) user lookup; the host toggles ready in the meantime.
    const joining = handleConnection(fakeWs(), {
      url: `/ws?token=${signAccessToken(GUEST_ID)}&room=${ROOM_ID}`,
    });
    await tick();
    const ready = handleMessage({
      msg: { type: "PLAYER_READY" }, userId: HOST_ID, roomId: ROOM_ID, ws: null,
    });

    await Promise.all([joining, ready]);

    expect(saved().players.black).toBe(GUEST_ID);
    expect(saved().playerInfo.black).toEqual({ display_name: "Bob", avatar_url: null });
    expect(saved().ready.white).toBe(true);
  });
});
