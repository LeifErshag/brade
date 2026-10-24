// ── AI opponent move selection ─────────────────────────────────────────────────
// The only AI opponent is Grandmaster, the expectimax search in expectimax.js
// (#103), which runs in a worker thread (#106). The tutorial alone plays
// random legal moves, so the learner usually wins and gets to see the
// bearing-off and scoring explanations.

import { getNextExpectimaxMoveOffThread } from "./expectimax.js";

export const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
export const AI_DISPLAY  = { display_name: "Computer", avatar_url: null };

// ── Public entry point ────────────────────────────────────────────────────────

// `random` is set for tutorial rooms only.
export async function pickMove(gs, color, legalMoves, roomId, { random = false } = {}) {
  if (legalMoves.length === 0) return null;
  if (random) return pickMoveRandom(legalMoves);
  return getNextExpectimaxMoveOffThread(gs, color, legalMoves, roomId);
}

// ── Tutorial: random ──────────────────────────────────────────────────────────

function pickMoveRandom(legalMoves) {
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}
