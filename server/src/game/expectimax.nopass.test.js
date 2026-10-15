// ── Grandmaster: own jan when the opponent cannot reply (#88) ────────────────
// If our turn ends with us on the bar holding more checkers than entry points
// in our first quarter (§10), the game handlers call checkJanOnPass on us as
// the turn passes and we lose by jan. When the opponent has no legal reply to
// a roll, opponentReplyValue must score that as a plain jan loss (never
// sprängjan: a pass bursts nothing), not as evaluate() of a live position.

import { evaluate, opponentReplyValue } from "./expectimax.js";
import { legalTurnSequences, checkJanOnPass, checkWin, winPoints } from "./engine.js";
import { winRank } from "./scoring.js";

const JAN_VALUE = 100000 * winPoints("jan") + winRank("jan");

// Black: all 15 on its path pos 0 (index 12); a white band on black's path
// pos 6 (index 18) blocks 6-6, so black has no reply to 6-6.
// White: `onBar` on the bar, the rest on its own first quarter (indices 0-3)
// plus the band, so 4 of white's 6 entry points hold white's own checkers.
function position(onBar) {
  const board = new Array(24).fill(0);
  board[12] = -15;
  board[18] = 2;
  const rest = 13 - onBar;
  board[0] = rest - 6;
  board[1] = 2;
  board[2] = 2;
  board[3] = 2;
  return { board, bar: { white: onBar, black: 0 }, off: { white: 0, black: 0 } };
}

// The same position seen from the other side (board index i ↔ i + 12).
function swapColours({ board, bar, off }) {
  return {
    board: board.map((_, i) => -board[(i + 12) % 24]),
    bar: { white: bar.black, black: bar.white },
    off: { white: off.black, black: off.white },
  };
}

const SIXES = [6, 6, 6, 6];

test("the fixture: black cannot reply to 6-6 and white is jan with 3 on the bar", () => {
  const gs = position(3);
  expect(legalTurnSequences({ ...gs, dice: SIXES, moveSeq: 0 }, "black")).toHaveLength(0);
  expect(checkJanOnPass({ ...gs, turn: "white" })).toMatchObject({ winner: "black", winType: "jan" });
  expect(checkWin({ ...gs, turn: "white" })).toBeNull();
});

test("own jan with no opponent reply is exactly a plain jan loss", () => {
  const gs = position(3);
  const v = opponentReplyValue(gs, "white", SIXES);
  expect(v).toBe(-JAN_VALUE);
  expect(v).toBeLessThan(evaluate(gs, "white"));
  expect(v).toBeLessThan(evaluate(position(2), "white"));
});

test("the same holds for black (mirrored position)", () => {
  const gs = swapColours(position(3));
  expect(legalTurnSequences({ ...gs, dice: SIXES, moveSeq: 0 }, "white")).toHaveLength(0);
  expect(opponentReplyValue(gs, "black", SIXES)).toBe(-JAN_VALUE);
});

test("no opponent reply and not jan still returns evaluate()", () => {
  const gs = position(2);   // 2 on the bar, 2 entry points: not jan
  expect(checkJanOnPass({ ...gs, turn: "white" })).toBeNull();
  expect(legalTurnSequences({ ...gs, dice: SIXES, moveSeq: 0 }, "black")).toHaveLength(0);
  expect(opponentReplyValue(gs, "white", SIXES)).toBe(evaluate(gs, "white"));
});

test("a position white has already won returns its win value first", () => {
  // Black is jan too: 2 on the bar, its own checkers on 5 of its 6 entry points.
  const gs = position(3);
  gs.board[12] = -9;
  gs.board[13] = -1; gs.board[14] = -1; gs.board[15] = -1; gs.board[16] = -1;
  gs.bar.black = 2;
  expect(checkWin({ ...gs, turn: "white" })).toMatchObject({ winType: "jan" });
  expect(opponentReplyValue(gs, "white", SIXES)).toBe(JAN_VALUE);
});

test("no mutation, and the same result with or without a shared cache", () => {
  const gs = position(3);
  const dice = SIXES.slice();
  const snap = JSON.stringify(gs);
  const cache = new Map();
  const a = opponentReplyValue(gs, "white", dice, cache);
  const b = opponentReplyValue(gs, "white", dice, cache);
  const c = opponentReplyValue(gs, "white", dice);
  expect(JSON.stringify(gs)).toBe(snap);
  expect(dice).toEqual(SIXES);
  expect(a).toBe(b);
  expect(a).toBe(c);
});
