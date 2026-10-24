// ── Lifecycle info logs (issue #144) ─────────────────────────────────────────
// A player's game can be followed in Render's logs by searching for their
// userId or roomId: server start, connect, disconnect, game start, resign,
// disconnect forfeit and game over each log one info line.
//
// Real server.js, handlers.js and roomLock.js; Redis and Postgres are fakes.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { WebSocketServer } from "ws";

const store = new Map();
const fakeRedis = {
  get:    async (k) => store.get(k) ?? null,
  set:    async (k, v) => { store.set(k, v); return "OK"; },
  expire: async () => 1,
  ttl:    async () => 100,
  del:    async () => 1,
};

const query = jest.fn(async (sql) =>
  /SELECT id FROM games/i.test(sql) ? { rows: [{ id: "game-uuid" }] } : { rows: [] });

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

const { handleConnection, initWebSocketServer, rooms, userConnections, inFlightConnections } = await import("./server.js");
const { withRoomLock } = await import("./roomLock.js");
const { scheduleDisconnectForfeit } = await import("./handlers.js");
const { initGame } = await import("../game/engine.js");
const { signAccessToken } = await import("../auth/tokens.js");

const ROOM_ID    = "LOGS1234";
const WHITE_ID   = "11111111-1111-1111-1111-111111111111";
const BLACK_ID   = "22222222-2222-2222-2222-222222222222";
const OUTSIDER   = "33333333-3333-3333-3333-333333333333";
const FORFEIT_MS = 60_000;

function room(status) {
  const gs = initGame();
  gs.turn  = "white";
  gs.phase = "rolling";
  return {
    roomId:      ROOM_ID,
    matchLength: 1,
    createdBy:   WHITE_ID,
    gameDbId:    "game-uuid",
    players:     { white: WHITE_ID, black: BLACK_ID },
    playerInfo:  { white: { display_name: "White" }, black: { display_name: "Black" } },
    ready:       { white: true, black: true },
    status,
    score:       { white: 0, black: 0 },
    gameNum:     1,
    gameState:   status === "playing" ? gs : null,
  };
}

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
  ws.emit("close", 1006);
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await jest.advanceTimersByTimeAsync(0);
    await withRoomLock(ROOM_ID, async () => {});
  }
}

// The info lines written so far (LOG_FORMAT=json makes each one a JSON line).
const infos = () => console.log.mock.calls.map(([line]) => JSON.parse(line));
const info = (msg) => infos().filter(e => e.msg === msg);

beforeEach(() => {
  jest.useFakeTimers();
  process.env.LOG_FORMAT = "json";
  store.clear();
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  query.mockClear();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete process.env.LOG_FORMAT;
});

test("server start is logged", () => {
  const onSpy = jest.spyOn(WebSocketServer.prototype, "on").mockImplementation(function () { return this; });
  initWebSocketServer(new EventEmitter());
  onSpy.mockRestore();
  expect(info("WebSocket server initialised")).toHaveLength(1);
});

test("connect, game start and disconnect are logged with the room and user", async () => {
  store.set(`room:${ROOM_ID}`, JSON.stringify(room("waiting")));
  const whiteWs = fakeWs();
  await connect(whiteWs, WHITE_ID);
  await connect(fakeWs(), BLACK_ID);

  expect(info("WS connected")).toEqual([
    expect.objectContaining({ level: "info", roomId: ROOM_ID, userId: WHITE_ID, status: "waiting" }),
    expect.objectContaining({ level: "info", roomId: ROOM_ID, userId: BLACK_ID, status: "waiting" }),
  ]);

  whiteWs.emit("message", JSON.stringify({ type: "START_GAME" }));
  await settle();
  expect(info("Game started")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, white: WHITE_ID, black: BLACK_ID, guest: false }),
  ]);

  disconnect(whiteWs);
  await settle();
  expect(info("WS disconnected")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, userId: WHITE_ID, code: 1006 }),
  ]);
});

test("a resign logs the resign and the game over", async () => {
  store.set(`room:${ROOM_ID}`, JSON.stringify(room("playing")));
  const blackWs = fakeWs();
  await connect(fakeWs(), WHITE_ID);
  await connect(blackWs, BLACK_ID);

  blackWs.emit("message", JSON.stringify({ type: "RESIGN" }));
  await settle();

  expect(info("Player resigned")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, userId: BLACK_ID, color: "black" }),
  ]);
  expect(info("Game over")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, winner: "white", winType: "resign", forced: true }),
  ]);
  expect(info("Player forfeited after disconnect")).toHaveLength(0);
});

test("a disconnect forfeit logs the schedule, the forfeit and the game over", async () => {
  store.set(`room:${ROOM_ID}`, JSON.stringify(room("playing")));
  const blackWs = fakeWs();
  await connect(fakeWs(), WHITE_ID);
  await connect(blackWs, BLACK_ID);
  disconnect(blackWs);
  await settle();

  expect(info("Disconnect forfeit scheduled")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, userId: BLACK_ID, color: "black" }),
  ]);
  expect(info("Player forfeited after disconnect")).toHaveLength(0);

  await jest.advanceTimersByTimeAsync(FORFEIT_MS);
  await settle();

  expect(info("Player forfeited after disconnect")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, userId: BLACK_ID, color: "black" }),
  ]);
  expect(info("Game over")).toEqual([
    expect.objectContaining({ roomId: ROOM_ID, winner: "white", winType: "resign" }),
  ]);
  expect(info("Player resigned")).toHaveLength(0);
});

test("a forfeit that resigns nothing (no seat in the room) is not logged", async () => {
  store.set(`room:${ROOM_ID}`, JSON.stringify(room("playing")));
  scheduleDisconnectForfeit(ROOM_ID, "black", OUTSIDER);

  await jest.advanceTimersByTimeAsync(FORFEIT_MS);
  await settle();

  expect(JSON.parse(store.get(`room:${ROOM_ID}`)).status).toBe("playing");
  expect(info("Player forfeited after disconnect")).toHaveLength(0);
  expect(info("Game over")).toHaveLength(0);
});
