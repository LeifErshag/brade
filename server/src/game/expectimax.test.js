// ── Grandmaster (expectimax) heuristic tests ─────────────────────────────────
// janThreat(gs, color, opp) scores how close `color` is to making `opp` jan.
// §10 (p.6): opp is jan when bar[opp] exceeds the points of opp's first quarter
// that are "tomma eller upptagna av spelarens band eller blottor", i.e. every
// Q1 point NOT holding opp's own checkers. Our bands there are burstable (§6),
// so they count as AVAILABLE, exactly as in the engine's checkJan. See #35.

import * as expectimax from "./expectimax.js";
import { pathToIdx, checkWin, legalTurnSequences, getLegalMoves } from "./engine.js";

const { janThreat } = expectimax;

const JAN_BONUS = 50;           // janThreat >= 50 means "this is a jan position"
const JAN_PER_EXTRA = 20;       // + 20 per bar checker beyond the available points

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

const other = c => (c === "white" ? "black" : "white");

// Put `n` checkers of `owner` on the point that is path pos `pos` of `viewer`.
function putOnPathOf(gs, viewer, pos, owner, n) {
  gs.board[pathToIdx(viewer, pos)] = owner === "white" ? n : -n;
}

test("janThreat is exported as a function", () => {
  expect(typeof janThreat).toBe("function");
});

describe.each(["white", "black"])("janThreat for %s", (color) => {
  const opp = other(color);

  test("§10 no opponent checker on the bar → 0", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 5; p++) putOnPathOf(gs, opp, p, color, 2);
    expect(janThreat(gs, color, opp)).toBe(0);
  });

  test("§10 our bands on all six of the opponent's Q1 points count as available → not jan", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 5; p++) putOnPathOf(gs, opp, p, color, 2);
    gs.bar[opp] = 2;
    expect(checkWin({ ...gs, turn: color })).toBeNull();   // the engine agrees: no jan
    expect(janThreat(gs, color, opp)).toBeLessThan(JAN_BONUS);
  });

  test("§10 our bands, our blots and empty points all count as available", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 2; p++) putOnPathOf(gs, opp, p, color, 3);  // our bands
    putOnPathOf(gs, opp, 3, color, 1);                                // our blot
    putOnPathOf(gs, opp, 4, color, 1);                                // our blot
    // opp pos 5 empty → available = 6
    gs.bar[opp] = 5;
    expect(janThreat(gs, color, opp)).toBeLessThan(JAN_BONUS);
  });

  test("§10 the opponent's own checkers make its Q1 points unavailable → jan threat", () => {
    const gs = emptyGs(color);
    putOnPathOf(gs, opp, 0, opp, 2);   // opp's own band
    putOnPathOf(gs, opp, 1, opp, 1);   // opp's own blots
    putOnPathOf(gs, opp, 2, opp, 1);
    putOnPathOf(gs, opp, 3, opp, 1);
    // opp pos 4, 5 empty → available = 2
    gs.bar[opp] = 3;
    expect(checkWin({ ...gs, turn: color })?.winType).toBe("jan");
    expect(janThreat(gs, color, opp)).toBe(JAN_BONUS + 1 * JAN_PER_EXTRA);
  });

  test("§10 opponent's own checkers block, our bands do not: available = 2", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 3; p++) putOnPathOf(gs, opp, p, opp, 1);     // opp's own
    putOnPathOf(gs, opp, 4, color, 2);                                // our band
    putOnPathOf(gs, opp, 5, color, 2);                                // our band
    gs.bar[opp] = 4;
    expect(checkWin({ ...gs, turn: color })?.winType).toBe("jan");
    expect(janThreat(gs, color, opp)).toBe(JAN_BONUS + 2 * JAN_PER_EXTRA);
  });

  test("§10 boundary: bar equal to the available points is not jan", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 3; p++) putOnPathOf(gs, opp, p, opp, 1);     // available = 2
    gs.bar[opp] = 2;
    expect(checkWin({ ...gs, turn: color })).toBeNull();
    expect(janThreat(gs, color, opp)).toBeLessThan(JAN_BONUS);
  });

  test("§10 janThreat flags a jan exactly when the engine's checkWin does", () => {
    // Deterministic pseudo-random Q1 layouts: each opp Q1 point is empty, ours
    // (blot or band) or opp's own (blot or band).
    let seed = color === "white" ? 12345 : 67890;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200; i++) {
      const gs = emptyGs(color);
      for (let p = 0; p <= 5; p++) {
        const r = rnd();
        if (r < 0.2) continue;
        const owner = r < 0.6 ? color : opp;
        putOnPathOf(gs, opp, p, owner, rnd() < 0.5 ? 1 : 2);
      }
      gs.bar[opp] = 1 + Math.floor(rnd() * 6);
      const engineJan = checkWin({ ...gs, turn: color })?.winType === "jan";
      expect({ i, flagged: janThreat(gs, color, opp) >= JAN_BONUS })
        .toEqual({ i, flagged: engineJan });
    }
  });
});

