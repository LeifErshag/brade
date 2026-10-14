// Issue #55: a black seat auto-assigned during a WebSocket connect must be
// given back when every connection of that user to the room closes before it
// is registered (no ROOM_STATE was ever sent to it), whatever the order in
// which those connections close or reach their locked section. It must stay
// taken while some connection of that user did register and is still open.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { setImmediate } from "timers";

const redisGet = jest.fn();
const redisSet = jest.fn(async () => "OK");
const redisExpire = jest.fn(async () => 1);
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => ({ get: redisGet, expire: redisExpire, set: redisSet }),
  keys: { room: (id) => `room:${id}` },
  TTL:  { room: 86400 },
}));
jest.unstable_mockModule("../db/postgres.js", () => ({
  query: jest.fn(async () => ({ rows: [{ display_name: "Bob", avatar_url: null }] })),
}));
jest.unstable_mockModule("./handlers.js", () => ({
  handleMessage:             jest.fn(),
  scheduleDisconnectForfeit: jest.fn(),
  cancelDisconnectForfeit:   jest.fn(),
  triggerAiTurn:             jest.fn(),
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { handleConnection, rooms, userConnections, inFlightConnections } =
  await import("./server.js");
const { scheduleDisconnectForfeit } = await import("./handlers.js");
const { signAccessToken, signGuestToken } = await import("../auth/tokens.js");
const { withRoomLock } = await import("./roomLock.js");

const USER_ID = "11111111-1111-1111-1111-111111111111";
const HOST_ID = "33333333-3333-3333-3333-333333333333";

// Every test uses its own room so that state left behind by one test (e.g. a
// pending release kept by the implementation) cannot affect another.
let roomCounter = 0;
let ROOM_ID;
let store;

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

function closeWs(ws) {
  ws.readyState = 3;
  ws.emit("close");
}

function userReq(token = signAccessToken(USER_ID)) {
  return { url: `/ws?token=${token}&room=${ROOM_ID}` };
}

const lobby = () => ({
  createdBy:  HOST_ID,
  players:    { white: HOST_ID, black: null },
  playerInfo: { white: { display_name: "Host", avatar_url: null }, black: null },
  ready:      { white: true, black: false },
  status:     "waiting",
  gameState:  null,
});
const saved = () => JSON.parse(store.get(`room:${ROOM_ID}`));

// Redis reads and TTL refreshes resolve only after a setImmediate tick, so
// concurrent connects genuinely interleave around their awaits.
const tick = () => new Promise((resolve) => setImmediate(resolve));

// The host is registered in the room, so it receives every ROOM_STATE.
let hostWs;
function lastHostState() {
  const msgs = hostWs.send.mock.calls.map(([raw]) => JSON.parse(raw))
    .filter((m) => m.type === "ROOM_STATE");
  return msgs.at(-1);
}

beforeEach(() => {
  roomCounter += 1;
  ROOM_ID = `SEAT${String(roomCounter).padStart(4, "0")}`;
  store = new Map([[`room:${ROOM_ID}`, JSON.stringify(lobby())]]);

  redisGet.mockReset();
  redisSet.mockReset();
  redisExpire.mockReset();
  redisGet.mockImplementation(async (key) => { await tick(); return store.get(key) ?? null; });
  redisExpire.mockImplementation(async () => { await tick(); return 1; });
  redisSet.mockImplementation(async (key, value) => { store.set(key, value); return "OK"; });
  scheduleDisconnectForfeit.mockClear();

  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  hostWs = fakeWs();
  rooms.set(ROOM_ID, new Set([{ ws: hostWs, userId: HOST_ID }]));

  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// Runs `onWrite` while the first (seat-assigning) Redis write is in flight.
function duringSeatWrite(onWrite) {
  redisSet.mockImplementationOnce(async (key, written) => {
    store.set(key, written);
    onWrite();
    return "OK";
  });
}

function expectSeatReleased() {
  const room = saved();
  expect(room.players.black).toBeNull();
  expect(room.playerInfo.black).toBeNull();
  expect(room.ready.black).toBe(false);
  expect(room.players.white).toBe(HOST_ID);
  expect(room.status).toBe("waiting");
}

function expectNoUserRegistration() {
  const userClients = [...(rooms.get(ROOM_ID) ?? [])].filter((c) => c.userId === USER_ID);
  expect(userClients).toHaveLength(0);
  expect(userConnections.has(USER_ID)).toBe(false);
}

describe("every connection of the user drops before registering", () => {
  test("queued reconnect whose socket closed before its locked section ran: seat released", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      // Immediate reconnect, queued behind conn1's lock; it drops at once too.
      conn2 = handleConnection(ws2, userReq());
      closeWs(ws2);
    });

    await handleConnection(ws1, userReq());
    await conn2;

    expect(ws1.send).not.toHaveBeenCalled();
    expect(ws2.send).not.toHaveBeenCalled();
    expectNoUserRegistration();
    expectSeatReleased();
    expect(lastHostState()).toMatchObject({
      type: "ROOM_STATE",
      room: { players: { white: HOST_ID, black: null } },
    });
    expect(scheduleDisconnectForfeit).not.toHaveBeenCalled();
    expect(inFlightConnections.size).toBe(0);
  });

  test("queued reconnect whose socket closes while its own section is running: seat released", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq());
    });

    await handleConnection(ws1, userReq());
    // conn1 has finished; conn2's section is now awaiting Redis. Drop it.
    closeWs(ws2);
    await conn2;

    expect(ws2.send).not.toHaveBeenCalled();
    expectNoUserRegistration();
    expectSeatReleased();
    expect(lastHostState().room.players.black).toBeNull();
    expect(inFlightConnections.size).toBe(0);
  });

  test("two concurrent connects, the later one closing first: seat released", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    duringSeatWrite(() => {
      closeWs(ws2);
      closeWs(ws1);
    });

    // Both are in flight before either reaches its locked section.
    const conn1 = handleConnection(ws1, userReq());
    const conn2 = handleConnection(ws2, userReq());
    await Promise.all([conn1, conn2]);

    expectNoUserRegistration();
    expectSeatReleased();
    expect(lastHostState().room.players.black).toBeNull();
    expect(inFlightConnections.size).toBe(0);
  });

  test("three connects that all drop before registering: seat released", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    const ws3 = fakeWs();
    let conn2, conn3;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq());
      conn3 = handleConnection(ws3, userReq());
      closeWs(ws2);
    });

    await handleConnection(ws1, userReq());
    closeWs(ws3);
    await Promise.all([conn2, conn3]);

    expectNoUserRegistration();
    expectSeatReleased();
    expect(inFlightConnections.size).toBe(0);
  });

  test("a guest's hasGuest flag is undone with the seat after a double drop", async () => {
    const token = signGuestToken(USER_ID, "Gus");
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq(token));
      closeWs(ws2);
    });

    await handleConnection(ws1, userReq(token));
    await conn2;

    expectNoUserRegistration();
    expectSeatReleased();
    expect(saved().hasGuest).toBeUndefined();
  });

  test("after a released double drop, a new connect takes and keeps the seat", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq());
      closeWs(ws2);
    });
    await handleConnection(ws1, userReq());
    await conn2;
    expectNoUserRegistration();
    expect(saved().players.black).toBeNull();

    const ws3 = fakeWs();
    await handleConnection(ws3, userReq());

    expect(saved().players.black).toBe(USER_ID);
    expect(saved().playerInfo.black).toEqual({ display_name: "Bob", avatar_url: null });
    expect(userConnections.get(USER_ID)?.has(ws3)).toBe(true);
    const sent = JSON.parse(ws3.send.mock.calls.at(-1)[0]);
    expect(sent.room.players.black).toBe(USER_ID);
    expect(inFlightConnections.size).toBe(0);
  });
});

