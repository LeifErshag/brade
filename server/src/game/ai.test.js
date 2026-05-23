// ── AI sanity tests ──────────────────────────────────────────────────────────
// Verifies that:
//   1. All difficulty levels always return a move from getLegalMoves.
//   2. Journeyman prefers a hit over a neutral move.
//   3. Journeyman prefers landing on the huk over advancing elsewhere.
//   4. Journeyman prefers bearing off when available.
//   5. Grandmaster returns a legal first move and doesn't throw on doubles.
//   6. Grandmaster falls back gracefully when there is only one legal move.

import { getLegalMoves, pathToIdx, HUK_POS } from "./engine.js";
import { pickMove } from "./ai.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function emptyGs(turn = "white", dice = []) {
  return {
    board:      new Array(24).fill(0),
    bar:        { white: 0, black: 0 },
    off:        { white: 0, black: 0 },
    turn,
    phase:      "moving",
    dice:       dice.slice(),
    rolledDice: dice.slice(),
    legalMoves: [],
    moveSeq:    0,
    firstMove:  false,
  };
}

function place(gs, color, pos, n) {
  const idx = pathToIdx(color, pos);
  gs.board[idx] = color === "white" ? n : -n;
  return gs;
}

// ── 1. pickMove always returns a move that is in getLegalMoves ───────────────

test("Beginner always returns a legal move", async () => {
  const gs = emptyGs("white", [3, 5]);
  place(gs, "white", 5, 3);   // three white at path pos 5
  place(gs, "white", 10, 2);  // two white at path pos 10
  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBeGreaterThan(0);
  const move = await pickMove(gs, "white", legal, "beginner", "room1");
  expect(legal).toContainEqual(move);
});

test("Journeyman always returns a legal move", async () => {
  const gs = emptyGs("black", [2, 4]);
  place(gs, "black", 4, 2);
  place(gs, "black", 8, 3);
  const legal = getLegalMoves(gs, "black");
  expect(legal.length).toBeGreaterThan(0);
  const move = await pickMove(gs, "black", legal, "journeyman", "room2");
  expect(legal).toContainEqual(move);
});

// ── 2. Journeyman prefers hitting an opponent blot ───────────────────────────

test("Journeyman prefers hitting an opponent blot", async () => {
  // White at path pos 10 (idx 10), black blot at path pos 13 (idx 13 for white).
  // White rolls a 3 — can either advance to pos 13 (hitting black blot) or elsewhere.
  const gs = emptyGs("white", [3]);
  place(gs, "white", 10, 1);    // white at pos 10 (idx 10)
  place(gs, "black", 11, 1);    // black blot at idx 11 (white's path pos 11 = huk)
  // Actually easier: white at pos 8, can reach pos 11 (huk) where black has a blot.
  // Let's build a cleaner fixture.
  const gs2 = emptyGs("white", [3]);
  place(gs2, "white", 8, 2);    // white band at path pos 8
  place(gs2, "white", 15, 1);   // white at path pos 15
  // Place a black blot at white path pos 11 (the huk).
  const hukIdx = pathToIdx("white", HUK_POS); // = 11
  gs2.board[hukIdx] = -1;       // black blot at huk

  const legal = getLegalMoves(gs2, "white");
  // There should be a move from pos 8 to pos 11 (hitting the blot)
  const hitMove = legal.find(m => m.to === hukIdx && gs2.board[hukIdx] === -1);
  expect(hitMove).toBeDefined();

  const chosen = await pickMove(gs2, "white", legal, "journeyman", "room3");
  // Journeyman should prefer hitting
  expect(chosen.to).toBe(hukIdx);
});

// ── 3. Journeyman prefers making the huk ────────────────────────────────────

test("Journeyman prefers completing the huk band over neutral advance", async () => {
  // White has a checker at path pos 8 (idx 8) and at path pos 5 (idx 5).
  // White rolls a 3. Moving from pos 8 to pos 11 (huk) completes a band (we place
  // one white there already). Moving from pos 5 to pos 8 is a neutral advance.
  const gs = emptyGs("white", [3]);
  place(gs, "white", 8, 1);    // white blot at pos 8
  place(gs, "white", 11, 1);   // white blot at huk (pos 11) — making a band is valuable
  place(gs, "white", 5, 1);    // another white at pos 5

  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBeGreaterThan(0);

  // The huk-completing move: from idx 8 to idx 11 (die=3), landing where we have 1 checker
  const hukIdx = pathToIdx("white", HUK_POS); // 11
  const hukMove = legal.find(m => m.from === 8 && m.to === hukIdx);
  expect(hukMove).toBeDefined();

  const chosen = await pickMove(gs, "white", legal, "journeyman", "room4");
  expect(chosen).toEqual(hukMove);
});

