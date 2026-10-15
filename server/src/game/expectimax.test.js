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
const NEAR_JAN = 30;            // bar == available: one more checker on the bar is jan

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

  test("§10 near jan: bar equal to the available points scores exactly 30 (#68)", () => {
    const gs = emptyGs(color);
    for (let p = 0; p <= 3; p++) putOnPathOf(gs, opp, p, opp, 1);     // available = 2
    gs.bar[opp] = 2;
    expect(janThreat(gs, color, opp)).toBe(NEAR_JAN);
    // Same with every Q1 point open: 6 on the bar, 6 available.
    const open = emptyGs(color);
    open.bar[opp] = 6;
    expect(janThreat(open, color, opp)).toBe(NEAR_JAN);
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
    // heaviest positions found (about 170-220 ms measured after #75).
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

// ── The opponent's jan threat against us (#68) ───────────────────────────────
// evaluate(gs, color) must also count how close the OPPONENT is to making
// `color` jan, i.e. subtract janThreat(gs, opp, color) or an equivalent term.
// Each pair below differs only in that exposure: the same number of our bands,
// all with the same location weight, the same pip count, no blots, no prime and
// the opponent's checkers untouched. Only the number of our own stacks in our
// first quarter (where our bar checkers cannot enter) differs.

describe.each(["white", "black"])("evaluate counts the opponent's jan threat against %s (#68)", (color) => {
  const opp = other(color);

  // `bands`: our path positions holding a band of 2; plus a band of 4 on our
  // path pos 13 and three of the opponent's bands of 5, away from all of them.
  function exposurePos(bands, ourBar) {
    const gs = emptyGs(color);
    for (const p of bands) putOnPathOf(gs, color, p, color, 2);
    putOnPathOf(gs, color, 13, color, 4);
    for (const p of [0, 10, 21]) putOnPathOf(gs, opp, p, opp, 5);
    gs.bar[color] = ourBar;
    return gs;
  }

  test("near jan against us scores lower than the same material with one more entry point", () => {
    // 3 on our bar. Exposed: our own stacks on our Q1 pos 1, 3, 5, so 3 entry
    // points are left (the opponent is near jan). Safer: pos 1, 3, so 4 are left.
    const exposed = exposurePos([1, 3, 5, 20], 3);
    const safer   = exposurePos([1, 3, 7, 18], 3);
    expect(janThreat(exposed, opp, color)).toBe(NEAR_JAN);
    expect(janThreat(safer, opp, color)).toBe(0);
    // Preconditions: neither position is a won game for either side.
    for (const gs of [exposed, safer]) {
      expect(checkWin({ ...gs, turn: opp })).toBeNull();
      expect(checkWin({ ...gs, turn: color })).toBeNull();
    }
    expect(expectimax.evaluate(exposed, color)).toBeLessThan(expectimax.evaluate(safer, color));
  });

  test("control: with nobody on the bar the same pair scores the same", () => {
    const exposed = exposurePos([1, 3, 5, 20], 0);
    const safer   = exposurePos([1, 3, 7, 18], 0);
    expect(expectimax.evaluate(exposed, color)).toBe(expectimax.evaluate(safer, color));
  });
});

// ── Evaluation cache (#68, leftovers from the #75 review) ────────────────────
// opponentReplyValue(gs, color, dice, evalCache) may be handed one cache for
// several calls. Whatever the cache already holds, each result must equal the
// result with a fresh cache.

describe("opponentReplyValue with a shared evaluation cache (#68)", () => {
  // A mid-game position (no ending replies) where black rolls 3-1.
  const BOARD = [2, 2, 0, 0, -2, 0, 0, 2, 0, 2, 0, 2, -6, 0, -2, 0, 2, 0, -2, 0, 2, 0, -3, 1];
  const DICE = [3, 1];
  const plain = () => posGs(BOARD);

  test("precondition: the fixture has several opponent replies and none ends the game", () => {
    const seqs = legalTurnSequences({ ...plain(), dice: DICE }, "black");
    expect(seqs.length).toBeGreaterThan(1);
    expect(seqs.some(s => s.ends)).toBe(false);
  });

  test.each([
    ["off", gs => { gs.off.white = 2; }],
    ["bar", gs => { gs.bar.white = 1; }],
  ])("positions that differ only in white's %s do not collide in one cache", (_, tweak) => {
    const { opponentReplyValue } = expectimax;
    const tweaked = plain();
    tweak(tweaked);
    const expectedPlain   = opponentReplyValue(plain(), "white", DICE.slice());
    const expectedTweaked = opponentReplyValue(tweaked, "white", DICE.slice());
    expect(expectedTweaked).not.toBe(expectedPlain);   // the fixture tells them apart

    const cache = new Map();
    expect(opponentReplyValue(plain(), "white", DICE.slice(), cache)).toBe(expectedPlain);
    expect(opponentReplyValue(tweaked, "white", DICE.slice(), cache)).toBe(expectedTweaked);

    const cache2 = new Map();
    expect(opponentReplyValue(tweaked, "white", DICE.slice(), cache2)).toBe(expectedTweaked);
    expect(opponentReplyValue(plain(), "white", DICE.slice(), cache2)).toBe(expectedPlain);
  });

  test("one cache shared by a white and a black evaluation gives each colour its own value", () => {
    // P: white has 3 on the bar, blots on its pos 0 and 1 and a band of 10 on
    // pos 18; black has 7 + 7 on its pos 1 and 2 and a blot on its pos 10.
    // fromBlack: P with that black blot 3 pips back (black rolls 1-2 to reach P).
    // fromWhite: P with white's two blots still on the bar (white rolls 1-2 and
    // must enter both, which can only reach P).
    // So both calls evaluate the same final position P, once for each colour.
    const P = new Array(24).fill(0);
    P[0] = 1; P[1] = 1; P[18] = 10; P[13] = -7; P[14] = -7; P[22] = -1;
    const fromBlack = posGs(P);
    fromBlack.bar.white = 3;
    fromBlack.board[22] = 0; fromBlack.board[19] = -1;
    const fromWhite = posGs(P);
    fromWhite.bar.white = 5;
    fromWhite.board[0] = 0; fromWhite.board[1] = 0;
    const dice = [1, 2];
    const finalP = { board: P, bar: { white: 3, black: 0 }, off: { white: 0, black: 0 } };

    const { evaluate, opponentReplyValue } = expectimax;
    expect(evaluate(finalP, "white")).not.toBe(evaluate(finalP, "black"));
    const whiteFresh = opponentReplyValue(fromBlack, "white", dice.slice());
    const blackFresh = opponentReplyValue(fromWhite, "black", dice.slice());
    expect(blackFresh).toBe(evaluate(finalP, "black"));   // P is white's only reply

    const cache = new Map();
    expect(opponentReplyValue(fromBlack, "white", dice.slice(), cache)).toBe(whiteFresh);
    expect(opponentReplyValue(fromWhite, "black", dice.slice(), cache)).toBe(blackFresh);

    const cache2 = new Map();
    expect(opponentReplyValue(fromWhite, "black", dice.slice(), cache2)).toBe(blackFresh);
    expect(opponentReplyValue(fromBlack, "white", dice.slice(), cache2)).toBe(whiteFresh);
  });
});

// ── An opponent reply that ends the game is a loss (#68) ─────────────────────
// opponentReplyValue(gs, color, dice): if one of the opponent's legal sequences
// wins the game (hemspel, vackert spel, jan), that reply is a loss for `color`.
// It must score below evaluate() of a position where the game goes on, however
// bad, and so below every non-ending reply. Losing more points is worse.

describe("opponentReplyValue treats a game-ending opponent reply as a loss (#68)", () => {
  // Black has 14 off and one checker on its pos 23 (idx 11): every roll bears
  // it off (hemspel).
  function blackBearsOff() {
    const board = new Array(24).fill(0);
    board[11] = -1;
    board[0] = 5; board[6] = 5; board[16] = 5;          // white, mid-game
    return { board, bar: { white: 0, black: 0 }, off: { white: 0, black: 14 } };
  }

  // Black can make white jan: white has 2 on the bar and its own checkers on
  // its pos 0-3 (2 entry points left), and a blot on pos 9 that the black blot
  // on idx 8 hits with the 1. Black cannot bear off.
  function blackCanMakeJan() {
    const board = new Array(24).fill(0);
    board[0] = 2; board[1] = 2; board[2] = 2; board[3] = 2;  // white on its own Q1
    board[9] = 1;                                           // white blot
    board[18] = 4;                                          // white
    board[8] = -1;                                          // black blot
    board[13] = -7; board[15] = -7;                         // black
    return { board, bar: { white: 2, black: 0 }, off: { white: 0, black: 0 } };
  }

  // Bad but unfinished for white: 6 on the bar with all six entry points open
  // (near jan, not jan), black far ahead with 13 off.
  function badButUnfinished() {
    const board = new Array(24).fill(0);
    board[12] = 9;                                          // white on its pos 12
    board[20] = -2;                                         // black's last two checkers
    return { board, bar: { white: 6, black: 0 }, off: { white: 0, black: 13 } };
  }

  test("preconditions", () => {
    const h = legalTurnSequences({ ...blackBearsOff(), dice: [1, 2] }, "black");
    expect(h.length).toBeGreaterThan(0);
    expect(h.every(s => checkWin({ ...s.finalGs, turn: "black" })?.winType === "hemspel")).toBe(true);

    const gs = blackCanMakeJan();
    expect(checkWin({ ...gs, turn: "black" })).toBeNull();
    expect(checkWin({ ...gs, turn: "white" })).toBeNull();
    const j = legalTurnSequences({ ...gs, dice: [1, 4] }, "black");
    expect(j.some(s => checkWin({ ...s.finalGs, turn: "black" })?.winType === "jan")).toBe(true);
    expect(j.some(s => !s.ends)).toBe(true);

    const bad = badButUnfinished();
    expect(checkWin({ ...bad, turn: "black" })).toBeNull();
    expect(checkWin({ ...bad, turn: "white" })).toBeNull();
    expect(janThreat(bad, "black", "white")).toBeLessThan(JAN_BONUS);
  });

  test("a hemspel reply scores below a bad but unfinished position", () => {
    const v = expectimax.opponentReplyValue(blackBearsOff(), "white", [1, 2]);
    expect(v).toBeLessThan(expectimax.evaluate(badButUnfinished(), "white"));
  });

  test("a jan reply scores below every non-ending reply and below a bad but unfinished position", () => {
    const gs = blackCanMakeJan();
    const dice = [1, 4];
    const v = expectimax.opponentReplyValue(gs, "white", dice.slice());
    const nonEnding = legalTurnSequences({ ...gs, dice }, "black").filter(s => !s.ends);
    const worstNonEnding = Math.min(...nonEnding.map(s => expectimax.evaluate(s.finalGs, "white")));
    expect(v).toBeLessThan(worstNonEnding);
    expect(v).toBeLessThan(expectimax.evaluate(badButUnfinished(), "white"));
  });

  test("losing by jan (4 points) is worse than losing by hemspel (1 point)", () => {
    const jan = expectimax.opponentReplyValue(blackCanMakeJan(), "white", [1, 4]);
    const hem = expectimax.opponentReplyValue(blackBearsOff(), "white", [1, 2]);
    expect(jan).toBeLessThan(hem);
  });

  test("the same holds with the colours swapped", () => {
    // Mirror: white's path pos p becomes black's path pos p and vice versa.
    const swap = ({ board, bar, off }) => ({
      board: board.map((_, i) => -board[(i + 12) % 24]),
      bar: { white: bar.black, black: bar.white },
      off: { white: off.black, black: off.white },
    });
    const hem = expectimax.opponentReplyValue(swap(blackBearsOff()), "black", [1, 2]);
    expect(hem).toBeLessThan(expectimax.evaluate(swap(badButUnfinished()), "black"));
    const jan = expectimax.opponentReplyValue(swap(blackCanMakeJan()), "black", [1, 4]);
    expect(jan).toBeLessThan(hem);
  });
});
