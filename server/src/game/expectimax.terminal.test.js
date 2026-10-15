// ── Grandmaster: game-ending sequences are terminal (#68) ────────────────────
// A turn sequence that wins the game (hemspel / bear-off §7, vackert spel §8,
// jan §10, as detected by the engine's checkWin) ends the game at once (§12):
//   - it must be preferred over every sequence that does not end the game;
//   - among winning sequences, one worth more points (WIN_POINTS, §13) wins;
//   - the opponent's reply must not be searched after it, since the opponent
//     never gets to move.
// Sprängjan (§11, 6 points) is a jan made by a move that burst a band in the
// mover's own first quarter. A position alone does not show it, so the tests
// replay the moves with applyMove and pass its burstFirstQuarter to checkWin.
// The engine's legalTurnSequences is wrapped (same results, or the same
// sequences in reverse order for `control.reverseFor`) so the tests can see
// which positions the search asks for the opponent's replies to, and can check
// that the choice does not depend on the order our sequences are listed in.

import { jest } from "@jest/globals";

const realEngine = await import("./engine.js");

const calls = [];   // { gs, color } for every legalTurnSequences call
const control = { reverseFor: null };
jest.unstable_mockModule("./engine.js", () => ({
  ...realEngine,
  legalTurnSequences: (gs, color) => {
    calls.push({
      gs: { board: gs.board.slice(), bar: { ...gs.bar }, off: { ...gs.off } },
      color,
    });
    const seqs = realEngine.legalTurnSequences(gs, color);
    return color === control.reverseFor ? seqs.slice().reverse() : seqs;
  },
}));

const { getNextExpectimaxMove, clearExpectimaxCache, opponentReplyValue, evaluate } =
  await import("./expectimax.js");
const { applyMove, checkWin, getLegalMoves, legalTurnSequences } = realEngine;

const other = c => (c === "white" ? "black" : "white");

function makeGs(board, dice, turn, bar = { white: 0, black: 0 }, off = { white: 0, black: 0 }) {
  return {
    board: board.slice(),
    bar: { ...bar },
    off: { ...off },
    turn,
    phase: "moving",
    dice: dice.slice(),
    rolledDice: dice.slice(),
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
}

// The same position seen from the other side: white's path pos p becomes
// black's path pos p and vice versa (board index i ↔ i + 12).
function swapColours({ board, bar, off }) {
  return {
    board: board.map((_, i) => -board[(i + 12) % 24]),
    bar: { white: bar.black, black: bar.white },
    off: { white: off.black, black: off.white },
  };
}

// Let Grandmaster play its whole turn, one move at a time, exactly as ai.js
// does. Returns the engine's win (or null) for the position it leaves, with
// the last move's burst flag so that a sprängjan is reported as one.
function playTurn(gs, color, roomId) {
  clearExpectimaxCache(roomId);
  try {
    let s = gs;
    let lastBurst = false;
    for (let i = 0; i < 4; i++) {
      const legal = getLegalMoves(s, color);
      if (legal.length === 0) break;
      const move = getNextExpectimaxMove(s, color, legal, roomId);
      expect(legal).toContainEqual(move);
      const r = applyMove(s, color, move.from, move.to, move.die);
      s = r.gs;
      lastBurst = r.burstFirstQuarter;
      if (checkWin({ ...s, turn: color }, lastBurst)) break;
    }
    return checkWin({ ...s, turn: color }, lastBurst);
  } finally {
    clearExpectimaxCache(roomId);
  }
}

// All fixtures are written with white to move; each also runs mirrored with
// black to move. `win` is the win type Grandmaster must reach.
const WIN_OVER_NON_WIN = [
  { name: "uppspel (vackert spel) instead of bearing off two checkers",
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 14],
    dice: [1, 2], win: "uppspel" },
  { name: "enkelt kronspel instead of an ordinary move",
    board: [0, -1, 0, 0, 0, 0, -8, -1, 0, 0, 0, 0, -1, 0, -2, -1, -1, 0, 1, 2, 3, 3, 3, 3],
    dice: [1, 4], win: "kronspel_enkelt" },
  { name: "jan by hitting a blot instead of bearing off",
    board: [0, 0, 0, 0, 0, 0, -4, 0, -1, 0, 0, 0, 0, -1, -1, -2, -2, -2, 3, 5, 4, 1, 2, -1],
    bar: { white: 0, black: 1 }, dice: [2, 6], win: "jan" },
  { name: "hemspel med munk instead of keeping a checker back",
    board: [0, 0, 0, 0, 0, 0, -8, 0, -1, 0, 0, 0, -1, 0, -2, 0, 0, 0, 1, 1, 0, 0, 0, -1],
    bar: { white: 0, black: 2 }, off: { white: 13, black: 0 }, dice: [5, 6], win: "hemspel_munk" },
];

