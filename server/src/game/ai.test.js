// ── AI sanity tests ──────────────────────────────────────────────────────────
// Grandmaster is the only AI opponent; tutorial rooms get random moves (#103).
// Verifies that:
//   1. The tutorial's random choice returns a legal move picked by Math.random.
//   2. Grandmaster returns a legal first move and doesn't throw on doubles.
//   3. Grandmaster falls back gracefully when there is only one legal move.
//   4. pickMove returns null when there are no legal moves.

import { jest } from "@jest/globals";
import { getLegalMoves, pathToIdx } from "./engine.js";
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

// ── 1. Tutorial: random legal move ───────────────────────────────────────────

test("random (tutorial) returns the legal move Math.random picks", async () => {
  const gs = emptyGs("white", [3, 5]);
  place(gs, "white", 5, 3);   // three white at path pos 5
  place(gs, "white", 10, 2);  // two white at path pos 10
  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBeGreaterThan(1);
  const spy = jest.spyOn(Math, "random");
  try {
    spy.mockReturnValue(0);
    expect(await pickMove(gs, "white", legal, "room1", { random: true })).toEqual(legal[0]);
    spy.mockReturnValue(0.999);
    expect(await pickMove(gs, "white", legal, "room1", { random: true })).toEqual(legal.at(-1));
  } finally {
    spy.mockRestore();
  }
});

// ── 2. Grandmaster returns a legal move on a normal roll ─────────────────────

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
  const move = await pickMove(gs, "white", legal, "room6");
  expect(legal).toContainEqual(move);
});

// ── 3. Grandmaster doesn't throw on doubles ───────────────────────────────────

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
    move = await pickMove(gs, "white", legal, "room7");
  }).not.toThrow();

  expect(legal).toContainEqual(move);
});

// ── 4. Grandmaster handles single legal move ──────────────────────────────────

test("Grandmaster falls back gracefully when only one legal move", async () => {
  // White has one checker at path pos 20, one die of 3; only legal move is to pos 23.
  const gs = emptyGs("white", [3]);
  place(gs, "white", 20, 1);
  const legal = getLegalMoves(gs, "white");
  expect(legal.length).toBe(1);

  const move = await pickMove(gs, "white", legal, "room8");
  expect(move).toEqual(legal[0]);
});

// ── 5. pickMove returns null when no legal moves ──────────────────────────────

test("pickMove returns null when legalMoves is empty", async () => {
  const gs = emptyGs("white", []);
  expect(await pickMove(gs, "white", [], "room9")).toBeNull();
  expect(await pickMove(gs, "white", [], "room9", { random: true })).toBeNull();
});
