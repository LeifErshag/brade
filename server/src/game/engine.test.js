import { initGame, rollDice, canBearOff, getLegalMoves, applyMove, checkWin } from "./engine.js";

// ── initGame ──────────────────────────────────────────────────────────────────

test("initGame sets up correct starting position", () => {
  const gs = initGame();
  expect(gs.board[23]).toBe(15);   // white: all on point 24
  expect(gs.board[0]).toBe(-15);   // black: all on point 1
  expect(gs.bar).toEqual({ white: 0, black: 0 });
  expect(gs.off).toEqual({ white: 0, black: 0 });
  expect(gs.turn).toBe("white");
  expect(gs.phase).toBe("rolling");
  expect(gs.board.reduce((a, b) => a + Math.abs(b), 0)).toBe(30);
});

// ── rollDice ──────────────────────────────────────────────────────────────────

test("rollDice returns 2 dice normally", () => {
  // Run many times to confirm non-doubles gives 2
  let saw2 = false;
  for (let i = 0; i < 200; i++) {
    const d = rollDice();
    expect(d.length === 2 || d.length === 4).toBe(true);
    if (d.length === 2) { saw2 = true; expect(d[0]).not.toBe(d[1]); }
    if (d.length === 4) { expect(new Set(d).size).toBe(1); }
    d.forEach(v => { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); });
  }
  expect(saw2).toBe(true);
});

// ── canBearOff ────────────────────────────────────────────────────────────────

test("canBearOff false when checkers outside home", () => {
  const gs = initGame();
  expect(canBearOff(gs, "white")).toBe(false);
  expect(canBearOff(gs, "black")).toBe(false);
});

test("canBearOff true when all white checkers in indices 0-5", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 0;
  gs.board[0]  = 3; gs.board[1] = 4; gs.board[2] = 4; gs.board[3] = 4;
  expect(canBearOff(gs, "white")).toBe(true);
});

test("canBearOff false when checker is on bar", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 15;
  gs.bar.white = 1;
  expect(canBearOff(gs, "white")).toBe(false);
});

// ── getLegalMoves ─────────────────────────────────────────────────────────────

test("getLegalMoves returns empty when dice is empty", () => {
  const gs = initGame();
  gs.dice = [];
  expect(getLegalMoves(gs, "white")).toEqual([]);
});

test("getLegalMoves from starting position with die [1]", () => {
  const gs = initGame();
  gs.dice = [1];
  const moves = getLegalMoves(gs, "white");
  // White at index 23, die=1 → to index 22 (empty, so closing restriction doesn't apply)
  expect(moves).toContainEqual({ from: 23, to: 22, die: 1 });
});

test("getLegalMoves bar has priority", () => {
  const gs = initGame();
  gs.board[23] = 14;
  gs.bar.white = 1;
  gs.dice = [1]; // white re-enters at 24-1 = index 23
  const moves = getLegalMoves(gs, "white");
  expect(moves.every(m => m.from === "bar")).toBe(true);
});

// White closing restriction: forbidden zone is indices 13-22 (pts 14-23, own Q1+Q2 except head/huk)
test("getLegalMoves white cannot close at indices 13-22 (own Q1+Q2)", () => {
  const gs = initGame();
  gs.board[23] = 13;
  gs.board[14] = 1;  // 1 white at index 14 (pt 15, in forbidden zone)
  gs.board[15] = 1;  // 1 white at index 15 — will try to move to 14
  gs.dice = [1];
  // White at idx 15, die=1 → idx 14; idx 14 already has 1 white → closing in forbidden zone → BLOCKED
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.from === 15 && m.to === 14)).toBeUndefined();
});

test("getLegalMoves white CAN close in own home (indices 0-12)", () => {
  const gs = initGame();
  gs.board[23] = 13;
  gs.board[5]  = 1;  // 1 white at index 5 (pt 6, own Q4 — allowed to close)
  gs.board[6]  = 1;  // white at idx 6, will try to move to 5
  gs.dice = [1];
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.from === 6 && m.to === 5)).toBeDefined();
});

// Black closing restriction: forbidden zone is indices 1-10 (pts 2-11, own Q1+Q2 except head/huk)
test("getLegalMoves black cannot close at indices 1-10 (own Q1+Q2)", () => {
  const gs = initGame();
  gs.board[0]  = -13;
  gs.board[9]  = -1;  // 1 black at index 9 (pt 10, in forbidden zone)
  gs.board[8]  = -1;  // black at idx 8, will move to 9
  gs.dice = [1];
  // Black at idx 8, die=1 → idx 9; idx 9 already has 1 black → closing in forbidden zone → BLOCKED
  const moves = getLegalMoves(gs, "black");
  expect(moves.find(m => m.from === 8 && m.to === 9)).toBeUndefined();
});

