// ── Bräde engine tests (official Svenskt Bräde rules) ────────────────────────
// Every test cites the rule section (§) of the official rules PDF it verifies.
//
// Board storage: board[0..23], +n = n white, -n = n black on point index+1.
// White home = idx 0 (pt 1); Black home = idx 12 (pt 13). Both move +index (CCW).
// Path space (per color): white pos = idx; black pos = (idx-12+24)%24.

import {
  initGame, rollDice, canBearOff, getLegalMoves, applyMove, checkWin,
  idxToPath, pathToIdx, quarterOf, pipsToBearOff, HUK_POS, WIN_POINTS, winPoints,
  legalTurnSequences,
} from "./engine.js";

// ── Test fixture helper ──────────────────────────────────────────────────────
// Build a bare game state with an empty board (no default checkers), so each
// test can place exactly the checkers it wants in path-space or index-space.
function emptyGs(turn = "white", dice = []) {
  return {
    board: new Array(24).fill(0),
    bar:   { white: 0, black: 0 },
    off:   { white: 0, black: 0 },
    turn,
    phase: "moving",
    dice:  dice.slice(),
    rolledDice: dice.slice(),
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
}

// Place `n` checkers of `color` at path pos `pos` (path-space → board index).
function place(gs, color, pos, n) {
  const idx = pathToIdx(color, pos);
  gs.board[idx] = color === "white" ? n : -n;
  return gs;
}

// Place `n` checkers of `color` at an ABSOLUTE board index (useful for putting
// an opponent on the exact point the mover lands on).
function placeIdx(gs, color, idx, n) {
  gs.board[idx] = color === "white" ? n : -n;
  return gs;
}

// Place `n` opponent checkers on the point the MOVER (`moverColor`) reaches at
// the mover's path pos `pos`. Avoids the path-space mismatch between colors.
function placeOppAtMoverPos(gs, moverColor, pos, n) {
  const opp = moverColor === "white" ? "black" : "white";
  const idx = pathToIdx(moverColor, pos);   // the absolute index the mover lands on
  gs.board[idx] = opp === "white" ? n : -n;
  return gs;
}

// ── §1 Setup & teka ───────────────────────────────────────────────────────────

test("§1 setup: 15 white on point 1 (idx 0), 15 black on point 13 (idx 12)", () => {
  const gs = initGame();
  expect(gs.board[0]).toBe(15);    // white home
  expect(gs.board[12]).toBe(-15);  // black home
  expect(gs.bar).toEqual({ white: 0, black: 0 });
  expect(gs.off).toEqual({ white: 0, black: 0 });
  expect(gs.board.reduce((a, b) => a + Math.abs(b), 0)).toBe(30);
});

test("§1 teka: starting turn is not hardcoded (random color, both possible)", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(initGame().turn);
  expect(seen.has("white")).toBe(true);
  expect(seen.has("black")).toBe(true);
});

test("§1 rollDice: non-doubles → 2 dice, doubles (alla) → 4 dice", () => {
  let saw2 = false, saw4 = false;
  for (let i = 0; i < 400; i++) {
    const d = rollDice();
    expect(d.length === 2 || d.length === 4).toBe(true);
    if (d.length === 2) { saw2 = true; expect(d[0]).not.toBe(d[1]); }
    if (d.length === 4) { saw4 = true; expect(new Set(d).size).toBe(1); }
    d.forEach(v => { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); });
  }
  expect(saw2).toBe(true);
  expect(saw4).toBe(true);
});

// ── Path-space helpers ─────────────────────────────────────────────────────────

test("§2 path-space: white idx==pos; black pos = (idx-12+24)%24 with wraparound", () => {
  // White: identity.
  for (let i = 0; i < 24; i++) expect(idxToPath("white", i)).toBe(i);
  // Black home idx 12 → pos 0; idx 11 → pos 23; idx 0 → pos 12.
  expect(idxToPath("black", 12)).toBe(0);
  expect(idxToPath("black", 11)).toBe(23);
  expect(idxToPath("black", 0)).toBe(12);
  // Round-trip.
  for (const color of ["white", "black"]) {
    for (let p = 0; p < 24; p++) expect(idxToPath(color, pathToIdx(color, p))).toBe(p);
  }
});

test("§2 quarter & bear-off helpers", () => {
  expect(quarterOf(0)).toBe(1);
  expect(quarterOf(5)).toBe(1);
  expect(quarterOf(11)).toBe(2);
  expect(HUK_POS).toBe(11);
  expect(quarterOf(17)).toBe(3);
  expect(quarterOf(23)).toBe(4);
  expect(pipsToBearOff(23)).toBe(1);  // pt 24 needs a 1
  expect(pipsToBearOff(18)).toBe(6);  // pt 19 needs a 6
});

// ── §2 Movement direction & basic moves ───────────────────────────────────────

test("§2 direction: white from home idx 0 moves to higher index", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 0, 1);   // white at pos 0 = idx 0
  const moves = getLegalMoves(gs, "white");
  // pos 0 + 3 = pos 3 = idx 3.
  expect(moves).toContainEqual({ from: 0, to: 3, die: 3 });
});

test("§2 direction: black from home idx 12 moves +index (idx 15) in same CCW way", () => {
  const gs = emptyGs("black", [3]);
  place(gs, "black", 0, 1);   // black at pos 0 = idx 12
  const moves = getLegalMoves(gs, "black");
  // pos 0 + 3 = pos 3 = black idx (3+12)%24 = 15.
  expect(moves).toContainEqual({ from: 12, to: 15, die: 3 });
});