// ── 4. Journeyman prefers bearing off ────────────────────────────────────────

test("Journeyman prefers bearing off when all checkers in Q4", async () => {
  // White has all checkers in Q4 (path pos 18-23); can bear one off.
  // Rearmost = pos 18, needs pipsToBearOff(18) = 6. Die=6 → exact bear-off.
  const gs = emptyGs("white", [6]);
  // All 15 white in Q4
  place(gs, "white", 18, 3);
  place(gs, "white", 19, 3);
  place(gs, "white", 20, 3);
  place(gs, "white", 21, 3);
  place(gs, "white", 22, 3);
  const legal = getLegalMoves(gs, "white");
  const bearOff = legal.find(m => m.to === "off");
  expect(bearOff).toBeDefined();

  const chosen = await pickMove(gs, "white", legal, "journeyman", "room5");
  expect(chosen.to).toBe("off");
});

// ── 5. Grandmaster returns a legal move on a normal roll ─────────────────────

test("Grandmaster returns a move from getLegalMoves", async () => {
  // Simple mid-game position: white spread across the board, black at home.
  // White at path pos 6,11,16,21 (one checker each) + 11 at pos 0.
  // Dice [2, 4] → white has several legal moves.
  const gs = emptyGs("white", [2, 4]);
  place(gs, "white", 0, 11);
  place(gs, "white", 6, 1);
  place(gs, "white", 11, 1);
  place(gs, "white", 16, 1);
  place(gs, "white", 21, 1);
  place(gs, "black", 12, 15);  // black all at home (idx 12)
  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBeGreaterThan(0);
  const move = await pickMove(gs, "white", legal, "grandmaster", "room6");
  expect(legal).toContainEqual(move);
});

// ── 6. Grandmaster doesn't throw on doubles ───────────────────────────────────

test("Grandmaster handles doubles without throwing", async () => {
  const gs = emptyGs("white", [3, 3, 3, 3]);
  place(gs, "white", 8, 4);
  place(gs, "white", 14, 4);
  place(gs, "white", 20, 4);
  place(gs, "black", 12, 5);
  place(gs, "black", 18, 5);
  place(gs, "black", 22, 5);

  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBeGreaterThan(0);

  let move;
  await expect(async () => {
    move = await pickMove(gs, "white", legal, "grandmaster", "room7");
  }).not.toThrow();

  expect(legal).toContainEqual(move);
});

// ── 7. Grandmaster handles single legal move ──────────────────────────────────

test("Grandmaster falls back gracefully when only one legal move", async () => {
  // White has one checker at path pos 20, one die of 3; only legal move is to pos 23.
  const gs = emptyGs("white", [3]);
  place(gs, "white", 20, 1);
  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBe(1);

  const move = await pickMove(gs, "white", legal, "grandmaster", "room8");
  expect(move).toEqual(legal[0]);
});

// ── 8. pickMove returns null when no legal moves ──────────────────────────────

test("pickMove returns null when legalMoves is empty", async () => {
  const gs = emptyGs("white", []);
  const move = await pickMove(gs, "white", [], "journeyman", "room9");
  expect(move).toBeNull();
});

// ── 9. Journeyman: re-entering from bar is prioritized ───────────────────────

test("Journeyman re-enters from bar before making other moves", async () => {
  // White has 2 on bar, die=1 allows re-entry at pos 0 (home) — should always do that.
  const gs = emptyGs("white", [1]);
  gs.bar.white = 1;
  place(gs, "white", 10, 5);

  const legal = getLegalMoves(gs, "white");
  // Only legal move when on bar is re-entry
  const barMove = legal.find(m => m.from === "bar");
  expect(barMove).toBeDefined();

  const chosen = await pickMove(gs, "white", legal, "journeyman", "room10");
  expect(chosen.from).toBe("bar");
});