test("getLegalMoves black CAN close in own home (indices 12-23)", () => {
  const gs = initGame();
  gs.board[0]  = -13;
  gs.board[18] = -1;  // 1 black at index 18 (pt 19, own Q4 — allowed to close)
  gs.board[17] = -1;  // black at idx 17, will try to move to 18
  gs.dice = [1];
  const moves = getLegalMoves(gs, "black");
  expect(moves.find(m => m.from === 17 && m.to === 18)).toBeDefined();
});

test("getLegalMoves white can close HUK (idx 12 = pt 13) and HEAD (idx 23 = pt 24)", () => {
  const gs = initGame();
  gs.board[23] = 13;
  gs.board[12] = 1;  // 1 white at huk (idx 12, pt 13)
  gs.board[13] = 1;  // white at idx 13, will move to 12
  gs.dice = [1];
  const moves = getLegalMoves(gs, "white");
  // HUK (idx 12) is NOT in forbidden range [13..22] → allowed
  expect(moves.find(m => m.from === 13 && m.to === 12)).toBeDefined();
});

// Bar re-entry: cannot enter at own head if occupied
test("getLegalMoves bar: cannot re-enter at white head (idx 23) when own checker there", () => {
  const gs = initGame();
  gs.board[23] = 14;  // 14 white at head
  gs.bar.white = 1;
  gs.dice = [1];  // die=1 → would enter at idx 23 (head)
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.from === "bar" && m.to === 23)).toBeUndefined();
});

test("getLegalMoves bar: can re-enter at white head (idx 23) when it is empty", () => {
  const gs = initGame();
  gs.board[23] = 0;   // head is empty
  gs.board[22] = 14;
  gs.bar.white = 1;
  gs.dice = [1];  // die=1 → enters at idx 23 (empty head → ok)
  const moves = getLegalMoves(gs, "white");
  expect(moves.find(m => m.from === "bar" && m.to === 23)).toBeDefined();
});

test("getLegalMoves bar: cannot re-enter at black head (idx 0) when own checker there", () => {
  const gs = initGame();
  gs.board[0]  = -14;  // 14 black at head
  gs.bar.black = 1;
  gs.dice = [1];  // die=1 → would enter at idx 0 (head)
  const moves = getLegalMoves(gs, "black");
  expect(moves.find(m => m.from === "bar" && m.to === 0)).toBeUndefined();
});

test("getLegalMoves bear-off exact", () => {
  const gs = initGame();
  gs.board[23] = 0; gs.board[0] = 0;
  gs.board[5]  = 15;  // all white in home (exact die for idx 5 = 6)
  gs.dice = [6];
  const moves = getLegalMoves(gs, "white");
  expect(moves).toContainEqual({ from: 5, to: "off", die: 6 });
});

test("getLegalMoves bear-off overshoot allowed when no checker further back", () => {
  const gs = initGame();
  gs.board[23] = 0; gs.board[0] = 0;
  gs.board[3]  = 15;  // all white at idx 3, exact die = 4
  gs.dice = [6];
  const moves = getLegalMoves(gs, "white");
  // die=6 > exact=4, no checker at higher index → overshoot ok
  expect(moves).toContainEqual({ from: 3, to: "off", die: 6 });
});

test("getLegalMoves bear-off overshoot blocked when checker further back", () => {
  const gs = initGame();
  gs.board[23] = 0; gs.board[0] = 0;
  gs.board[3]  = 14;
  gs.board[4]  = 1;   // checker at idx 4 (further from edge for white)
  gs.dice = [6];
  const moves = getLegalMoves(gs, "white");
  // Cannot overshoot from idx 3 because idx 4 has a checker
  expect(moves.find(m => m.from === 3 && m.to === "off")).toBeUndefined();
  // Can bear off from idx 4 exactly (exact for idx4 = 5, die=6 > 5, overshoot, no checker at idx 5) → wait idx4 exact = 5
  // die=6 > 5, and no checker at idx 5 → allowed
  expect(moves).toContainEqual({ from: 4, to: "off", die: 6 });
});

// ── applyMove ─────────────────────────────────────────────────────────────────

test("applyMove moves checker on board", () => {
  const gs = initGame();
  gs.dice = [1];
  const { gs: newGs } = applyMove(gs, "white", 23, 22, 1);
  expect(newGs.board[23]).toBe(14);
  expect(newGs.board[22]).toBe(1);
  expect(newGs.dice).toEqual([]);
});

test("applyMove hits a blot", () => {
  const gs = initGame();
  gs.board[23] = 1;
  gs.board[22] = -1;  // black blot at 22
  gs.dice = [1];
  const { gs: newGs, hit } = applyMove(gs, "white", 23, 22, 1);
  expect(hit).toBe(true);
  expect(newGs.board[22]).toBe(1);    // white now there
  expect(newGs.bar.black).toBe(1);    // black hit to bar
});