const HIGHER_WIN = [
  { name: "jan (4) over uppspel med munk (3)",
    board: [0, 0, 0, 0, 0, 0, -3, 0, 0, 0, 0, 0, -2, -2, -2, -2, -2, 0, 0, 0, 0, 1, -1, 14],
    bar: { white: 0, black: 1 }, dice: [1, 2], win: "jan" },
  { name: "hemspel med munk (2) over hemspel (1)",
    board: [0, 0, 0, 0, 0, 0, -14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0],
    off: { white: 14, black: 0 }, dice: [1, 5], win: "hemspel_munk" },
];

function fixtureFor(fx, color) {
  const pos = {
    board: fx.board,
    bar: fx.bar ?? { white: 0, black: 0 },
    off: fx.off ?? { white: 0, black: 0 },
  };
  const p = color === "white" ? pos : swapColours(pos);
  return makeGs(p.board, fx.dice, color, p.bar, p.off);
}

function winTypesOf(gs, color) {
  return legalTurnSequences(gs, color).map(s => checkWin({ ...s.finalGs, turn: color })?.winType ?? null);
}

// Opponent legalTurnSequences calls made while Grandmaster picks its move.
function opponentSearches(gs, color) {
  clearExpectimaxCache("terminal-calls");
  calls.length = 0;
  getNextExpectimaxMove(gs, color, getLegalMoves(gs, color), "terminal-calls");
  clearExpectimaxCache("terminal-calls");
  return calls.filter(c => c.color === other(color));
}

beforeEach(() => { calls.length = 0; control.reverseFor = null; });
afterEach(() => { control.reverseFor = null; });

