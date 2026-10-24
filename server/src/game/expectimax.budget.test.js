// ── Grandmaster's search time budget (#106) ──────────────────────────────────
// computeBestTurnSequence stops after its time budget and returns the best of
// the candidates it finished searching. The clock is checked before every
// opponent roll, not only between candidates, and a candidate cut short is
// never compared with the finished ones (its expected value is incomplete).
//
// Date.now is faked so that it advances 1 ms per call. The search reads it
// once at the start, once before the 2-ply search, and once before each of
// the 21 rolls of each candidate.

import { jest } from "@jest/globals";
import { computeBestTurnSequence, evaluate, SEARCH_TIMEOUT_MS } from "./expectimax.js";
import { legalTurnSequences } from "./engine.js";

// Black to play 2-1 from the bar, with four legal turns. The full search
// prefers a different turn than the 1-ply evaluation. Black is behind here, so
// every candidate's expected value is negative, and the partial sum of the
// second candidate after one roll is higher than the first candidate's full
// expected value: comparing a cut-short candidate would pick it.
function position() {
  return {
    board: [10, -2, 0, -2, 0, 0, 0, 0, 0, 0, -1, 0, -9, 0, 0, 0, 3, 0, 0, 0, 0, 1, 1, 0],
    bar:   { white: 0, black: 1 },
    off:   { white: 0, black: 0 },
    turn:  "black",
    phase: "moving",
    dice:  [2, 1],
    rolledDice: [2, 1],
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
}

// The turn the 1-ply evaluation ranks first (the search's candidate order).
function onePlyBest(gs, color) {
  const seqs = legalTurnSequences(gs, color)
    .map(s => ({ moves: s.moves, score: evaluate(s.finalGs, color) }));
  seqs.sort((a, b) => b.score - a.score);
  return seqs[0].moves;
}

function withFakeClock(fn) {
  let now = 0;
  const spy = jest.spyOn(Date, "now").mockImplementation(() => now++);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

test("the budget is 500 ms", () => {
  expect(SEARCH_TIMEOUT_MS).toBe(500);
});

test("the position tells the full search from the 1-ply choice", () => {
  const gs = position();
  const full = computeBestTurnSequence(gs, "black", Infinity);
  expect(full).not.toEqual(onePlyBest(gs, "black"));
});

test("an exhausted budget returns the 1-ply best", () => {
  const gs = position();
  // Clock: 0 at the start, 1 at the check before the 2-ply search (> 0.8 ms).
  const moves = withFakeClock(() => computeBestTurnSequence(gs, "black", 1));
  expect(moves).toEqual(onePlyBest(gs, "black"));
});

test("the budget is checked between rolls, inside the first candidate", () => {
  const gs = position();
  // The rolls of the first candidate are checked at 2, 3, ...; with a 5 ms
  // budget the search stops at its fifth roll (6 > 5).
  const moves = withFakeClock(() => computeBestTurnSequence(gs, "black", 5));
  expect(moves).toEqual(onePlyBest(gs, "black"));
});

test("a candidate cut short is not compared with the finished ones", () => {
  const gs = position();
  // The first candidate's 21 rolls are checked at 2..22; the second one's
  // first roll at 23 (searched), its second at 24 (> 23: stop). Only the first
  // candidate finished, so it is the answer.
  const moves = withFakeClock(() => computeBestTurnSequence(gs, "black", 23));
  expect(moves).toEqual(onePlyBest(gs, "black"));
});

test("with time to spare the search is not cut short", () => {
  const gs = position();
  const moves = withFakeClock(() => computeBestTurnSequence(gs, "black", 10_000));
  expect(moves).toEqual(computeBestTurnSequence(gs, "black", Infinity));
});