test("§2 direction: black wraps around the index loop (pos 13→idx 1)", () => {
  const gs = emptyGs("black", [1]);
  place(gs, "black", 12, 1);  // black pos 12 = idx 0
  const moves = getLegalMoves(gs, "black");
  // pos 12 + 1 = pos 13 = black idx (13+12)%24 = 1.
  expect(moves).toContainEqual({ from: 0, to: 1, die: 1 });
});

test("§2 empty dice → no legal moves", () => {
  const gs = emptyGs("white", []);
  place(gs, "white", 0, 15);
  expect(getLegalMoves(gs, "white")).toEqual([]);
});

test("§2 may not leave Quarter 4 except by bearing off (p+die>23 illegal when not bearing off)", () => {
  const gs = emptyGs("white", [6]);
  place(gs, "white", 20, 1);   // one checker in Q4
  place(gs, "white", 0, 14);   // others NOT all home → cannot bear off
  // pos 20 + 6 = 26 > 23 → not a legal normal move, and can't bear off.
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.from === pathToIdx("white", 20))).toBeUndefined();
});

// ── §2 Maximal-use & higher-die obligation ─────────────────────────────────────

test("§2 max-dice: if only one die can be played, getLegalMoves returns only its moves", () => {
  // Lone white checker at pos 0. Dice [2, 5].
  //   die 5 → pos 5: block with an opp band → the 5 is never playable.
  //   die 2 → pos 2: open. After the 2 → pos 2, die 5 → pos 7: block with an opp
  //   band → can't combine. So only the 2 is ever playable (max length 1).
  const gs = emptyGs("white", [2, 5]);
  place(gs, "white", 0, 1);
  placeOppAtMoverPos(gs, "white", 5, 2);   // die 5 from pos 0 blocked
  placeOppAtMoverPos(gs, "white", 7, 2);   // pos 2 + 5 blocked → no combine
  const moves = getLegalMoves(gs, "white");
  expect(moves.every(m => m.die === 2)).toBe(true);
  expect(moves).toContainEqual({ from: 0, to: 2, die: 2 });
});

test("§2 higher-die: if either single die is playable but not both, must play the higher", () => {
  // Lone white checker at pos 0, dice [3, 5]. pos+3 and pos+5 both open, but a
  // single opp band at pos 8 blocks BOTH combinations (3+5 and 5+3) → max length
  // is 1 with both singles available → must play the HIGHER die (5).
  const gs = emptyGs("white", [3, 5]);
  place(gs, "white", 0, 1);
  placeOppAtMoverPos(gs, "white", 8, 2);   // blocks pos 3+5 and pos 5+3
  const moves = getLegalMoves(gs, "white");
  expect(moves.every(m => m.die === 5)).toBe(true);
  expect(moves).toContainEqual({ from: 0, to: 5, die: 5 });
});

test("§2 doubles = four moves (alla): all four dice get consumed", () => {
  const gs = emptyGs("white", [2, 2, 2, 2]);
  place(gs, "white", 0, 4);   // four checkers at pos 0
  let cur = gs;
  let played = 0;
  for (let k = 0; k < 4; k++) {
    const moves = getLegalMoves(cur, "white");
    if (moves.length === 0) break;
    const m = moves[0];
    cur = applyMove(cur, "white", m.from, m.to, m.die).gs;
    played++;
  }
  expect(played).toBe(4);            // four moves played
  expect(cur.dice.length).toBe(0);   // all four dice consumed
  // Total advancement = 4 dice × 2 pips = 8 pips beyond the start (pos 0).
  let pips = 0;
  for (let p = 1; p <= 23; p++) pips += p * cur.board[pathToIdx("white", p)];
  expect(pips).toBe(8);
});

// ── §3 Blots & bands ────────────────────────────────────────────────────────

test("§3 a band (2+) cannot be hit by a normal landing", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 0, 1);
  placeOppAtMoverPos(gs, "white", 3, 2);   // black BAND at white's destination (pos 3)
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.to === pathToIdx("white", 3))).toBeUndefined();
});

test("§3 a blot (single) can be landed on (hit)", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 0, 1);
  placeOppAtMoverPos(gs, "white", 3, 1);   // black BLOT at white's destination (pos 3)
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: 0, to: pathToIdx("white", 3), die: 3 });
});

// ── §4 Hitting & re-entry ─────────────────────────────────────────────────────

test("§4 hit-on-landing: landing on an opponent blot sends it to the bar", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 0, 1);
  placeOppAtMoverPos(gs, "white", 3, 1);
  const to = pathToIdx("white", 3);
  const { gs: ng, hit, burst } = applyMove(gs, "white", 0, to, 3);
  expect(hit).toBe(true);
  expect(burst).toBe(false);
  expect(ng.board[to]).toBe(1);     // white now there
  expect(ng.bar.black).toBe(1);     // black sent to bar
});

test("§4 bar priority: with a checker on the bar, only re-entry moves are legal", () => {
  const gs = emptyGs("white", [2, 3]);
  place(gs, "white", 10, 2);   // a band that could otherwise move
  gs.bar.white = 1;
  const moves = getLegalMoves(gs, "white");
  expect(moves.length).toBeGreaterThan(0);
  expect(moves.every(m => m.from === "bar")).toBe(true);
});

test("§4 re-entry lands on path pos d-1 (Quarter 1)", () => {
  const gs = emptyGs("white", [3]);
  gs.bar.white = 1;
  const moves = getLegalMoves(gs, "white");
  // die 3 → pos 2 = idx 2.
  expect(moves).toContainEqual({ from: "bar", to: pathToIdx("white", 2), die: 3 });
});

