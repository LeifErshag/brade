// ── Grandmaster: game-ending sequences are terminal (#68) ────────────────────
// A turn sequence that wins the game (hemspel / bear-off §7, vackert spel §8,
// jan §10, as detected by the engine's checkWin) ends the game at once (§12):
//   - it must be preferred over every sequence that does not end the game;
//   - among winning sequences, one worth more points (WIN_POINTS, §13) wins;
//   - the opponent's reply must not be searched after it, since the opponent
//     never gets to move.
// The engine's legalTurnSequences is wrapped (not changed) so the tests can
// see which positions the search asks for the opponent's replies to.

import { jest } from "@jest/globals";

const realEngine = await import("./engine.js");

const calls = [];   // { gs, color } for every legalTurnSequences call
jest.unstable_mockModule("./engine.js", () => ({
  ...realEngine,
  legalTurnSequences: (gs, color) => {
    calls.push({
      gs: { board: gs.board.slice(), bar: { ...gs.bar }, off: { ...gs.off } },
      color,
    });
    return realEngine.legalTurnSequences(gs, color);
  },
}));

const { getNextExpectimaxMove, clearExpectimaxCache } = await import("./expectimax.js");
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
// does. Returns the engine's win (or null) for the position it leaves.
function playTurn(gs, color, roomId) {
  clearExpectimaxCache(roomId);
  try {
    let s = gs;
    for (let i = 0; i < 4; i++) {
      const legal = getLegalMoves(s, color);
      if (legal.length === 0) break;
      const move = getNextExpectimaxMove(s, color, legal, roomId);
      expect(legal).toContainEqual(move);
      s = applyMove(s, color, move.from, move.to, move.die).gs;
      if (checkWin({ ...s, turn: color })) break;
    }
    return checkWin({ ...s, turn: color });
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

beforeEach(() => { calls.length = 0; });

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
      const gs = fixtureFor(fx, color);
      clearExpectimaxCache("terminal-calls");
      calls.length = 0;
      getNextExpectimaxMove(gs, color, getLegalMoves(gs, color), "terminal-calls");
      clearExpectimaxCache("terminal-calls");
      const afterWin = calls.filter(c => c.color === opp && checkWin({ ...c.gs, turn: color }));
      expect(afterWin.length).toBe(0);
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

    test(`Grandmaster plays ${fx.win}`, () => {
      const win = playTurn(fixtureFor(fx, color), color, `higher-${color}-${fx.win}`);
      expect(win?.winner).toBe(color);
      expect(win?.winType).toBe(fx.win);
    });

    test("the opponent's reply is never searched after a winning sequence", () => {
      const gs = fixtureFor(fx, color);
      clearExpectimaxCache("terminal-calls");
      calls.length = 0;
      getNextExpectimaxMove(gs, color, getLegalMoves(gs, color), "terminal-calls");
      clearExpectimaxCache("terminal-calls");
      const afterWin = calls.filter(c => c.color === opp && checkWin({ ...c.gs, turn: color }));
      expect(afterWin.length).toBe(0);
    });
  });
});
