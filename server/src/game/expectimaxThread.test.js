// ── Grandmaster's search worker (#106) ───────────────────────────────────────
// searchOffThread runs computeBestTurnSequence in a worker thread:
//   1. it answers what the search answers on the main thread;
//   2. the main thread's event loop keeps running while it searches;
//   3. a search that throws in the worker rejects, and the worker goes on;
//   4. if the worker exits, pending searches reject and the next search
//      starts a new worker;
//   5. a worker exiting after a new one started rejects only its own
//      searches, not the new worker's.

import { setInterval, clearInterval } from "node:timers";
import { searchOffThread, stopSearchWorker } from "./expectimaxThread.js";
import { computeBestTurnSequence } from "./expectimax.js";
import { pathToIdx } from "./engine.js";

function gsWith(color, dice, placements) {
  const gs = {
    board: new Array(24).fill(0),
    bar:   { white: 0, black: 0 },
    off:   { white: 0, black: 0 },
    turn:  color,
    phase: "moving",
    dice:  dice.slice(),
    rolledDice: dice.slice(),
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
  for (const [c, pos, n] of placements) gs.board[pathToIdx(c, pos)] = c === "white" ? n : -n;
  return gs;
}

const midGame = () => gsWith("white", [2, 4], [
  ["white", 0, 11], ["white", 6, 1], ["white", 11, 1], ["white", 16, 1], ["white", 21, 1],
  ["black", 0, 15],
]);

afterAll(() => stopSearchWorker());

test("answers what the search answers on the main thread", async () => {
  const gs = midGame();
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

test("the event loop keeps running during a search", async () => {
  // A wide-open doubles position, one of the heaviest searches (see
  // expectimax.test.js).
  const board = [2, 2, -2, -2, 0, -2, -2, 0, 1, 2, 0, 1, 0, -2, -2, 1, 1, 2, 1, -2, 0, 0, 2, -1];
  const gs = { ...gsWith("white", [2, 2, 2, 2], []), board };
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const search = searchOffThread(gs, "white");
    expect(ticks).toBe(0);
    const moves = await search;
    expect(moves.length).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
  }
});

test("a search that throws rejects, and the worker answers the next one", async () => {
  await expect(searchOffThread({ dice: [1, 2] }, "white")).rejects.toThrow();
  const gs = midGame();
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

test("pending searches reject when the worker exits; the next search starts a new one", async () => {
  const gs = midGame();
  const pending = searchOffThread(gs, "white");
  const settled = expect(pending).rejects.toThrow(/exited/);
  await stopSearchWorker();
  await settled;
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

test("an old worker exiting does not reject the new worker's searches", async () => {
  const gs = midGame();
  await searchOffThread(gs, "white"); // the worker is up
  const old = searchOffThread(gs, "white");
  const oldSettled = expect(old).rejects.toThrow(/exited/);
  const stopping = stopSearchWorker(); // not awaited: the old worker exits later
  const fresh = searchOffThread(gs, "white"); // starts a new worker
  await stopping;
  await oldSettled;
  expect(await fresh).toEqual(computeBestTurnSequence(gs, "white"));
});

test("a game state that cannot be cloned rejects, and the worker goes on", async () => {
  const gs = midGame();
  await expect(searchOffThread({ ...gs, extra: () => {} }, "white")).rejects.toThrow();
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});
