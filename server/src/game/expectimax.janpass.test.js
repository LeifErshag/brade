// ── Grandmaster: our own jan when the opponent cannot reply (#88) ────────────
// After our turn we may be on the bar with more checkers there than entry
// points in our first quarter, because our OWN checkers fill it (§6: only an
// empty point or an opponent blot takes a re-entering checker; §10: the
// opponent's bands and blots count as open for jan, our own checkers do not).
// That is jan against us (checkJan / checkJanOnPass). When the opponent has a
// legal reply, the reply's final position shows the jan (checkWin with the
// opponent as mover). When the opponent has NO legal reply for the roll, the
// position stands, and the game handlers end it as our jan loss the next time
// we pass (checkJanOnPass). opponentReplyValue must then value it as a jan
// loss, not with evaluate(). If we are not jan, the no-reply fallback is still
// evaluate().
//
// Fixture (white is "us"; mirrored for black):
//   white: 2 on the bar; idx 0 (home) 3, blots on idx 1-4, idx 5 empty,
//          bands on idx 18 and 19 (black's path pos 6 and 7).
//   black: all 15 on its home, idx 12 (its path pos 0); nobody off.
// White has one entry point (idx 5) for 2 checkers on the bar: jan.
// With 6-6 black cannot move (its pos 6 is a white band); with 1-1 it can.
// Control: the same with 1 white checker on the bar (one entry point, not jan).

import { evaluate, opponentReplyValue } from "./expectimax.js";
import { checkWin, checkJanOnPass, legalTurnSequences, applyMove } from "./engine.js";

const other = c => (c === "white" ? "black" : "white");

function swapColours({ board, bar, off }) {
  return {
    board: board.map((_, i) => -board[(i + 12) % 24]),
    bar: { white: bar.black, black: bar.white },
    off: { white: off.black, black: off.white },
  };
}

function position(color, whiteOnBar) {
  const board = new Array(24).fill(0);
  board[0] = 3;
  for (const i of [1, 2, 3, 4]) board[i] = 1;
  board[18] = 5 - whiteOnBar;       // keeps white at 15 checkers
  board[19] = 3;
  board[12] = -15;
  const pos = { board, bar: { white: whiteOnBar, black: 0 }, off: { white: 0, black: 0 } };
  return color === "white" ? pos : swapColours(pos);
}

const janPos     = color => position(color, 2);
const controlPos = color => position(color, 1);

const count = (pos, color) =>
  pos.board.reduce((n, v) => n + (color === "white" ? Math.max(v, 0) : Math.max(-v, 0)), 0) +
  pos.bar[color] + pos.off[color];

const NO_REPLY = [6, 6, 6, 6];
const REPLY    = [1, 1, 1, 1];

const DICE = [];
for (let a = 1; a <= 6; a++) {
  for (let b = a; b <= 6; b++) DICE.push(a === b ? [a, a, a, a] : [a, b]);
}

describe.each(["white", "black"])("opponentReplyValue when %s is jan and the opponent cannot reply (#88)", (color) => {
  const opp = other(color);

  test("preconditions: 15 checkers each, we have not won, and the engine's jan state is as described", () => {
    for (const pos of [janPos(color), controlPos(color)]) {
      expect(count(pos, "white")).toBe(15);
      expect(count(pos, "black")).toBe(15);
      expect(checkWin({ ...pos, turn: color })).toBeNull();
      // The opponent has no legal reply for 6-6, but has one for 1-1.
      expect(legalTurnSequences({ ...pos, dice: NO_REPLY.slice() }, opp)).toHaveLength(0);
      expect(legalTurnSequences({ ...pos, dice: REPLY.slice() }, opp).length).toBeGreaterThan(0);
    }
    // Jan against us (the engine's own rule: checkJanOnPass at our pass, and
    // checkWin as seen from the opponent), but not in the control.
    expect(checkWin({ ...janPos(color), turn: opp })).toMatchObject({ winner: opp, winType: "jan" });
    expect(checkWin({ ...controlPos(color), turn: opp })).toBeNull();
    expect(checkJanOnPass({ ...janPos(color), turn: color })).toMatchObject({ winner: opp, winType: "jan" });
    expect(checkJanOnPass({ ...controlPos(color), turn: color })).toBeNull();
  });

  test("precondition: whatever we roll next, the engine ends the game as our jan loss", () => {
    const pos = janPos(color);
    for (const dice of DICE) {
      const gs = { ...pos, dice: dice.slice() };
      const seqs = legalTurnSequences(gs, color);
      if (seqs.length === 0) {
        expect(checkJanOnPass({ ...pos, turn: color })?.winner).toBe(opp);
        continue;
      }
      for (const { moves } of seqs) {
        let s = gs;
        for (const m of moves) {
          const r = applyMove(s, color, m.from, m.to, m.die);
          s = r.gs;
          expect(checkWin({ ...s, turn: color }, r.burstFirstQuarter)).toBeNull();
        }
        expect(checkJanOnPass({ ...s, turn: color })?.winner).toBe(opp);
      }
    }
  });

  test("precondition: when the opponent can reply, the reply is valued as a jan loss below any continuing position", () => {
    const janLoss = opponentReplyValue(janPos(color), color, REPLY.slice());
    expect(janLoss).toBeLessThan(evaluate(janPos(color), color));
    expect(janLoss).toBeLessThan(evaluate(controlPos(color), color));
    expect(janLoss).toBeLessThan(-1000);
  });

  test("with no opponent reply, our jan scores at or below the jan-loss value", () => {
    const janLoss = opponentReplyValue(janPos(color), color, REPLY.slice());
    const v = opponentReplyValue(janPos(color), color, NO_REPLY.slice());
    expect(v).toBeLessThanOrEqual(janLoss);
    expect(v).toBeLessThan(evaluate(janPos(color), color));
    expect(v).toBeLessThan(opponentReplyValue(controlPos(color), color, NO_REPLY.slice()));
    expect(v).toBeLessThan(opponentReplyValue(controlPos(color), color, REPLY.slice()));
  });

  test("with no opponent reply and no jan, the position is still valued with evaluate()", () => {
    const pos = controlPos(color);
    expect(opponentReplyValue(pos, color, NO_REPLY.slice())).toBe(evaluate(pos, color));
  });

  test("the no-reply jan value does not mutate its inputs and is the same with a fresh cache", () => {
    const pos = janPos(color);
    const before = JSON.stringify(pos);
    const dice = NO_REPLY.slice();
    const v = opponentReplyValue(pos, color, dice);
    expect(JSON.stringify(pos)).toBe(before);
    expect(dice).toEqual(NO_REPLY);
    expect(opponentReplyValue(pos, color, NO_REPLY.slice(), new Map())).toBe(v);
  });
});
