// The 60 s disconnect forfeit must not resign a player who has reconnected,
// even when the timer already fired and its resign queued behind the
// reconnect on the room's lock (issue #59).

import { jest } from "@jest/globals";
import { EventEmitter } from "events";

let store = new Map();
const redis = {
  get:    jest.fn(async (k) => store.get(k) ?? null),
  set:    jest.fn(async (k, v) => { store.set(k, v); return "OK"; }),
  expire: jest.fn(async () => 1),
  ttl:    jest.fn(async () => 86400),
  del:    jest.fn(async (k) => { store.delete(k); return 1; }),
};
jest.unstable_mockModule("../db/redis.js", () => ({
  getRedis: () => redis,
  connectRedis: jest.fn(),
  keys: { room: (id) => `room:${id}` },
  TTL:  { room: 86400 },
}));
const query = jest.fn(async () => ({ rows: [] }));
jest.unstable_mockModule("../db/postgres.js", () => ({ query, connectPostgres: jest.fn() }));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { handleConnection, rooms, userConnections, inFlightConnections } = await import("./server.js");
const { withRoomLock } = await import("./roomLock.js");
const { signAccessToken } = await import("../auth/tokens.js");

const ROOM  = "ABCD1234";
const OTHER = "WXYZ9876";
const WHITE = "11111111-1111-1111-1111-111111111111";
const BLACK = "22222222-2222-2222-2222-222222222222";

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}
const connect = (ws, userId, room = ROOM) =>
  handleConnection(ws, { url: `/ws?token=${signAccessToken(userId)}&room=${room}` });
const disconnect = async (ws) => { ws.readyState = 3; ws.emit("close"); await jest.advanceTimersByTimeAsync(0); };

function playingRoom() {
  return {
    players: { white: WHITE, black: BLACK },
    playerInfo: { white: null, black: null },
    status: "playing",
    score: { white: 0, black: 0 },
    gameNum: 1, matchLength: 3,
    hasGuest: true, guestColor: "black",
    gameState: { turn: "white", phase: "rolling" },
  };
}
const roomState = () => JSON.parse(store.get(`room:${ROOM}`));
const sentTypes = (ws) => ws.send.mock.calls.map(([p]) => JSON.parse(p).type);
const updates   = () => query.mock.calls.filter(([sql]) => /UPDATE games/.test(sql));

beforeEach(() => {
  jest.useFakeTimers();
  store = new Map([[`room:${ROOM}`, JSON.stringify(playingRoom())],
                   [`room:${OTHER}`, JSON.stringify(playingRoom())]]);
  query.mockClear();
  rooms.clear(); userConnections.clear(); inFlightConnections.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("a player still gone after 60 s forfeits the match", async () => {
  const w = fakeWs(), b = fakeWs();
  await connect(w, WHITE); await connect(b, BLACK);
  await disconnect(w);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(roomState().status).toBe("finished");
  expect(roomState().matchResult).toMatchObject({ winner: "black", winType: "resign" });
  expect(updates()).toHaveLength(1);
  expect(sentTypes(b)).toContain("MATCH_OVER");
});

test("a reconnect queued ahead of a fired forfeit wins; a later disconnect forfeits", async () => {
  const w = fakeWs(), b = fakeWs();
  await connect(w, WHITE); await connect(b, BLACK);
  await disconnect(w);

  // Hold the room's lock so the reconnect and then the fired forfeit queue.
  let release;
  const held = withRoomLock(ROOM, () => new Promise((r) => { release = r; }));
  const w2 = fakeWs();
  const reconnecting = connect(w2, WHITE);
  await jest.advanceTimersByTimeAsync(60_000); // timer fires, resign queues
  release(); await held; await reconnecting;
  await jest.advanceTimersByTimeAsync(0);

  expect(roomState().status).toBe("playing");
  expect(roomState().score).toEqual({ white: 0, black: 0 });
  expect(updates()).toHaveLength(0);
  expect(sentTypes(b)).not.toContain("MATCH_OVER");

  await disconnect(w2);
  await jest.advanceTimersByTimeAsync(59_000);
  expect(roomState().status).toBe("playing");
  await jest.advanceTimersByTimeAsync(1_000);
  expect(roomState().status).toBe("finished");
  expect(sentTypes(b)).toContain("MATCH_OVER");
});

test("being connected to another room does not prevent the forfeit", async () => {
  const w = fakeWs(), b = fakeWs();
  await connect(w, WHITE); await connect(b, BLACK);
  await disconnect(w);
  await connect(fakeWs(), WHITE, OTHER);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(roomState().status).toBe("finished");
});
