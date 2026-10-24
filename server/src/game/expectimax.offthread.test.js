// ── getNextExpectimaxMoveOffThread and the turn plan cache (#106) ───────────
// The worker is replaced by a fake whose searches the test resolves by hand.
//   1. the searched turn is cached: the turn's later moves are answered
//      without another search;
//   2. if the room's cache is cleared while a search runs (the game ended),
//      the move is still answered but no plan is cached for the next game;
//   3. a failed search falls back to the first legal move.

import { jest } from "@jest/globals";

const searches = []; // { gs, color, resolve, reject } per searchOffThread call
jest.unstable_mockModule("./expectimaxThread.js", () => ({
  searchOffThread: (gs, color) =>
    new Promise((resolve, reject) => searches.push({ gs, color, resolve, reject })),
  stopSearchWorker: async () => {},
}));

const { getNextExpectimaxMoveOffThread, clearExpectimaxCache } = await import("./expectimax.js");

const m1 = { from: 1, to: 3, die: 2 };
const m2 = { from: 3, to: 7, die: 4 };
const legal = [{ from: 9, to: 11, die: 2 }];
const gsAt = moveSeq => ({ moveSeq });

beforeEach(() => {
  searches.length = 0;
  clearExpectimaxCache("R");
});

test("caches the searched turn and answers its next move without searching", async () => {
  const first = getNextExpectimaxMoveOffThread(gsAt(0), "black", legal, "R");
  expect(searches).toHaveLength(1);
  searches[0].resolve([m1, m2]);
  expect(await first).toEqual(m1);
  expect(await getNextExpectimaxMoveOffThread(gsAt(1), "black", legal, "R")).toEqual(m2);
  expect(searches).toHaveLength(1);
});

test("a cache cleared during the search keeps the plan out of the next game", async () => {
  const first = getNextExpectimaxMoveOffThread(gsAt(0), "black", legal, "R");
  clearExpectimaxCache("R"); // the game ends while the worker searches
  searches[0].resolve([m1, m2]);
  expect(await first).toEqual(m1);
  // The next game reaches moveSeq 1: it must be searched, not answered by m2.
  const next = getNextExpectimaxMoveOffThread(gsAt(1), "black", legal, "R");
  expect(searches).toHaveLength(2);
  searches[1].resolve([m2]);
  expect(await next).toEqual(m2);
});

test("a failed search falls back to the first legal move", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const move = getNextExpectimaxMoveOffThread(gsAt(0), "black", legal, "R");
    searches[0].reject(new Error("worker died"));
    expect(await move).toEqual(legal[0]);
    expect(error).toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});
