// ── Grandmaster must not depend on the opponent's enumeration order (#62) ────
// The opponent's best reply is the minimum of our evaluation over ALL of the
// opponent's legal turn sequences, so the move Grandmaster picks must be the
// same whatever order the engine happens to list those sequences in. Here the
// engine's legalTurnSequences is wrapped so that, for the opponent's colour
// only, it returns the same sequences in reverse order. On a search that only
// scores a prefix of the list, reversing the order changes the reply it finds
// and therefore the move it picks.
//
// The search runs without a time budget: under CPU load a 500 ms budget cuts
// the two searches short at different points, which makes them pick
// different moves for reasons unrelated to the order (#129).

import { jest } from "@jest/globals";

const actualEngine = await import("./engine.js");
const control = { reverseFor: null };

jest.unstable_mockModule("./engine.js", () => ({
  ...actualEngine,
  legalTurnSequences: (gs, color) => {
    const seqs = actualEngine.legalTurnSequences(gs, color);
    return color === control.reverseFor ? seqs.slice().reverse() : seqs;
  },
}));

const { computeBestTurnSequence } = await import("./expectimax.js");

const other = c => (c === "white" ? "black" : "white");

function makeGs(board, dice, turn) {
  return {
    board: board.slice(),
    bar: { white: 0, black: 0 },
    off: { white: 0, black: 0 },
    turn,
    phase: "moving",
    dice: dice.slice(),
    rolledDice: dice.slice(),
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
}

// Mid-game positions (no checker on the bar, nobody can bear off) in which
// scoring only the first 50 opponent sequences picks a different first move
// depending on the order of the opponent's sequences.
const FIXTURES = [
  { color: "white", dice: [1, 1, 1, 1],
    board: [2, 2, 2, 1, -2, -2, -2, -2, 0, 0, -1, 0, 0, -2, -2, 2, 2, 0, 0, -2, 2, 0, 0, 2] },
  { color: "white", dice: [3, 3, 3, 3],
    board: [2, 1, 0, 2, -2, 0, 0, -2, -2, 2, 2, 2, -2, -2, -1, -2, 0, 2, 0, -2, 0, 0, 0, 2] },
  { color: "black", dice: [1, 1, 1, 1],
    board: [2, 2, -2, -2, -1, -2, 2, 0, 0, -2, 0, 2, 0, 2, -2, 2, 1, 2, 0, 0, -2, 0, -2, 0] },
  { color: "black", dice: [1, 1, 1, 1],
    board: [0, -2, 2, 2, -2, 0, -2, 0, 2, 2, 0, 0, -2, -2, -1, 2, 0, 0, 0, -2, 1, 2, 2, -2] },
];

function bestTurn(board, dice, color, reverseFor) {
  control.reverseFor = reverseFor;
  try {
    const gs = makeGs(board, dice, color);
    const moves = computeBestTurnSequence(gs, color, Infinity);
    expect(actualEngine.legalTurnSequences(gs, color).map(s => s.moves)).toContainEqual(moves);
    return moves;
  } finally {
    control.reverseFor = null;
  }
}

describe.each(FIXTURES)("$color rolls $dice", ({ color, dice, board }) => {
  test("precondition: none of our own sequences ends the game", () => {
    const gs = makeGs(board, dice, color);
    expect(actualEngine.legalTurnSequences(gs, color).some(s => s.ends)).toBe(false);
  });

  test("the chosen turn does not depend on the order of the opponent's sequences", () => {
    const natural  = bestTurn(board, dice, color, null);
    const reversed = bestTurn(board, dice, color, other(color));
    expect(reversed).toEqual(natural);
  });
});