test("applyMove bar re-entry", () => {
  const gs = initGame();
  gs.board[23] = 14;
  gs.bar.white = 1;
  gs.dice = [1]; // white enters at 24-1 = index 23
  const { gs: newGs } = applyMove(gs, "white", "bar", 23, 1);
  expect(newGs.bar.white).toBe(0);
  expect(newGs.board[23]).toBe(15);
});

test("applyMove bear-off", () => {
  const gs = initGame();
  gs.board[23] = 0; gs.board[0] = 0;
  gs.board[0]  = 15;
  gs.dice = [1];
  const { gs: newGs } = applyMove(gs, "white", 0, "off", 1);
  expect(newGs.off.white).toBe(1);
  expect(newGs.board[0]).toBe(14);
});

// ── checkWin ──────────────────────────────────────────────────────────────────

test("checkWin returns null mid-game", () => {
  expect(checkWin(initGame())).toBeNull();
});

test("checkWin detects normal white win", () => {
  const gs = initGame();
  gs.off.white = 15;
  gs.off.black = 5; // black has borne off some
  const result = checkWin(gs);
  expect(result?.winner).toBe("white");
  expect(result?.winType).toBe("normal");
  expect(result?.points).toBe(1);
});

test("checkWin detects gammon (opponent borne off 0)", () => {
  const gs = initGame();
  gs.board[23] = 0; gs.board[0] = 0;
  gs.off.white = 15;
  gs.off.black = 0;
  gs.board[5] = -15; // black not at start
  const result = checkWin(gs);
  expect(result?.winner).toBe("white");
  expect(result?.winType).toBe("gammon");
  expect(result?.points).toBe(2);
});

test("checkWin detects monk (all black still at start)", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.off.white = 15;
  gs.off.black = 0;
  gs.board[0] = -15; // all black still at their start
  const result = checkWin(gs);
  expect(result?.winner).toBe("white");
  expect(result?.winType).toBe("monk");
  expect(result?.points).toBe(3);
});

// ── checkWin — Jan ────────────────────────────────────────────────────────────
// Black's entry zone (Q1) = indices 0-5. White's entry zone = indices 18-23.

test("checkWin detects Jan: white just moved, black has more bar than accessible Q1 pts", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 0;
  // White closed 4 of black's 6 entry points (indices 0-3)
  gs.board[0]  = 2;
  gs.board[1]  = 2;
  gs.board[2]  = 2;
  gs.board[3]  = 2;
  // Indices 4 and 5 empty → 2 accessible
  gs.bar.black = 3;   // 3 > 2 → Jan
  gs.turn      = "white";
  const result = checkWin(gs);
  expect(result?.winner).toBe("white");
  expect(result?.winType).toBe("jan");
  expect(result?.points).toBe(4);
  expect(result?.monk).toBe(false);
});

test("checkWin no Jan when bar <= accessible", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 0;
  // White closed only 2 of black's entry points
  gs.board[0]  = 2;
  gs.board[1]  = 2;
  // Indices 2-5 accessible → 4 accessible
  gs.bar.black = 3;   // 3 <= 4 → no jan
  gs.turn      = "white";
  expect(checkWin(gs)).toBeNull();
});

test("checkWin: loser's own checker in Q1 counts as inaccessible (closing restriction)", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 0;
  // White closed 4 entry points
  gs.board[0]  = 2;
  gs.board[1]  = 2;
  gs.board[2]  = 2;
  gs.board[3]  = 2;
  gs.board[4]  = -1;  // black's own checker at idx 4 → cannot re-enter (closing restriction)
  // idx 5 empty → only 1 accessible
  gs.bar.black = 2;   // 2 > 1 → Jan
  gs.turn      = "white";
  const result = checkWin(gs);
  expect(result?.winner).toBe("white");
  expect(result?.winType).toBe("jan");
});

test("checkWin detects Jan: black just moved, white has more bar than accessible Q1 pts", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 0;
  // Black closed 5 of white's 6 entry points (indices 18-22)
  gs.board[18] = -2;
  gs.board[19] = -2;
  gs.board[20] = -2;
  gs.board[21] = -2;
  gs.board[22] = -2;
  // idx 23 empty → 1 accessible
  gs.bar.white = 2;   // 2 > 1 → Jan
  gs.turn      = "black";
  const result = checkWin(gs);
  expect(result?.winner).toBe("black");
  expect(result?.winType).toBe("jan");
  expect(result?.points).toBe(4);
});

test("checkWin no Jan when bar is empty", () => {
  const gs = initGame();
  gs.board[23] = 0;
  gs.board[0]  = 0;
  gs.board[0] = 2; gs.board[1] = 2; gs.board[2] = 2;
  gs.board[3] = 2; gs.board[4] = 2; gs.board[5] = 2;
  gs.bar.black = 0;   // bar empty → no Jan possible
  gs.turn      = "white";
  expect(checkWin(gs)).toBeNull();
});
