// ── The close handler takes its forfeit delay from handlers.js (issue #87) ──
// server.js must not keep its own copy of the disconnect forfeit delay: it
// uses DISCONNECT_FORFEIT_MS exported by handlers.js, so the two can never
// drift apart. handlers.js is mocked here with a delay other than the real
// 60 s; the close handler must schedule the forfeit with that value, minus
// the time elapsed since the drop, always passed as the fourth argument.

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

const FORFEIT_MS = 45_000; // deliberately not the real 60 s

const redisGet = jest.fn();
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => ({ get: redisGet, expire: jest.fn(async () => 1), set: jest.fn(async () => "OK") }),
  keys: { room: (id) => `room:${id}` },
  TTL:  { room: 86400 },
}));
jest.unstable_mockModule("../db/postgres.js", () => ({
  query: jest.fn(async () => ({ rows: [{ display_name: "Bob", avatar_url: null }] })),
}));
jest.unstable_mockModule("./handlers.js", () => ({
  DISCONNECT_FORFEIT_MS:     FORFEIT_MS,
  handleMessage:             jest.fn(),
  scheduleDisconnectForfeit: jest.fn(),
  cancelDisconnectForfeit:   jest.fn(),
  triggerAiTurn:             jest.fn(),
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { handleConnection, rooms, userConnections, inFlightConnections } = await import("./server.js");
const { scheduleDisconnectForfeit } = await import("./handlers.js");
const { signAccessToken } = await import("../auth/tokens.js");

const ROOM_ID     = "DELAY123";
const USER_ID     = "11111111-1111-1111-1111-111111111111";
const OPPONENT_ID = "22222222-2222-2222-2222-222222222222";

const playing = () => JSON.stringify({
  players:    { white: OPPONENT_ID, black: USER_ID },
  playerInfo: { white: { display_name: "Eve" }, black: { display_name: "Bob" } },
  ready:      { white: true, black: true },
  status:     "playing",
  gameState:  { turn: "white", phase: "rolling" },
});

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

beforeEach(() => {
  jest.useFakeTimers();
  redisGet.mockReset();
  scheduleDisconnectForfeit.mockClear();
  rooms.clear();
  userConnections.clear();
  inFlightConnections.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Connects USER_ID (black), then drops the socket; the close handler's Redis
// read takes readMs of fake time.
async function connectAndDrop(readMs) {
  redisGet.mockImplementation(async () => playing());
  const ws = fakeWs();
  await handleConnection(ws, { url: `/ws?token=${signAccessToken(USER_ID)}&room=${ROOM_ID}` });
  expect(rooms.get(ROOM_ID)?.size).toBe(1);

  redisGet.mockImplementation(() => (readMs === 0
    ? Promise.resolve(playing())
    : new Promise((resolve) => { setTimeout(() => resolve(playing()), readMs); })));
  ws.readyState = 3;
  ws.emit("close");
  await jest.advanceTimersByTimeAsync(readMs + 1);
}

test.each([[0], [1], [3_000]])(
  "after a %i ms read, the delay is handlers.js's DISCONNECT_FORFEIT_MS minus the time since the drop",
  async (readMs) => {
    await connectAndDrop(readMs);
    expect(scheduleDisconnectForfeit).toHaveBeenCalledTimes(1);
    expect(scheduleDisconnectForfeit).toHaveBeenCalledWith(ROOM_ID, "black", USER_ID, FORFEIT_MS - readMs);
  });