describe("a registered, still-open connection of the user keeps the seat", () => {
  test("conn1 drops, conn2 registers and stays open: seat kept", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq());
    });

    await handleConnection(ws1, userReq());
    await conn2;

    expect(saved().players.black).toBe(USER_ID);
    expect(userConnections.get(USER_ID)?.has(ws2)).toBe(true);
    expect(JSON.parse(ws2.send.mock.calls.at(-1)[0]).room.players.black).toBe(USER_ID);
    expect(lastHostState().room.players.black).toBe(USER_ID);
    expect(inFlightConnections.size).toBe(0);
  });

  test("conn1 drops, conn2 registers and stays open, conn3 drops before registering: seat kept", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    const ws3 = fakeWs();
    let conn2, conn3;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq());
      conn3 = handleConnection(ws3, userReq());
    });

    await handleConnection(ws1, userReq());
    await conn2;
    closeWs(ws3);
    await conn3;

    expect(saved().players.black).toBe(USER_ID);
    expect(saved().playerInfo.black).toEqual({ display_name: "Bob", avatar_url: null });
    expect(userConnections.get(USER_ID)?.has(ws2)).toBe(true);
    expect(userConnections.get(USER_ID)?.has(ws3)).toBe(false);
    expect(lastHostState().room.players.black).toBe(USER_ID);
    expect(inFlightConnections.size).toBe(0);
  });

  test("a connection registered before the drops keeps the seat through two dropped connects", async () => {
    const ws0 = fakeWs();
    await handleConnection(ws0, userReq()); // takes the seat and registers
    expect(saved().players.black).toBe(USER_ID);

    const ws1 = fakeWs();
    const ws2 = fakeWs();
    const conn1 = handleConnection(ws1, userReq());
    const conn2 = handleConnection(ws2, userReq());
    closeWs(ws1);
    closeWs(ws2);
    await Promise.all([conn1, conn2]);

    expect(saved().players.black).toBe(USER_ID);
    expect(userConnections.get(USER_ID)?.has(ws0)).toBe(true);
    expect(inFlightConnections.size).toBe(0);
  });

  test("a deferred release is not carried out later when the registered connection closes", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      conn2 = handleConnection(ws2, userReq());
    });
    await handleConnection(ws1, userReq());
    await conn2;
    expect(saved().players.black).toBe(USER_ID);

    // A normal lobby disconnect of an announced seat keeps the seat.
    closeWs(ws2);
    for (let i = 0; i < 5; i++) await tick();

    expect(saved().players.black).toBe(USER_ID);
    expect(userConnections.has(USER_ID)).toBe(false);
  });
});