describe.each(["white", "black"])("%s to move", (color) => {
  const opp = other(color);

  describe.each(WIN_OVER_NON_WIN)("prefers a win: $name", (fx) => {
    test("precondition: a winning and a non-winning sequence are both legal, nobody has won yet", () => {
      const gs = fixtureFor(fx, color);
      expect(checkWin({ ...gs, turn: color })).toBeNull();
      expect(checkWin({ ...gs, turn: opp })).toBeNull();
      const types = winTypesOf(gs, color);
      expect(types).toContain(fx.win);
      expect(types).toContain(null);
    });

    test(`Grandmaster plays the winning sequence (${fx.win})`, () => {
      const win = playTurn(fixtureFor(fx, color), color, `win-${color}-${fx.win}`);
      expect(win?.winner).toBe(color);
      expect(win?.winType).toBe(fx.win);
    });

    test("the opponent's reply is never searched after a position that has already ended the game", () => {
      const searched = opponentSearches(fixtureFor(fx, color), color);
      const afterWin = searched.filter(c => checkWin({ ...c.gs, turn: color }));
      expect(afterWin.length).toBe(0);
    });

    test("no opponent reply is searched at all once a winning sequence exists", () => {
      expect(opponentSearches(fixtureFor(fx, color), color).length).toBe(0);
    });
  });

  describe.each(HIGHER_WIN)("prefers the higher-scoring win: $name", (fx) => {
    test("precondition: both wins are legal", () => {
      const gs = fixtureFor(fx, color);
      expect(checkWin({ ...gs, turn: color })).toBeNull();
      const wins = legalTurnSequences(gs, color)
        .map(s => checkWin({ ...s.finalGs, turn: color }))
        .filter(Boolean);
      const points = new Set(wins.map(w => w.points));
      expect(points.size).toBeGreaterThan(1);
      expect(Math.max(...wins.map(w => w.points)))
        .toBe(wins.find(w => w.winType === fx.win).points);
    });

    test("precondition: one of the two orders lists a lower win first", () => {
      const gs = fixtureFor(fx, color);
      const firstWin = seqs => seqs.map(s => checkWin({ ...s.finalGs, turn: color })).find(Boolean);
      const seqs = legalTurnSequences(gs, color);
      const firsts = [firstWin(seqs), firstWin(seqs.slice().reverse())];
      expect(firsts.some(w => w.winType !== fx.win)).toBe(true);
    });

    test.each([
      ["in the engine's order", false],
      ["with our sequences listed in reverse", true],
    ])(`Grandmaster plays ${fx.win} %s`, (_, reversed) => {
      control.reverseFor = reversed ? color : null;
      const win = playTurn(fixtureFor(fx, color), color, `higher-${color}-${fx.win}`);
      expect(win?.winner).toBe(color);
      expect(win?.winType).toBe(fx.win);
    });

    test("no opponent reply is searched at all once a winning sequence exists", () => {
      expect(opponentSearches(fixtureFor(fx, color), color).length).toBe(0);
    });
  });
});

// ── Sprängjan (§11, 6 points) over plain jan (4) (#68) ───────────────────────
// White to move has 2 on the bar and its own checkers on idx 0-3, so its only
// entry points are idx 4 (a black band) and idx 5 (a black blot). Black has 1
// on the bar and its own checkers on idx 12-16: one entry point left.
// Entering with the 5 bursts the band in white's own first quarter (§6 case B):
// black then has 3 on the bar, sprängjan. Entering with the 6 hits the blot:
// 2 on the bar, plain jan. Nobody has won yet. Mirrored for black.
const SPRANGJAN_BOARD = [3, 3, 3, 4, -2, -1, 0, 0, 0, 0, 0, 0, -2, -2, -2, -2, -3, 0, 0, 0, 0, 0, 0, 0];

function sprangjanPos(mover) {
  const pos = { board: SPRANGJAN_BOARD, bar: { white: 2, black: 1 }, off: { white: 0, black: 0 } };
  return mover === "white" ? pos : swapColours(pos);
}

// Replays `moves` for `color` and returns checkWin with the last burst flag.
function replayWin(gs, color, moves) {
  let s = gs;
  let lastBurst = false;
  for (const m of moves) {
    const r = applyMove(s, color, m.from, m.to, m.die);
    s = r.gs;
    lastBurst = r.burstFirstQuarter;
  }
  return checkWin({ ...s, turn: color }, lastBurst);
}

