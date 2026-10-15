// ── Grandmaster opponent-reply tests (#62) ───────────────────────────────────
// The 2-ply search must take the opponent's best reply over EVERY legal
// sequence, not a prefix in the engine's enumeration order.
// The "is exported" and timing checks live in expectimax.test.js.

import { jest } from "@jest/globals";

const realEngine = await import("./engine.js");

// Wrap legalTurnSequences so a test can reverse the order of the sequences
// returned for one colour (the opponent's).
let reverseFor = null;
jest.unstable_mockModule("./engine.js", () => ({
  ...realEngine,
  legalTurnSequences: (gs, color) => {
    const seqs = realEngine.legalTurnSequences(gs, color);
    return color === reverseFor ? seqs.slice().reverse() : seqs;
  },
}));

const { evaluate, opponentReplyValue, getNextExpectimaxMove, clearExpectimaxCache } =
  await import("./expectimax.js");
const { legalTurnSequences, getLegalMoves } = realEngine;

const DICE = [];
for (let a = 1; a <= 6; a++) {
  for (let b = a; b <= 6; b++) DICE.push(a === b ? [a, a, a, a] : [a, b]);
}

// Wide-open doubles midgame, white to move with 2-2.
function midgame() {
  const board = new Array(24).fill(0);
  const white = { 0: 2, 1: 2, 8: 1, 9: 2, 11: 1, 15: 1, 16: 1, 17: 2, 18: 1, 22: 2 };
  for (const [i, n] of Object.entries(white)) board[i] = n;
  for (const i of [2, 3, 5, 6, 13, 14, 19]) board[i] = -2;
  board[23] = -1;
  return {
    board,
    bar: { white: 0, black: 0 },
    off: { white: 0, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [2, 2, 2, 2],
    rolledDice: [2, 2],
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
}

function bruteForce(gs, color, dice) {
  const opp = color === "white" ? "black" : "white";
  const seqs = legalTurnSequences({ ...gs, dice }, opp);
  if (seqs.length === 0) return evaluate(gs, color);
  return Math.min(...seqs.map(s => evaluate(s.finalGs, color)));
}

afterEach(() => { reverseFor = null; });

test("opponentReplyValue equals the brute-force minimum for every roll", () => {
  const gs = midgame();
  // Positions after each of white's candidate turns, from both sides' view.
  const afters = legalTurnSequences(gs, "white").slice(0, 5).map(s => s.finalGs);
  for (const after of afters) {
    for (const dice of DICE) {
      expect(opponentReplyValue(after, "white", dice)).toBe(bruteForce(after, "white", dice));
    }
  }
  for (const dice of DICE) {
    expect(opponentReplyValue(gs, "black", dice)).toBe(bruteForce(gs, "black", dice));
  }
});

test("opponentReplyValue falls back to evaluate when the opponent cannot move", () => {
  const gs = midgame();
  gs.board.fill(0);
  gs.board[12] = -15;               // black: all on its path pos 0
  gs.board[18] = 2;                 // white band on black's path pos 6
  gs.board[0]  = 13;
  const dice = [6, 6, 6, 6];
  expect(legalTurnSequences({ ...gs, dice }, "black")).toHaveLength(0);
  expect(opponentReplyValue(gs, "white", dice)).toBe(evaluate(gs, "white"));
});

test("opponentReplyValue does not mutate gs or dice", () => {
  const gs = midgame();
  const snapshot = JSON.stringify(gs);
  const dice = [3, 3, 3, 3];
  opponentReplyValue(gs, "black", dice);
  expect(JSON.stringify(gs)).toBe(snapshot);
  expect(dice).toEqual([3, 3, 3, 3]);
});

test("result is independent of the opponent's sequence order", () => {
  const gs = midgame();
  for (const dice of DICE) {
    const a = opponentReplyValue(gs, "black", dice);
    reverseFor = "white";
    const b = opponentReplyValue(gs, "black", dice);
    reverseFor = null;
    expect(b).toBe(a);
  }
});

test("Grandmaster's choice does not depend on the opponent's sequence order", () => {
  const gs = midgame();
  const legal = getLegalMoves(gs, "white");

  clearExpectimaxCache("reply-a");
  const forward = getNextExpectimaxMove(gs, "white", legal, "reply-a");
  clearExpectimaxCache("reply-a");

  reverseFor = "black";
  clearExpectimaxCache("reply-b");
  const reversed = getNextExpectimaxMove(gs, "white", legal, "reply-b");
  clearExpectimaxCache("reply-b");

  expect(reversed).toEqual(forward);
});