// ── Opponent reply search (#62) ──────────────────────────────────────────────
// Grandmaster's 2-ply search must find the opponent's BEST reply (the one that
// minimises our evaluation) among ALL of the opponent's legal turn sequences,
// not only among the first few in the engine's enumeration order.
//
// Contract used here:
//   evaluate(gs, color)                    → static score from `color`'s view
//   opponentReplyValue(gs, color, dice)    → min over every opponent legal turn
//     sequence of evaluate(seq.finalGs, color), where the opponent rolls `dice`
//     from position gs ({ board, bar, off }); evaluate(gs, color) if none.
// The fixtures below contain no game-ending opponent replies (those are #68).

const TRUNCATED_PREFIX = 50;   // the old cut-off: MAX_OPP_CANDIDATES * 5

function posGs(board) {
  return { board: board.slice(), bar: { white: 0, black: 0 }, off: { white: 0, black: 0 } };
}

// Positions where the opponent's best reply lies far beyond the first 50
// sequences that legalTurnSequences enumerates.
const DEEP_BEST_REPLY = [
  { color: "white", dice: [4, 4, 4, 4],
    board: [2, 1, 0, 2, 0, -2, 2, 0, -1, 0, -2, -2, 2, -2, 0, -2, 0, 0, 2, 0, 2, -2, -2, 2] },
  { color: "black", dice: [2, 2, 2, 2],
    board: [2, 2, 0, 0, 2, 0, 0, 2, -2, 0, -2, -2, -2, -2, 2, -2, -2, -1, 2, 1, 2, 0, 0, 0] },
];

describe("opponent reply search (#62)", () => {
  test("evaluate and opponentReplyValue are exported functions", () => {
    expect(typeof expectimax.evaluate).toBe("function");
    expect(typeof expectimax.opponentReplyValue).toBe("function");
  });

  describe.each(DEEP_BEST_REPLY)("$color to move, opponent rolls $dice", ({ color, dice, board }) => {
    const opp = other(color);

    test("precondition: the best reply is beyond the first 50 enumerated sequences", () => {
      const { evaluate } = expectimax;
      const seqs = legalTurnSequences({ ...posGs(board), dice }, opp);
      expect(seqs.some(s => s.ends)).toBe(false);
      const vals = seqs.map(s => evaluate(s.finalGs, color));
      const best = Math.min(...vals);
      expect(vals.indexOf(best)).toBeGreaterThanOrEqual(TRUNCATED_PREFIX);
      expect(Math.min(...vals.slice(0, TRUNCATED_PREFIX))).toBeGreaterThan(best);
    });

    test("opponentReplyValue equals the minimum over ALL legal opponent sequences", () => {
      const { evaluate, opponentReplyValue } = expectimax;
      const seqs = legalTurnSequences({ ...posGs(board), dice }, opp);
      const bruteMin = Math.min(...seqs.map(s => evaluate(s.finalGs, color)));
      expect(opponentReplyValue(posGs(board), color, dice.slice())).toBe(bruteMin);
    });

    test("opponentReplyValue does not mutate its inputs", () => {
      const gs = posGs(board);
      const before = JSON.stringify(gs);
      const d = dice.slice();
      expectimax.opponentReplyValue(gs, color, d);
      expect(JSON.stringify(gs)).toBe(before);
      expect(d).toEqual(dice);
    });
  });

  test("performance: a wide-open doubles position is searched well within budget", () => {
    // Many blots and short stacks on both sides, white rolls 2-2: one of the
    // heaviest positions found (~250 ms on main, ~400 ms evaluating every reply).
    const board = [2, 2, -2, -2, 0, -2, -2, 0, 1, 2, 0, 1, 0, -2, -2, 1, 1, 2, 1, -2, 0, 0, 2, -1];
    const gs = { ...emptyGs("white"), board, dice: [2, 2, 2, 2] };
    const legal = getLegalMoves(gs, "white");
    expectimax.clearExpectimaxCache("perf-62");
    const t0 = Date.now();
    const move = expectimax.getNextExpectimaxMove(gs, "white", legal, "perf-62");
    const elapsed = Date.now() - t0;
    expectimax.clearExpectimaxCache("perf-62");
    expect(legal).toContainEqual(move);
    // Must finish clearly below the 5 s search timeout (so the search is not
    // being cut short by it).
    expect(elapsed).toBeLessThan(2500);
  });
});