describe.each(["white", "black"])("sprängjan for %s (#68)", (color) => {
  const opp = other(color);

  test.each([[[5, 6]], [[6, 5]]])("precondition with dice %j: sprängjan and plain jan are both legal", (dice) => {
    const p = sprangjanPos(color);
    const gs = makeGs(p.board, dice, color, p.bar, p.off);
    expect(checkWin({ ...gs, turn: color })).toBeNull();
    expect(checkWin({ ...gs, turn: opp })).toBeNull();
    expect(realEngine.checkJanOnPass({ ...gs, turn: color })).toBeNull();
    const types = legalTurnSequences(gs, color).map(s => replayWin(gs, color, s.moves)?.winType);
    expect(types.sort()).toEqual(["jan", "sprangjan"]);
  });

  test.each([
    [[5, 6], false], [[6, 5], false], [[5, 6], true], [[6, 5], true],
  ])("with dice %j (our sequences reversed: %s) Grandmaster plays sprängjan", (dice, reversed) => {
    control.reverseFor = reversed ? color : null;
    const p = sprangjanPos(color);
    const gs = makeGs(p.board, dice, color, p.bar, p.off);
    const win = playTurn(gs, color, `sprangjan-${color}`);
    expect(win?.winner).toBe(color);
    expect(win?.winType).toBe("sprangjan");
  });

  test("an opponent sprängjan reply scores below an opponent plain-jan reply", () => {
    // The same position with `opp` to reply: with 5-6 it can make sprängjan,
    // with 6-6 only plain jan.
    const p = sprangjanPos(opp);
    const doubles = [6, 6, 6, 6];
    expect(legalTurnSequences({ ...p, dice: doubles }, opp)
      .map(s => replayWin({ ...p, dice: doubles }, opp, s.moves)?.winType)).toEqual(["jan"]);
    const sprang = opponentReplyValue(p, color, [5, 6]);
    const sprangOtherOrder = opponentReplyValue(p, color, [6, 5]);
    const plain = opponentReplyValue(p, color, doubles.slice());
    expect(plain).toBeLessThan(evaluate(p, color));
    expect(sprang).toBeLessThan(plain);
    expect(sprangOtherOrder).toBe(sprang);
  });
});

// ── opponentReplyValue on a position we have already won (#68) ───────────────
// If gs has already ended the game in `color`'s favour (checkWin with `color`
// as the mover), opponentReplyValue(gs, color, dice) must return a win value:
// above evaluate() of any unfinished position and larger for more points,
// without asking the engine for any opponent reply.

describe.each(["white", "black"])("opponentReplyValue on a position %s has already won (#68)", (color) => {
  const opp = other(color);

  // Final position of the fixture's winning sequence, for `color`.
  function wonPos(fx) {
    const gs = fixtureFor(fx, color);
    return legalTurnSequences(gs, color)
      .find(s => checkWin({ ...s.finalGs, turn: color })?.winType === fx.win).finalGs;
  }
  const UPPSPEL = WIN_OVER_NON_WIN[0];   // uppspel, 2 points
  const JAN     = WIN_OVER_NON_WIN[2];   // jan, 4 points

  // Very good but unfinished for `color`: 13 off, two checkers left on its
  // pos 20, the opponent with 6 on the bar (all entry points open) and 9 far back.
  function greatButUnfinished() {
    const board = new Array(24).fill(0);
    board[20] = 2;
    board[0] = -9;
    const pos = { board, bar: { white: 0, black: 6 }, off: { white: 13, black: 0 } };
    return color === "white" ? pos : swapColours(pos);
  }

  test("preconditions", () => {
    expect(UPPSPEL.win).toBe("uppspel");
    expect(JAN.win).toBe("jan");
    expect(checkWin({ ...wonPos(UPPSPEL), turn: color })?.winType).toBe("uppspel");
    expect(checkWin({ ...wonPos(JAN), turn: color })?.winType).toBe("jan");
    const g = greatButUnfinished();
    expect(checkWin({ ...g, turn: color })).toBeNull();
    expect(checkWin({ ...g, turn: opp })).toBeNull();
  });

  test.each([["uppspel", 0], ["jan", 2]])("a won %s position returns a win value without searching any opponent reply", (_, i) => {
    const won = wonPos(WIN_OVER_NON_WIN[i]);
    const great = greatButUnfinished();
    calls.length = 0;
    const v = opponentReplyValue(won, color, [3, 1]);
    expect(calls.filter(c => c.color === opp).length).toBe(0);
    expect(v).toBeGreaterThan(evaluate(great, color));
    expect(v).toBeGreaterThan(opponentReplyValue(great, color, [3, 1]));
  });

  test("a won jan (4 points) is worth more than a won uppspel (2 points)", () => {
    expect(opponentReplyValue(wonPos(JAN), color, [3, 1]))
      .toBeGreaterThan(opponentReplyValue(wonPos(UPPSPEL), color, [3, 1]));
  });
});
