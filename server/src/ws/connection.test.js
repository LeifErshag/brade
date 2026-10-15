// An error inside the async WebSocket connection handler (e.g. Redis or
// Postgres unavailable) must be logged and close the socket, never escape as
// an unhandled rejection.

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
  DISCONNECT_FORFEIT_MS:     60_000,
  handleMessage:             jest.fn(),
  scheduleDisconnectForfeit: jest.fn(),
  cancelDisconnectForfeit:   jest.fn(),
  triggerAiTurn:             jest.fn(),
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { initWebSocketServer, handleConnection, rooms, userConnections, inFlightConnections } =
  await import("./server.js");
const { cancelDisconnectForfeit, scheduleDisconnectForfeit } = await import("./handlers.js");
const { signAccessToken, signGuestToken } = await import("../auth/tokens.js");
const { WebSocketServer } = await import("ws");

const USER_ID = "11111111-1111-1111-1111-111111111111";

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

function fakeReq(token = signAccessToken(USER_ID)) {
  return { url: `/ws?token=${token}&room=ABCD1234` };
}

let errorSpy;
beforeEach(() => {
  redisGet.mockReset();
  redisSet.mockReset();
  redisSet.mockResolvedValue("OK");
  redisExpire.mockReset();
  redisExpire.mockResolvedValue(1);
  cancelDisconnectForfeit.mockClear();
  scheduleDisconnectForfeit.mockClear();
  // Shared module state: every test starts with no registered connections.
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("handleConnection rejects when Redis fails", async () => {
  redisGet.mockRejectedValue(new Error("redis down"));
  await expect(handleConnection(fakeWs(), fakeReq())).rejects.toThrow("redis down");
});

test("the connection listener logs the error and closes the socket with 1011", async () => {
  redisGet.mockRejectedValue(new Error("redis down"));

  // Capture the "connection" listener without opening a real port.
  let onConnection;
  const onSpy = jest.spyOn(WebSocketServer.prototype, "on").mockImplementation(function (event, fn) {
    if (event === "connection") onConnection = fn;
    return this;
  });
  const fakeHttpServer = new EventEmitter();
  initWebSocketServer(fakeHttpServer);
  onSpy.mockRestore();

  const ws = fakeWs();
  const ret = onConnection(ws, fakeReq());
  expect(ret).toBeUndefined(); // listener itself returns no promise to reject

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ws.close).toHaveBeenCalledWith(1011, "Server error");
  expect(errorSpy).toHaveBeenCalledWith("WS connection error:", expect.objectContaining({ message: "redis down" }));
});

test("a missing room still closes with 4003 and is not treated as an error", async () => {
  redisGet.mockResolvedValue(null);
  const ws = fakeWs();
  await handleConnection(ws, fakeReq());
  expect(ws.close).toHaveBeenCalledWith(4003, "Room not found");
  expect(errorSpy).not.toHaveBeenCalled();
});

describe("client disconnects while handleConnection is awaiting", () => {
  const room = {
    players: { white: USER_ID, black: "22222222-2222-2222-2222-222222222222" },
    status: "playing",
    gameState: { turn: "white", phase: "rolling" },
  };

  test("no room or user entry is registered and no listeners are attached", async () => {
    const ws = fakeWs();
    redisGet.mockImplementation(async () => {
      // The socket closes (and emits "close") mid-await.
      ws.readyState = 3;
      ws.emit("close");
      return JSON.stringify(room);
    });

    await handleConnection(ws, fakeReq());

    expect(rooms.has("ABCD1234")).toBe(false);
    expect(userConnections.has(USER_ID)).toBe(false);
    expect(ws.listenerCount("close")).toBe(0);
    expect(ws.listenerCount("message")).toBe(0);
    expect(ws.send).not.toHaveBeenCalled();
    expect(cancelDisconnectForfeit).not.toHaveBeenCalled();
  });

  test("an open socket is still registered and cleaned up on close", async () => {
    const ws = fakeWs();
    redisGet.mockResolvedValue(JSON.stringify(room));

    await handleConnection(ws, fakeReq());
    expect(rooms.get("ABCD1234")?.size).toBe(1);
    expect(userConnections.get(USER_ID)?.has(ws)).toBe(true);

    ws.readyState = 3;
    ws.emit("close");
    expect(rooms.has("ABCD1234")).toBe(false);
    expect(userConnections.has(USER_ID)).toBe(false);
  });
});

describe("auto-assigned black seat when the client disconnects mid-connect", () => {
  const HOST_ID  = "33333333-3333-3333-3333-333333333333";
  const ROOM_KEY = "room:ABCD1234";
  let store;

  const lobby = () => ({
    createdBy:  HOST_ID,
    players:    { white: HOST_ID, black: null },
    playerInfo: { white: { display_name: "Host", avatar_url: null }, black: null },
    ready:      { white: true, black: false },
    status:     "waiting",
    gameState:  null,
  });
  const saved = () => JSON.parse(store.get(ROOM_KEY));

  beforeEach(() => {
    store = new Map([[ROOM_KEY, JSON.stringify(lobby())]]);
    redisGet.mockImplementation(async (key) => store.get(key) ?? null);
    redisSet.mockImplementation(async (key, value) => { store.set(key, value); return "OK"; });
  });

  // The client closes while the seat-assigning write is in flight.
  function closeDuringSeatWrite(ws, value = undefined) {
    redisSet.mockImplementationOnce(async (key, written) => {
      store.set(key, value ?? written);
      ws.readyState = 3;
      ws.emit("close");
      return "OK";
    });
  }

  test("the seat is released and connected clients get the fresh room", async () => {
    const hostWs = fakeWs();
    rooms.set("ABCD1234", new Set([{ ws: hostWs, userId: HOST_ID }]));
    const ws = fakeWs();
    closeDuringSeatWrite(ws);

    await handleConnection(ws, fakeReq());

    expect(saved().players.black).toBeNull();
    expect(saved().playerInfo.black).toBeNull();
    expect(saved().ready.black).toBe(false);
    expect(saved().hasGuest).toBeUndefined();
    expect(rooms.get("ABCD1234").size).toBe(1);
    expect(userConnections.has(USER_ID)).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.listenerCount("close")).toBe(0);
    expect(scheduleDisconnectForfeit).not.toHaveBeenCalled();

    const last = JSON.parse(hostWs.send.mock.calls.at(-1)[0]);
    expect(last).toMatchObject({
      type: "ROOM_STATE",
      room: { players: { white: HOST_ID, black: null } },
    });
  });

  test("a guest's hasGuest flag is undone together with the seat", async () => {
    const ws = fakeWs();
    closeDuringSeatWrite(ws);

    await handleConnection(ws, fakeReq(signGuestToken(USER_ID, "Gus")));

    expect(saved().players.black).toBeNull();
    expect(saved().hasGuest).toBeUndefined();
  });

  test("the seat is kept when the same user has another live connection", async () => {
    rooms.set("ABCD1234", new Set([{ ws: fakeWs(), userId: USER_ID }]));
    const ws = fakeWs();
    closeDuringSeatWrite(ws);

    await handleConnection(ws, fakeReq());

    expect(saved().players.black).toBe(USER_ID);
    expect(redisSet).toHaveBeenCalledTimes(1); // only the assignment
  });

  test("the seat is kept for a same-user reconnect that is still in flight", async () => {
    // Each Redis read/TTL call resolves after a setImmediate tick, so the
    // second connect is still awaiting when the first one tries to release.
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    redisGet.mockImplementation(async (key) => { await tick(); return store.get(key) ?? null; });
    redisExpire.mockImplementation(async () => { await tick(); return 1; });

    const ws1 = fakeWs();
    const ws2 = fakeWs();
    let conn2;
    redisSet.mockImplementationOnce(async (key, written) => {
      store.set(key, written);
      // conn1 closes as its seat write lands; the client reconnects at once
      // (e.g. a StrictMode effect re-run) and reads the room with black=USER_ID.
      ws1.readyState = 3;
      ws1.emit("close");
      conn2 = handleConnection(ws2, fakeReq());
      return "OK";
    });

    await handleConnection(ws1, fakeReq());
    await conn2;

    expect(saved().players.black).toBe(USER_ID);
    expect(redisSet).toHaveBeenCalledTimes(1); // no release write
    expect(rooms.get("ABCD1234")?.size).toBe(1);
    expect(userConnections.get(USER_ID)?.has(ws2)).toBe(true);
    const sent = JSON.parse(ws2.send.mock.calls.at(-1)[0]);
    expect(sent.room.players.black).toBe(USER_ID);
    expect(inFlightConnections.size).toBe(0);
  });

  test("the in-flight count is cleared even when the connect fails", async () => {
    redisGet.mockRejectedValue(new Error("redis down"));
    await expect(handleConnection(fakeWs(), fakeReq())).rejects.toThrow("redis down");
    expect(inFlightConnections.size).toBe(0);
  });

  test("the seat is kept when it changed hands in the meantime", async () => {
    const OTHER_ID = "44444444-4444-4444-4444-444444444444";
    const raced = lobby();
    raced.players.black = OTHER_ID;
    const ws = fakeWs();
    closeDuringSeatWrite(ws, JSON.stringify(raced));

    await handleConnection(ws, fakeReq());

    expect(saved().players.black).toBe(OTHER_ID);
    expect(redisSet).toHaveBeenCalledTimes(1);
  });

  test("an open client keeps the seat it was assigned", async () => {
    const ws = fakeWs();

    await handleConnection(ws, fakeReq());

    expect(saved().players.black).toBe(USER_ID);
    expect(saved().playerInfo.black).toEqual({ display_name: "Bob", avatar_url: null });
    expect(rooms.get("ABCD1234").size).toBe(1);
  });
});