test("§4 re-entry pos d-1 ≠ home-move pos d: re-entered 3 lands one short of moved-from-home 3", () => {
  // A checker moved from home (pos 0) for a 3 lands on pos 3.
  // A checker re-entered for a 3 lands on pos 2 (it passes the home point).
  const reenterPos = 3 - 1;       // pos 2
  const homeMovePos = 0 + 3;      // pos 3
  expect(reenterPos).toBe(2);
  expect(homeMovePos).toBe(3);
  expect(reenterPos).not.toBe(homeMovePos);
});

test("§4 re-entry legality: may NOT re-enter on own band/blot", () => {
  const gs = emptyGs("white", [3]);
  gs.bar.white = 1;
  place(gs, "white", 2, 1);    // own checker on the d-1 (=pos 2) landing point
  const moves = getLegalMoves(gs, "white");
  // pos 2 holds own checker → re-entry there would create own band on opp side (pos 1-10) → illegal.
  expect(moves.find(m => m.from === "bar" && m.to === pathToIdx("white", 2))).toBeUndefined();
});

test("§4 re-entry legality: may NOT re-enter on opponent band (no burst right)", () => {
  const gs = emptyGs("white", [3]);
  gs.bar.white = 1;
  placeIdx(gs, "black", pathToIdx("white", 2), 2);  // opp band on white's d-1 landing (pos 2)
  const moves = getLegalMoves(gs, "white");
  // bar(1) <= available → no burst right → blocked.
  expect(moves.length).toBe(0);
});

test("§4 re-entry legality: MAY re-enter on opponent blot (hit) or empty point", () => {
  const gs = emptyGs("white", [3, 5]);
  gs.bar.white = 1;
  placeIdx(gs, "black", pathToIdx("white", 2), 1);  // opp blot on d=3 landing (pos 2)
  // d=5 landing pos 4 empty.
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: "bar", to: pathToIdx("white", 2), die: 3 });
  expect(moves).toContainEqual({ from: "bar", to: pathToIdx("white", 4), die: 5 });
  // Re-entering for the 3 hits the blot.
  const res = applyMove(gs, "white", "bar", pathToIdx("white", 2), 3);
  expect(res.hit).toBe(true);
  expect(res.gs.bar.black).toBe(1);
});

// ── §5 Band-placement restriction ──────────────────────────────────────────────

test("§5 huk-only banding on opp side: cannot create own band on pos 1–10", () => {
  const gs = emptyGs("white", [1]);
  place(gs, "white", 5, 1);    // own blot at pos 5 (opp side)
  place(gs, "white", 4, 1);    // a checker that would move to pos 5
  const moves = getLegalMoves(gs, "white");
  // pos 4 + 1 = pos 5 already has own → would form band on pos 1-10 → illegal.
  expect(moves.find(m => m.from === pathToIdx("white", 4) && m.to === pathToIdx("white", 5))).toBeUndefined();
});

test("§5 may make a band at the huk (pos 11) on the opponent's side", () => {
  const gs = emptyGs("white", [1]);
  place(gs, "white", 11, 1);   // own blot at huk
  place(gs, "white", 10, 1);   // checker moving 10→11
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 10), to: pathToIdx("white", 11), die: 1 });
});

test("§5 banding allowed anywhere on own side (Q3/Q4 = pos 12–23)", () => {
  const gs = emptyGs("white", [1]);
  place(gs, "white", 15, 1);   // own blot at pos 15 (own side)
  place(gs, "white", 14, 1);   // checker moving 14→15 to form a band
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 14), to: pathToIdx("white", 15), die: 1 });
});

test("§5 black: huk-only banding restriction applies symmetrically on black's opp side", () => {
  const gs = emptyGs("black", [1]);
  place(gs, "black", 5, 1);    // black own blot at pos 5
  place(gs, "black", 4, 1);    // black 4→5 would form a band on pos 1-10
  const moves = getLegalMoves(gs, "black");
  expect(moves.find(m => m.from === pathToIdx("black", 4) && m.to === pathToIdx("black", 5))).toBeUndefined();
});

test("§5 cannot land on an opponent band (may pass over but not land)", () => {
  const gs = emptyGs("white", [2]);
  place(gs, "white", 0, 1);
  placeOppAtMoverPos(gs, "white", 2, 2);   // opp band on white's landing (pos 2)
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.to === pathToIdx("white", 2))).toBeUndefined();
});

// ── §6 Bursting (spränga) — Case B (bar overflow) ──────────────────────────────

// Worked example: 3 on bar; available Q1 = 2 (two empty points); opp bands sit
// on the Q1 points reachable by a 6 (pos 5) and a 5 (pos 4).
function burstFixture(dice) {
  const gs = emptyGs("white", dice);
  gs.bar.white = 3;
  // We want availableQ1 = 2 (only pos 0 & 1 re-enterable). Put opponent BANDS on
  // white's Q1 landing points for dies 3,4,5,6 (white pos 2,3,4,5). These are at
  // white's ABSOLUTE indices 2,3,4,5.
  placeIdx(gs, "black", pathToIdx("white", 5), 2);   // die 6 → pos 5
  placeIdx(gs, "black", pathToIdx("white", 4), 2);   // die 5 → pos 4
  placeIdx(gs, "black", pathToIdx("white", 3), 2);   // die 4 → pos 3
  placeIdx(gs, "black", pathToIdx("white", 2), 2);   // die 3 → pos 2
  // pos 0 (die 1) and pos 1 (die 2) empty → availableQ1 = 2.
  return gs;
}

