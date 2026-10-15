// ── Grandmaster: game-ending sequences and the opponent's jan threat (#68) ────
// A sequence that ends the game (checkWin with the mover as gs.turn) is
// terminal: Grandmaster takes the win worth the most points and searches no
// reply after it. An opponent reply that ends the game is a loss, valued below
// any continuing position and lower the more points it costs (§13-14).

import {
  getNextExpectimaxMove,
  clearExpectimaxCache,
  evaluate,
  opponentReplyValue,
  janThreat,
} from "./expectimax.js";
import { pathToIdx, checkWin, getLegalMoves, applyMove } from "./engine.js";

const other = c => (c === "white" ? "black" : "white");

function emptyGs(turn = "white") {
  return {
    board: new Array(24).fill(0),
    bar:   { white: 0, black: 0 },
    off:   { white: 0, black: 0 },
    turn,
    phase: "moving",
    dice:  [],
    rolledDice: [],
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
}

// `n` checkers of `owner` on the point that is path pos `pos` of `viewer`.
function put(gs, viewer, pos, owner, n) {
  gs.board[pathToIdx(viewer, pos)] = owner === "white" ? n : -n;
}

// Play `color`'s whole turn with Grandmaster, one move at a time.
function playTurn(gs, color, room) {
  clearExpectimaxCache(room);
  let s = gs;
  for (;;) {
    const legal = getLegalMoves(s, color);
    if (legal.length === 0) return s;
    const m = getNextExpectimaxMove(s, color, legal, room);
    expect(legal).toContainEqual(m);
    s = applyMove(s, color, m.from, m.to, m.die).gs;
    if (checkWin({ ...s, turn: color })) return s;
  }
}

describe.each(["white", "black"])("Grandmaster wins for %s", (color) => {
  const opp = other(color);

  test("§8 uppspel: plays 22→23 rather than bearing off", () => {
    const gs = emptyGs(color);
    put(gs, color, 23, color, 14);
    put(gs, color, 22, color, 1);
    put(gs, opp, 3, opp, 15);
    gs.dice = [1, 2];
    const end = playTurn(gs, color, "W1" + color);
    expect(checkWin({ ...end, turn: color })?.winType).toBe("uppspel");
  });

  test("§10 hits a blot that makes the opponent jan", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 4; p++) put(gs, opp, p, opp, 2); // own Q1 blocks them
    put(gs, opp, 10, opp, 1);                             // blot (our pos 22)
    put(gs, opp, 20, opp, 3);
    gs.bar[opp] = 1;
    put(gs, color, 18, color, 14);
    put(gs, color, 21, color, 1);
    gs.dice = [1, 2];
    const end = playTurn(gs, color, "W2" + color);
    expect(checkWin({ ...end, turn: color })?.winType).toBe("jan");
  });

  test.each([[[5, 6]], [[6, 5]]])("§11 prefers sprängjan (burst in our Q1) over plain jan, dice %j", (dice) => {
    const gs = emptyGs(color);
    gs.bar[color] = 2;
    put(gs, color, 0, color, 4);
    for (let p = 1; p <= 3; p++) put(gs, color, p, color, 3);
    put(gs, color, 4, opp, 2);                 // their band in our Q1
    put(gs, color, 5, opp, 1);                 // their blot in our Q1
    gs.bar[opp] = 1;
    put(gs, opp, 0, opp, 3);
    for (let p = 1; p <= 4; p++) put(gs, opp, p, opp, 2);
    gs.dice = dice;
    clearExpectimaxCache("SJ" + color);
    const legal = getLegalMoves(gs, color);
    const m = getNextExpectimaxMove(gs, color, legal, "SJ" + color);
    clearExpectimaxCache("SJ" + color);
    expect(m).toEqual({ from: "bar", to: pathToIdx(color, 4), die: 5 });
    const r = applyMove(gs, color, m.from, m.to, m.die);
    expect(checkWin({ ...r.gs, turn: color }, r.burstFirstQuarter)?.winType).toBe("sprangjan");
  });

  test("an opponent sprängjan reply scores below an opponent plain-jan reply", () => {
    // Mirror of the test above, seen from the side that gets made jan.
    const gs = emptyGs(opp);
    gs.bar[opp] = 2;
    put(gs, opp, 0, opp, 4);
    for (let p = 1; p <= 3; p++) put(gs, opp, p, opp, 3);
    put(gs, opp, 4, color, 2);
    put(gs, opp, 5, color, 1);
    gs.bar[color] = 1;
    put(gs, color, 0, color, 3);
    for (let p = 1; p <= 4; p++) put(gs, color, p, color, 2);
    const burstOnly = opponentReplyValue(gs, color, [5, 5, 5, 5]); // only bar→4
    const hitOnly   = opponentReplyValue(gs, color, [6, 6, 6, 6]); // only bar→5
    expect(burstOnly).toBeLessThan(hitOnly);
    expect(hitOnly).toBeLessThan(-1000);
  });

  test("§7/§9 bearing off the last two with the opponent on the bar is hemspel med munk", () => {
    const gs = emptyGs(color);
    gs.off[color] = 13;
    put(gs, color, 22, color, 1);
    put(gs, color, 23, color, 1);
    put(gs, opp, 20, opp, 13);
    gs.bar[opp] = 2;
    gs.dice = [1, 2];
    const end = playTurn(gs, color, "W3" + color);
    const win = checkWin({ ...end, turn: color });
    expect(win?.winType).toBe("hemspel_munk");
    expect(win?.points).toBe(2);
  });

  test("opponent reply that ends the game is worse than any continuing position, and worse by points", () => {
    // The opponent can bear off its last checker: hemspel (1 point).
    const home = emptyGs(color);
    home.off[opp] = 14;
    put(home, opp, 23, opp, 1);
    put(home, color, 0, color, 15);
    const lossHemspel = opponentReplyValue(home, color, [1, 2]);

    // Same, but with one of ours on the bar: hemspel med munk (2 points).
    const munk = emptyGs(color);
    munk.off[opp] = 14;
    put(munk, opp, 23, opp, 1);
    put(munk, color, 0, color, 14);
    munk.bar[color] = 1;
    const lossMunk = opponentReplyValue(munk, color, [1, 2]);

    expect(lossHemspel).toBeLessThan(evaluate(home, color));
    expect(lossHemspel).toBeLessThan(-1000);
    expect(lossMunk).toBeLessThan(lossHemspel);
  });

  test("evaluate subtracts the opponent's jan threat against us", () => {
    // Three of ours on the bar. `bands` are our own bands; those in our Q1
    // (path pos 0-5) take away our entry points.
    const pos = (bands) => {
      const gs = emptyGs(color);
      for (const p of bands) put(gs, color, p, color, 3);
      put(gs, color, 20, color, 3);
      gs.bar[color] = 3;
      put(gs, opp, 20, opp, 15);
      return gs;
    };
    const a = pos([3, 4, 5]);   // 3 entry points left for 3 on the bar
    const b = pos([4, 5, 6]);   // 4 entry points left
    expect(janThreat(a, opp, color)).toBe(30);
    expect(janThreat(b, opp, color)).toBe(0);
    // b is only 3 pips ahead otherwise; the near-jan term adds 30 more.
    expect(evaluate(b, color) - evaluate(a, color)).toBeGreaterThan(20);
  });
});

test("one evalCache shared across colours and bar/off variants matches fresh caches", () => {
  const gs = emptyGs("white");
  put(gs, "white", 5, "white", 2);
  put(gs, "white", 10, "white", 13);
  put(gs, "black", 5, "black", 2);
  put(gs, "black", 10, "black", 13);
  const variants = [
    gs,
    { ...gs, bar: { white: 1, black: 0 } },
    { ...gs, off: { white: 0, black: 1 } },
  ];
  const shared = new Map();
  for (const v of variants) {
    for (const c of ["white", "black", "white"]) {
      for (const dice of [[1, 2], [6, 5], [3, 3, 3, 3]]) {
        expect(opponentReplyValue(v, c, dice, shared))
          .toBe(opponentReplyValue(v, c, dice, new Map()));
      }
    }
  }
});