describe("the last in-flight connect fails instead of dropping", () => {
  // Waits until every queued section for the room has run (including any
  // release an implementation does after a connect has settled), failing
  // instead of hanging if the room's lock never frees up.
  async function drainRoom() {
    for (let i = 0; i < 5; i++) await tick();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("room lock never drained (deadlock?)")), 2000);
    });
    try {
      await Promise.race([withRoomLock(ROOM_ID, () => {}), timeout]);
    } finally {
      clearTimeout(timer);
    }
    for (let i = 0; i < 5; i++) await tick();
  }

  test("conn1 assigns and drops, queued conn2 throws: seat released once both settle", async () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    duringSeatWrite(() => {
      closeWs(ws1);
      // A section queued between conn1 and conn2 arms the failure, so the
      // first Redis read of conn2's own locked section rejects, whatever
      // reads conn1 still does before its section ends.
      withRoomLock(ROOM_ID, () => {
        redisGet.mockImplementationOnce(async () => { await tick(); throw new Error("redis blip"); });
      });
      conn2 = handleConnection(ws2, userReq());
    });

    await handleConnection(ws1, userReq());
    await expect(conn2).rejects.toThrow("redis blip");
    await drainRoom();

    expect(ws1.send).not.toHaveBeenCalled();
    expect(ws2.send).not.toHaveBeenCalled();
    expectNoUserRegistration();
    expectSeatReleased();
    expect(lastHostState().room.players.black).toBeNull();
    expect(scheduleDisconnectForfeit).not.toHaveBeenCalled();
    expect(inFlightConnections.size).toBe(0);

    // The room is still usable afterwards: a new connect takes the seat.
    const ws3 = fakeWs();
    await handleConnection(ws3, userReq());
    expect(saved().players.black).toBe(USER_ID);
    expect(userConnections.get(USER_ID)?.has(ws3)).toBe(true);
  });
});

describe("a registered connection that is closing does not keep the seat", () => {
  test("seat released when the user's only registered connection is CLOSING (readyState 2, no close event yet)", async () => {
    const OTHER_ID = "44444444-4444-4444-4444-444444444444";
    // The user first joins as a spectator while black is held by someone else.
    const taken = lobby();
    taken.players.black = OTHER_ID;
    taken.playerInfo.black = { display_name: "Other", avatar_url: null };
    store.set(`room:${ROOM_ID}`, JSON.stringify(taken));
    const ws0 = fakeWs();
    await handleConnection(ws0, userReq());
    expect([...rooms.get(ROOM_ID)].some((c) => c.ws === ws0)).toBe(true);

    // The other player leaves the seat; the spectator socket starts closing
    // but its "close" event has not fired yet.
    store.set(`room:${ROOM_ID}`, JSON.stringify(lobby()));
    ws0.readyState = 2;

    // A new connect of the user takes the free seat and drops before registering.
    const ws1 = fakeWs();
    duringSeatWrite(() => closeWs(ws1));
    await handleConnection(ws1, userReq());
    for (let i = 0; i < 5; i++) await tick();

    expect(ws1.send).not.toHaveBeenCalled();
    expectSeatReleased();
    expect(lastHostState().room.players.black).toBeNull();
    expect(inFlightConnections.size).toBe(0);
  });
});