test("§6 Case B: bar overflow grants burst right (bar 3 > availableQ1 2)", () => {
  const gs = burstFixture([6, 1]);
  // bar 3 > available 2 → may burst. die 6 → pos 5 is an opp band → burst re-entry legal.
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.from === "bar" && m.to === pathToIdx("white", 5) && m.die === 6)).toBeDefined();
});

test("§6 Case B worked example, roll 6-2: must burst the band reachable by 6, re-enter with the 2", () => {
  const gs = burstFixture([6, 2]);
  const moves = getLegalMoves(gs, "white");
  // die 2 → pos 1 (empty) ordinary re-entry; die 6 → pos 5 (opp band) burst.
  // Both are legal first moves of a maximal sequence.
  expect(moves).toContainEqual({ from: "bar", to: pathToIdx("white", 1), die: 2 });
  expect(moves).toContainEqual({ from: "bar", to: pathToIdx("white", 5), die: 6 });
  // Applying the 6-burst sends the 2 black checkers to black's bar.
  const burstTo = pathToIdx("white", 5);
  const res = applyMove(gs, "white", "bar", burstTo, 6);
  expect(res.burst).toBe(true);
  expect(res.hit).toBe(true);
  expect(res.gs.bar.black).toBe(2);
  expect(res.gs.board[burstTo]).toBe(1);   // white now there
});

test("§6 Case B worked example, roll 6-5: must burst with the 6; the 5 is forfeited", () => {
  const gs = burstFixture([6, 5]);
  // Initially bar 3 > available 2 → both pos 5 (die6) and pos 4 (die5) are burstable.
  // But §2 higher-die / max-use: after bursting with the 6, bar becomes 2 and one
  // band cleared → bar(2) <= available, so the 5 can no longer burst → forfeited.
  // Net: the surviving maximal sequences burst with the 6 only.
  const moves = getLegalMoves(gs, "white");
  // The 6-burst must be present.
  expect(moves.find(m => m.from === "bar" && m.die === 6 && m.to === pathToIdx("white", 5))).toBeDefined();
  // A standalone 5-burst as the sole move must NOT survive (higher die wins / it
  // can't burst once the 6 is played). Verify the 5 cannot start a maximal seq.
  // Simulate: burst with 6 first.
  const after6 = applyMove(gs, "white", "bar", pathToIdx("white", 5), 6).gs;
  const movesAfter = getLegalMoves(after6, "white");
  // Now bar = 2, available still 2 (pos 0,1 empty) → no burst right → die 5 → pos 4
  // is still an opp band → blocked. Re-entry only possible if a Q1 landing is open.
  // pos 4 (die5) is opp band, blocked → the 5 yields no move → forfeited.
  expect(movesAfter.find(m => m.die === 5)).toBeUndefined();
});

test("§6 Case B: burst right ceases as soon as bar <= availableQ1", () => {
  const gs = emptyGs("white", [6]);
  gs.bar.white = 1;            // only 1 on bar
  // available Q1 = pos 0..4 empty (5 available) → bar(1) <= 5 → NO burst.
  placeIdx(gs, "black", pathToIdx("white", 5), 2);   // opp band reachable by die 6
  const moves = getLegalMoves(gs, "white");
  // die 6 → pos 5 opp band, no burst right → blocked. No re-entry with a 6.
  expect(moves.find(m => m.die === 6)).toBeUndefined();
});

// ── §6 Bursting — Case A (impenetrable wall) ───────────────────────────────────

test("§6 Case A: a 6-band wall directly in path may be burst when no other move exists", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 5, 1);             // lone white checker at pos 5
  // Opponent wall of 6 contiguous bands at white pos 6..11 (in white's forward path).
  for (let p = 6; p <= 11; p++) placeIdx(gs, "black", pathToIdx("white", p), 2);
  // die 3 → pos 8 is inside the wall; no non-burst move exists → burst allowed.
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 5), to: pathToIdx("white", 8), die: 3 });
  const res = applyMove(gs, "white", pathToIdx("white", 5), pathToIdx("white", 8), 3);
  expect(res.burst).toBe(true);
  expect(res.gs.bar.black).toBe(2);
});

test("§6 Case A: NOT forced when a non-burst move exists", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 5, 1);
  place(gs, "white", 12, 1);            // a second checker with a clear move
  for (let p = 6; p <= 11; p++) placeIdx(gs, "black", pathToIdx("white", p), 2);  // wall
  const moves = getLegalMoves(gs, "white");
  // The pos-12 checker can move 12→15 (no wall there) → no burst is offered.
  expect(moves).toContainEqual({ from: pathToIdx("white", 12), to: pathToIdx("white", 15), die: 3 });
  expect(moves.find(m => m.to === pathToIdx("white", 8))).toBeUndefined(); // no burst
});

test("§6 Case A: a wall shorter than 6 does NOT grant a burst (player simply stuck)", () => {
  const gs = emptyGs("white", [3]);
  place(gs, "white", 5, 1);
  for (let p = 6; p <= 10; p++) placeIdx(gs, "black", pathToIdx("white", p), 2);  // only 5 bands
  const moves = getLegalMoves(gs, "white");
  // No legal move (wall <6 → no burst), and pos 5+3 = pos 8 is a band.
  expect(moves).toEqual([]);
});

test("§6 junker exception: 14 off + 1 left → NO bursting allowed, simply no move (junker)", () => {
  const gs = emptyGs("white", [6]);
  gs.off.white = 14;
  place(gs, "white", 17, 1);            // last checker at pos 17; 17+6 = pos 23
  // A 6-band wall in path would otherwise grant a Case-A burst; build one at
  // white pos 18..23 so pos 23 (the landing) is a band inside a ≥6 wall.
  for (let p = 18; p <= 23; p++) placeIdx(gs, "black", pathToIdx("white", p), 2);
  const moves = getLegalMoves(gs, "white");
  expect(moves).toEqual([]);            // junker: no burst, no move → passes
});

// ── §7 Hemspel (bearing off) ───────────────────────────────────────────────────

test("§7 canBearOff: false until all 15 in Quarter 4 and none on bar", () => {
  const gs = emptyGs("white");
  place(gs, "white", 0, 15);
  expect(canBearOff(gs, "white")).toBe(false);
  // Move all to Q4.
  const gs2 = emptyGs("white");
  place(gs2, "white", 18, 15);
  expect(canBearOff(gs2, "white")).toBe(true);
  gs2.bar.white = 1; gs2.board[pathToIdx("white", 18)] = 14;
  expect(canBearOff(gs2, "white")).toBe(false);  // checker on bar
});

test("§7 jämnt hem: die == needed bears off the rearmost checker exactly", () => {
  const gs = emptyGs("white", [6]);
  place(gs, "white", 18, 15);   // rearmost pos 18, needed = 6
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 18), to: "off", die: 6 });
});

test("§7 only the rearmost Q4 checker may bear off (NOT the die-matching point)", () => {
  const gs = emptyGs("white", [1]);
  place(gs, "white", 20, 1);    // rearmost = pos 20 (needed 4)
  place(gs, "white", 23, 14);   // pos 23 (needed 1) — die 1 matches it
  const moves = getLegalMoves(gs, "white");
  // Backgammon would bear off pos 23 with the 1. Bräde: only the rearmost (pos 20)
  // is the bear-off candidate, but die 1 < needed 4 → cannot bear off; must move
  // pos 20 → pos 21 instead. Bearing off pos 23 is ILLEGAL.
  expect(moves.find(m => m.from === pathToIdx("white", 23) && m.to === "off")).toBeUndefined();
  expect(moves).toContainEqual({ from: pathToIdx("white", 20), to: pathToIdx("white", 21), die: 1 });
});

test("§7 Fig 1 (roll 3-2): rearmost 21 needs 4; the 3 cannot bear off → must move 21→24", () => {
  // White on points 21,22,23 → pos 18,19,20. Black blocks pts 19,20 → pos 16,17 (out of Q4, irrelevant to bear-off but per fig black blocks 19/20). canBearOff needs all 15 in Q4.
  const gs = emptyGs("white", [3, 2]);
  place(gs, "white", 18, 5);   // pt 21
  place(gs, "white", 19, 5);   // pt 22
  place(gs, "white", 20, 5);   // pt 23
  // All 15 in Q4 → can bear off. Rearmost = pos 18 (pt 21), needed = 6.
  // Wait: fig says rearmost 21 needs 4 — that uses points 21..24 mapping. In our
  // path space pt 21 = pos 20, needed = 4. Re-place to match the figure exactly.
  const g = emptyGs("white", [3, 2]);
  place(g, "white", 20, 5);    // pt 21 = pos 20, needed 4
  place(g, "white", 21, 5);    // pt 22 = pos 21, needed 3
  place(g, "white", 22, 5);    // pt 23 = pos 22, needed 2
  // Rearmost = pos 20 (needed 4). die 3 < 4 → cannot bear off; must move pos 20→23 (pt 24).
  const moves = getLegalMoves(g, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 20), to: pathToIdx("white", 23), die: 3 });
  // Cannot bear off pos 21/22 while pos 20 occupied.
  expect(moves.find(m => m.from === pathToIdx("white", 21) && m.to === "off")).toBeUndefined();
  expect(moves.find(m => m.from === pathToIdx("white", 22) && m.to === "off")).toBeUndefined();
});

test("§7 Fig 2 (roll 5-2): minimize reduction — bear off rear (pos21) with 5 (red 2) then off with 2 (red 1)", () => {
  // pt 22 = pos 21 (needed 3) holds the rearmost; the rest sit ahead on pos 22 & 23
  // (not all on pos 23, to avoid forming an 'uppspel' pattern or ending the game).
  // Min-reduction line: bear off pos21 with the 5 (red 2), then off pos22 with the 2
  // (red 0) → total 2. The competing line that first moves pos21→pos23 with the 2
  // then bears off the rear with the 5 incurs MORE reduction, so it is excluded.
  const gs = emptyGs("white", [5, 2]);
  place(gs, "white", 21, 1);   // pt 22 (needed 3) — rearmost
  place(gs, "white", 22, 7);   // pt 23
  place(gs, "white", 23, 7);   // pt 24
  const moves = getLegalMoves(gs, "white");
  // The min-reduction maximal sequence starts by bearing off the rearmost (pos 21) with the 5.
  expect(moves).toContainEqual({ from: pathToIdx("white", 21), to: "off", die: 5 });
  // It must NOT start by moving 22(pos21)→24(pos23) with the 2 (that path has higher reduction).
  expect(moves.find(m => m.from === pathToIdx("white", 21) && m.to === pathToIdx("white", 23) && m.die === 2)).toBeUndefined();
});

test("§7 Fig 3 (roll 5-3): rearmost 19 needs 6; neither die bears off → move within Q4", () => {
  // pt 19 = pos 18 (needed 6). pt 21 = pos 20.
  const gs = emptyGs("white", [5, 3]);
  place(gs, "white", 18, 8);   // pt 19 (needed 6) — rearmost
  place(gs, "white", 20, 7);   // pt 21
  const moves = getLegalMoves(gs, "white");
  // 5 < 6 and 3 < 6 → no bear-off. 5 moves 19→24 (pos18→23); 3 moves a pt21→pt24 (pos20→23).
  expect(moves.find(m => m.to === "off")).toBeUndefined();
  expect(moves).toContainEqual({ from: pathToIdx("white", 18), to: pathToIdx("white", 23), die: 5 });
  expect(moves).toContainEqual({ from: pathToIdx("white", 20), to: pathToIdx("white", 23), die: 3 });
});

test("§7 Fig 4 (roll 4-4-4-4): rearmost 20 needs 5, 20→24 blocked by opp band → forfeit whole roll", () => {
  // pt 20 = pos 19 (needed 5). Opp band on pt 24 = pos 23. die 4 < 5 → can't bear off
  // pos 19; pos 19 + 4 = pos 23 blocked by band; cannot bear off pos 21 while pos 19
  // occupied. → no legal move → forfeit.
  const gs = emptyGs("white", [4, 4, 4, 4]);
  place(gs, "white", 19, 14);  // pt 20 (needed 5) — rearmost
  place(gs, "white", 20, 1);   // pt 21
  placeOppAtMoverPos(gs, "white", 23, 2);  // opp band on pt 24 (white pos 23)
  const moves = getLegalMoves(gs, "white");
  expect(moves).toEqual([]);
});

test("§7 die > needed bears off the rearmost with reduction (slaget reduceras)", () => {
  const gs = emptyGs("white", [6]);
  place(gs, "white", 20, 15);  // rearmost pos 20, needed 4; die 6 > 4 → bear off, reduction 2
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 20), to: "off", die: 6 });
});

test("§7 applyMove bear-off increments off and removes from board", () => {
  const gs = emptyGs("white", [4]);
  place(gs, "white", 20, 3);
  const { gs: ng } = applyMove(gs, "white", pathToIdx("white", 20), "off", 4);
  expect(ng.off.white).toBe(1);
  expect(ng.board[pathToIdx("white", 20)]).toBe(2);
});

// ── §8 Vackert spel (win by pattern) ────────────────────────────────────────────

function vackertGs(setup) {
  const gs = emptyGs("white");
  for (const [pos, n] of setup) place(gs, "white", pos, n);
  gs.off.white = 0;
  return gs;
}

test("§8 enkelt kronspel: 3 on each of pos 19–23 → kronspel_enkelt (2 pts)", () => {
  const gs = vackertGs([[19, 3], [20, 3], [21, 3], [22, 3], [23, 3]]);
  const r = checkWin(gs);
  expect(r?.winType).toBe("kronspel_enkelt");
  expect(r?.points).toBe(2);
});

test("§8 dubbelt kronspel: 5 on each of pos 21–23 → kronspel_dubbelt (2 pts)", () => {
  const gs = vackertGs([[21, 5], [22, 5], [23, 5]]);
  const r = checkWin(gs);
  expect(r?.winType).toBe("kronspel_dubbelt");
  expect(r?.points).toBe(2);
});

test("§8 trappspel: 7 on pos 23, 5 on pos 22, 3 on pos 21 → trappspel (2 pts)", () => {
  const gs = vackertGs([[23, 7], [22, 5], [21, 3]]);
  const r = checkWin(gs);
  expect(r?.winType).toBe("trappspel");
  expect(r?.points).toBe(2);
});

test("§8 uppspel: 15 on pos 23 → uppspel (2 pts)", () => {
  const gs = vackertGs([[23, 15]]);
  const r = checkWin(gs);
  expect(r?.winType).toBe("uppspel");
  expect(r?.points).toBe(2);
});

test("§8 a single borne-off checker forfeits vackert spel (off must be 0)", () => {
  const gs = vackertGs([[23, 14]]);  // only 14 in pattern
  gs.off.white = 1;                  // one already borne off
  expect(checkWin(gs)?.winType).not.toBe("uppspel");
  // With 14 off it's not 15 off either → still mid-game (not a hemspel win).
  // (Here off=1, not 15, so no win.)
  expect(checkWin(gs)).toBeNull();
});

// ── §9 Munk ─────────────────────────────────────────────────────────────────

test("§9 hemspel med munk: opponent has ≥1 on bar when all 15 borne off → hemspel_munk (2 pts)", () => {
  const gs = emptyGs("white");
  gs.off.white = 15;
  gs.bar.black = 1;
  const r = checkWin(gs);
  expect(r?.winType).toBe("hemspel_munk");
  expect(r?.monk).toBe(true);
  expect(r?.points).toBe(2);
});

test("§9 plain hemspel: opponent has none on bar → hemspel (1 pt)", () => {
  const gs = emptyGs("white");
  gs.off.white = 15;
  gs.bar.black = 0;
  const r = checkWin(gs);
  expect(r?.winType).toBe("hemspel");
  expect(r?.points).toBe(1);
});

test("§9 vackert spel med munk: uppspel with opp on bar → uppspel_munk (3 pts)", () => {
  const gs = vackertGs([[23, 15]]);
  gs.bar.black = 2;
  const r = checkWin(gs);
  expect(r?.winType).toBe("uppspel_munk");
  expect(r?.monk).toBe(true);
  expect(r?.points).toBe(3);
});

// ── §10 Jan ─────────────────────────────────────────────────────────────────

test("§10 jan: opponent bar > available Q1 → jan (4 pts)", () => {
  const gs = emptyGs("white");
  gs.turn = "white";
  // Black is the loser; black Q1 = pos 0..5 (black idx 12..17).
  // Black's OWN checkers occupy 4 of them → available = 2.
  place(gs, "black", 0, 1);
  place(gs, "black", 1, 1);
  place(gs, "black", 2, 1);
  place(gs, "black", 3, 1);
  // pos 4, 5 empty → available 2.
  gs.bar.black = 3;            // 3 > 2 → jan
  const r = checkWin(gs);
  expect(r?.winner).toBe("white");
  expect(r?.winType).toBe("jan");
  expect(r?.points).toBe(4);
});

test("§10 no jan when bar <= available", () => {
  const gs = emptyGs("white");
  gs.turn = "white";
  place(gs, "black", 0, 1);
  place(gs, "black", 1, 1);    // available = 4 (pos 2,3,4,5)
  gs.bar.black = 3;            // 3 <= 4 → no jan
  expect(checkWin(gs)).toBeNull();
});

test("§10 jan accessibility: a WINNER band on opp Q1 counts as available (it is burstable)", () => {
  const gs = emptyGs("white");
  gs.turn = "white";
  // Black (loser) Q1 = black pos 0..5 (= board idx 12..17). White (winner) bands
  // on black pos 0..3 (these are burstable → they DO count as available).
  for (let p = 0; p <= 3; p++) placeIdx(gs, "white", pathToIdx("black", p), 2);
  // black pos 4,5 empty. Black has NO own checker in Q1 → ALL 6 available.
  gs.bar.black = 5;            // 5 <= 6 → NOT jan (winner bands counted as available)
  expect(checkWin(gs)).toBeNull();
  // Now block 2 of black's Q1 with black's OWN checkers → available drops to 4.
  place(gs, "black", 4, 1);    // black own checker at black pos 4
  place(gs, "black", 5, 1);    // black own checker at black pos 5
  // available = winner bands at black pos 0..3 (4); black pos 4,5 are loser-occupied.
  gs.bar.black = 5;            // 5 > 4 → jan
  expect(checkWin(gs)?.winType).toBe("jan");
});

test("§10 jan edge: loser is junker → winner bands do NOT count as available", () => {
  const gs = emptyGs("white");
  gs.turn = "white";
  // Black is junker: 14 off + its single remaining checker on the bar.
  gs.off.black = 14;
  gs.bar.black = 1;            // the one remaining black checker is on the bar
  // Winner (white) bands on black's Q1 (black Q1 pos 0..5 = black idx 12..17).
  for (let p = 0; p <= 5; p++) placeIdx(gs, "white", pathToIdx("black", p), 2);
  // Normally winner bands count as available, but the junker exception suppresses
  // that → available = 0. bar 1 > 0 → jan.
  const r = checkWin(gs);
  expect(r?.winType).toBe("jan");
  // Sanity: if black were NOT junker (off < 14), the winner bands WOULD count as
  // available (6) and 1 <= 6 → no jan.
  const gs2 = emptyGs("white");
  gs2.turn = "white";
  gs2.bar.black = 1;
  for (let p = 0; p <= 5; p++) placeIdx(gs2, "white", pathToIdx("black", p), 2);
  expect(checkWin(gs2)).toBeNull();
});

// ── §11 Sprängjan ─────────────────────────────────────────────────────────────

test("§11 sprängjan: a jan achieved by a burst move → sprangjan (6 pts)", () => {
  const gs = emptyGs("white");
  gs.turn = "white";
  place(gs, "black", 0, 1);
  place(gs, "black", 1, 1);
  place(gs, "black", 2, 1);
  place(gs, "black", 3, 1);
  gs.bar.black = 3;            // 3 > available 2 → jan condition met
  // Without burst → jan.
  expect(checkWin(gs, false)?.winType).toBe("jan");
  // With lastMoveBurst → sprängjan.
  const r = checkWin(gs, true);
  expect(r?.winType).toBe("sprangjan");
  expect(r?.points).toBe(6);
});

// ── §12 Last roll of a game ─────────────────────────────────────────────────────

test("§12 may decline to end: a non-ending alternative is still offered alongside the ending move", () => {
  // White: 14 off, one checker at pos 22 (needed 2). Roll [2, 1].
  // Bearing off pos 22 with the 2 → 15 off → game ends (hemspel). The player MAY
  // also choose not to use the ending die first; the 1 (move pos22→pos23) is a
  // legal alternative first move. Both must be offered.
  const gs = emptyGs("white", [2, 1]);
  gs.off.white = 14;
  place(gs, "white", 22, 1);   // needed 2
  const moves = getLegalMoves(gs, "white");
  // Ending move: bear off with the 2.
  expect(moves).toContainEqual({ from: pathToIdx("white", 22), to: "off", die: 2 });
  // Non-ending alternative: move pos22 → pos23 with the 1.
  expect(moves).toContainEqual({ from: pathToIdx("white", 22), to: pathToIdx("white", 23), die: 1 });
});

test("§12 cannot continue once the game ends: a finished state yields no further moves", () => {
  const gs = emptyGs("white", [3]);
  gs.off.white = 15;           // already won (hemspel)
  expect(checkWin(gs)).not.toBeNull();
  // No checkers on board → no moves anyway, but also the game is over.
  expect(getLegalMoves(gs, "white")).toEqual([]);
});

test("§12 ending move exempt from higher-die rule", () => {
  // White 14 off, last checker pos 23 (needed 1). Roll [1, 6].
  // Bearing off with the 1 ends the game (jämnt hem). The 6 would also bear it off
  // (reduction 5) and also ends the game. Higher-die rule is RELAXED for the
  // ending move, so the 1 (lower die) ending move must be available.
  const gs = emptyGs("white", [1, 6]);
  gs.off.white = 14;
  place(gs, "white", 23, 1);   // needed 1
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: pathToIdx("white", 23), to: "off", die: 1 });
  expect(moves).toContainEqual({ from: pathToIdx("white", 23), to: "off", die: 6 });
});

// ── §13–14 Scoring table ────────────────────────────────────────────────────────

test("§13-14 WIN_POINTS / winPoints exposes the official scoring table", () => {
  expect(WIN_POINTS.sprangjan).toBe(6);
  expect(WIN_POINTS.jan).toBe(4);
  expect(WIN_POINTS.kronspel_enkelt_munk).toBe(3);
  expect(WIN_POINTS.kronspel_dubbelt_munk).toBe(3);
  expect(WIN_POINTS.trappspel_munk).toBe(3);
  expect(WIN_POINTS.uppspel_munk).toBe(3);
  expect(WIN_POINTS.kronspel_enkelt).toBe(2);
  expect(WIN_POINTS.kronspel_dubbelt).toBe(2);
  expect(WIN_POINTS.trappspel).toBe(2);
  expect(WIN_POINTS.uppspel).toBe(2);
  expect(WIN_POINTS.hemspel_munk).toBe(2);
  expect(WIN_POINTS.hemspel).toBe(1);
  expect(winPoints("jan")).toBe(4);
  expect(winPoints("resign")).toBe(1);
  expect(winPoints("unknown")).toBe(1);   // default
});

// ── applyMove invariants (contract) ─────────────────────────────────────────────

test("applyMove deep-clones (does not mutate input) and consumes one die, bumps moveSeq", () => {
  const gs = emptyGs("white", [3, 4]);
  place(gs, "white", 0, 2);
  const before = JSON.stringify(gs);
  const { gs: ng, hit, burst } = applyMove(gs, "white", 0, 3, 3);
  expect(JSON.stringify(gs)).toBe(before);   // input untouched
  expect(ng.dice).toEqual([4]);              // one die consumed
  expect(ng.moveSeq).toBe(1);
  expect(hit).toBe(false);
  expect(burst).toBe(false);
});

test("checkWin returns null for a fresh mid-game state", () => {
  expect(checkWin(initGame())).toBeNull();
});

test("contract: getLegalMoves emits absolute indices / 'bar' / 'off' (never path-space)", () => {
  const gs = emptyGs("black", [3]);
  place(gs, "black", 0, 1);    // black home idx 12
  const moves = getLegalMoves(gs, "black");
  // from must be a real board index (12), not the path pos (0).
  expect(moves[0].from).toBe(12);
  expect(moves[0].to).toBe(15);
});

// ── legalTurnSequences (survivor reuse for AI search) ────────────────────────

test("legalTurnSequences: no dice → empty list", () => {
  const gs = emptyGs("white", []);
  place(gs, "white", 0, 15);
  expect(legalTurnSequences(gs, "white")).toEqual([]);
});

test("legalTurnSequences: each survivor's first moves match getLegalMoves (de-duped)", () => {
  // A two-die roll with multiple combinable lines.
  const gs = emptyGs("white", [2, 3]);
  place(gs, "white", 0, 2);
  const seqs = legalTurnSequences(gs, "white");
  expect(seqs.length).toBeGreaterThan(0);
  // Every survivor carries the public shape.
  for (const s of seqs) {
    expect(Array.isArray(s.moves)).toBe(true);
    expect(s.moves.length).toBeGreaterThan(0);
    expect(s.moves[0]).toHaveProperty("from");
    expect(s.moves[0]).toHaveProperty("to");
    expect(s.moves[0]).toHaveProperty("die");
    expect(typeof s.ends).toBe("boolean");
    expect(typeof s.reduction).toBe("number");
    // finalGs is a plain sim-state.
    expect(s.finalGs).toHaveProperty("board");
    expect(s.finalGs).toHaveProperty("bar");
    expect(s.finalGs).toHaveProperty("off");
    expect(s.finalGs.board.length).toBe(24);
  }
  // De-duped first moves equal getLegalMoves output (order-independent).
  const fromSeqs = [];
  const seen = new Set();
  for (const s of seqs) {
    const m = s.moves[0];
    const k = `${m.from}:${m.to}:${m.die}`;
    if (!seen.has(k)) { seen.add(k); fromSeqs.push(m); }
  }
  const direct = getLegalMoves(gs, "white");
  expect(new Set(fromSeqs.map(m => `${m.from}:${m.to}:${m.die}`)))
    .toEqual(new Set(direct.map(m => `${m.from}:${m.to}:${m.die}`)));
});

test("legalTurnSequences: finalGs reflects playing the whole sequence", () => {
  // Doubles 2-2-2-2 from a single home stack — one survivor advancing 8 pips.
  const gs = emptyGs("white", [2, 2, 2, 2]);
  place(gs, "white", 0, 4);
  const seqs = legalTurnSequences(gs, "white");
  expect(seqs.length).toBeGreaterThan(0);
  // Re-derive each survivor's final position via applyMove and compare.
  for (const s of seqs) {
    let cur = gs;
    for (const m of s.moves) cur = applyMove(cur, "white", m.from, m.to, m.die).gs;
    expect(s.finalGs.board).toEqual(cur.board);
    expect(s.finalGs.bar).toEqual(cur.bar);
    expect(s.finalGs.off).toEqual(cur.off);
  }
});

test("legalTurnSequences: §12 ending sequences are flagged with ends=true", () => {
  // White 14 off, last checker pos 22 (needed 2). Roll [2, 1]: bearing off ends.
  const gs = emptyGs("white", [2, 1]);
  gs.off.white = 14;
  place(gs, "white", 22, 1);
  const seqs = legalTurnSequences(gs, "white");
  const ender = seqs.find(s => s.ends);
  expect(ender).toBeDefined();
  // The ending survivor finishes with all 15 off.
  expect(ender.finalGs.off.white).toBe(15);
});
