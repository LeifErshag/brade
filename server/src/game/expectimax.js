// ── Expectimax search AI ("Grandmaster") for Bräde ─────────────────────────
// 2-ply expectimax with chance nodes for dice outcomes.
// Uses legalTurnSequences() from the engine for correct, cheap enumeration.
// Evaluates positions in path-space to match the Bräde geometry.

import {
  legalTurnSequences,
  idxToPath,
  pathToIdx,
  HUK_POS,
  Q1_LO, Q1_HI,
  pipsToBearOff,
  canBearOff,
} from "./engine.js";

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_OWN_CANDIDATES = 20;   // top-N pruning on our turn sequences
const MAX_OPP_CANDIDATES = 10;   // top-N pruning on opponent sequences
const SEARCH_TIMEOUT_MS  = 5000;

// All 21 distinct dice outcomes with probabilities
const DICE_OUTCOMES = [];
for (let d1 = 1; d1 <= 6; d1++) {
  for (let d2 = d1; d2 <= 6; d2++) {
    DICE_OUTCOMES.push({
      dice: d1 === d2 ? [d1, d1, d1, d1] : [d1, d2],
      prob: d1 === d2 ? 1 / 36 : 2 / 36,
    });
  }
}

// ── Turn plan cache ─────────────────────────────────────────────────────────

const turnPlanCache = new Map(); // roomId → { startMoveSeq, moves, nextIdx }

export function clearExpectimaxCache(roomId) {
  turnPlanCache.delete(roomId);
}

// ── Public entry point (called by ai.js pickMove) ───────────────────────────

export function getNextExpectimaxMove(gs, color, legalMoves, roomId) {
  // Check cache for an existing plan
  const cached = turnPlanCache.get(roomId);
  if (cached) {
    const expectedSeq = cached.startMoveSeq + cached.nextIdx;
    if (gs.moveSeq === expectedSeq && cached.nextIdx < cached.moves.length) {
      const move = cached.moves[cached.nextIdx];
      cached.nextIdx++;
      // Clean up if plan fully consumed
      if (cached.nextIdx >= cached.moves.length) turnPlanCache.delete(roomId);
      return move;
    }
    // Stale cache — discard
    turnPlanCache.delete(roomId);
  }

  // Compute the best full-turn sequence
  let bestMoves;
  try {
    bestMoves = computeBestTurnSequence(gs, color);
  } catch (err) {
    console.error("Grandmaster search error:", err.message);
    bestMoves = null;
  }

  if (!bestMoves || bestMoves.length === 0) {
    // Fallback: pick first legal move
    return legalMoves[0] ?? null;
  }

  // Cache the plan and return the first move
  turnPlanCache.set(roomId, {
    startMoveSeq: gs.moveSeq,
    moves: bestMoves,
    nextIdx: 1, // already returning index 0
  });

  return bestMoves[0];
}

// ── Evaluation function (path-space, Bräde-aware) ──────────────────────────
// Scores a position from `color`'s perspective. Higher = better.
//
// Factors:
//   1. Pip count advantage (path-space pip count)
//   2. Borne-off checkers
//   3. Bar penalty / reward
//   4. Made points (bands): extra weight on huk + opponent Q1
//   5. Prime bonus (consecutive bands ≥ 3)
//   6. Blot exposure (weighted by zone)
//   7. Bear-off readiness
//   8. Jan threat

function evaluate(gs, color) {
  const opp = color === "white" ? "black" : "white";
  let score = 0;

  // 1. Pip count advantage
  const myPips  = pipCount(gs, color);
  const oppPips = pipCount(gs, opp);
  score += (oppPips - myPips) * 1.0;

  // 2. Borne-off checkers
  score += gs.off[color] * 15;
  score -= gs.off[opp] * 15;

  // 3. Bar penalty / reward
  score -= gs.bar[color] * 25;
  score += gs.bar[opp] * 25;

  // 4. Made points (bands ≥ 2) — location-weighted
  score += countWeightedBands(gs, color, opp);
  score -= countWeightedBands(gs, opp, color);

  // 5. Prime bonus (consecutive bands)
  score += primeBonus(gs, color);
  score -= primeBonus(gs, opp);

  // 6. Blot exposure (weighted by zone in path-space)
  score -= countWeightedBlots(gs, color);
  score += countWeightedBlots(gs, opp) * 0.5;

  // 7. Bear-off readiness
  if (canBearOff(gs, color)) score += 30;

  // 8. Jan threat
  score += janThreat(gs, color, opp);

  return score;
}

// ── Evaluation helpers (all path-space) ─────────────────────────────────────

// Pip count in path-space:
//   each board checker at path pos p contributes (24 - p) pips.
//   bar contributes 25 pips each; off contributes 0.
function pipCount(gs, color) {
  let pips = 0;
  for (let idx = 0; idx < 24; idx++) {
    const n = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (n > 0) {
      const pos = idxToPath(color, idx);
      pips += pipsToBearOff(pos) * n;
    }
  }
  pips += gs.bar[color] * 25;
  return pips;
}

// Count made points (bands ≥ 2) weighted by strategic value:
//   - huk (own path pos 11) is the most valuable band
//   - own bands on OPPONENT's Q1 (opponent re-entry zone) block their entry
//   - any other band is still good
function countWeightedBands(gs, color, opp) {
  let score = 0;
  for (let idx = 0; idx < 24; idx++) {
    const n = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (n < 2) continue;

    const pos = idxToPath(color, idx);

    if (pos === HUK_POS) {
      // Huk is the key strategic point
      score += 20;
    } else {
      // Is this point in the OPPONENT's Q1 (i.e., opponent's re-entry zone)?
      // The opponent re-enters at their path pos 0-5 (idxToPath(opp, idx) gives pos in opp's frame).
      const posInOppFrame = idxToPath(opp, idx);
      if (posInOppFrame >= Q1_LO && posInOppFrame <= Q1_HI) {
        // Blocking opponent re-entry is very valuable (jan/sprängjan threat)
        score += 14;
      } else {
        score += 7;
      }
    }
  }
  return score;
}

// Prime bonus: longest consecutive run of own bands across board indices.
// We measure runs in path-space to correctly capture the strategic arc.
// Bonus for length ≥ 3; a run ≥ 5 in the opponent's Q1/Q2 is a jan weapon.
function primeBonus(gs, color) {
  // Build path-pos occupancy map
  const band = new Array(24).fill(false);
  for (let idx = 0; idx < 24; idx++) {
    const n = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (n >= 2) {
      const pos = idxToPath(color, idx);
      band[pos] = true;
    }
  }

  let longest = 0;
  let run = 0;
  // Check linearly — path positions don't wrap for a prime to be useful.
  for (let pos = 0; pos < 24; pos++) {
    if (band[pos]) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  if (longest < 3) return 0;
  // Base: (length - 2) * 20; extra weight if ≥ 5 (jan threat)
  return (longest - 2) * 20 + (longest >= 5 ? 40 : 0);
}

// Blot penalty weighted by zone (path-space):
//   deep in opponent's side (Q3/Q4 of opponent = Q1/Q2 of us in path space...
//   actually: blots in OUR path positions far from home are harder to rescue).
//   Zone mapping in color's path-space:
//     pos 0-5  (own Q1/home) — blot there means it can be hit on re-entry
//     pos 6-11 (Q2, includes huk) — moderate risk
//     pos 12-23 (Q3+Q4) — lower risk (moving toward home)
//   But a blot deep in path (low pos) is further from home and dangerous.
function countWeightedBlots(gs, color) {
  let penalty = 0;
  for (let idx = 0; idx < 24; idx++) {
    const n = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (n !== 1) continue; // only lone blots
    const pos = idxToPath(color, idx);
    // Closer to start = more dangerous
    if (pos <= 5) {
      penalty += 12; // in own Q1, can be hit by opponent coming through
    } else if (pos <= 11) {
      penalty += 8;
    } else if (pos <= 17) {
      penalty += 5;
    } else {
      penalty += 3; // in Q4 close to home, less dangerous
    }
  }
  return penalty;
}

// Jan threat: bonus when the opponent has checkers on the bar and our bands
// block enough of their Q1 entry points that bar[opp] > available.
function janThreat(gs, color, opp) {
  if (gs.bar[opp] === 0) return 0;

  // Count how many of the opponent's Q1 positions (pos 0-5 in opp's path)
  // are blocked by our bands (our checkers ≥ 2 at that board index).
  let blocked = 0;
  for (let pos = Q1_LO; pos <= Q1_HI; pos++) {
    const idx = pathToIdx(opp, pos);
    // "Our" count at that index
    const n = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (n >= 2) blocked++;
  }

  const available = 6 - blocked;
  if (gs.bar[opp] > available) {
    return 50 + (gs.bar[opp] - available) * 20;
  }
  if (blocked >= 4) return 30;
  return 0;
}

// ── Core search ─────────────────────────────────────────────────────────────
// Uses legalTurnSequences() from the engine for correct, cheap enumeration.
// The engine already applies all turn-level filters (maximal use, higher-die,
// min-reduction) — we just need to evaluate the finalGs of each sequence.

function computeBestTurnSequence(gs, color) {
  const startTime = Date.now();
  const opp = color === "white" ? "black" : "white";

  // Enumerate our legal turn sequences
  const mySequences = legalTurnSequences(gs, color);

  if (mySequences.length === 0) return null;
  if (mySequences.length === 1) return mySequences[0].moves;

  // 1-ply fast evaluation for top-N pruning
  for (const seq of mySequences) {
    // Build a full gs shape for evaluate (finalGs only has board/bar/off)
    seq._evalGs = { board: seq.finalGs.board, bar: seq.finalGs.bar, off: seq.finalGs.off };
    seq.score = evaluate(seq._evalGs, color);
  }
  mySequences.sort((a, b) => b.score - a.score);

  const candidates = mySequences.slice(0, MAX_OWN_CANDIDATES);

  // If time is already tight or only a few candidates, return 1-ply best
  if (Date.now() - startTime > SEARCH_TIMEOUT_MS * 0.8) {
    return candidates[0].moves;
  }

  // 2-ply expectimax: for each candidate, average opponent's best response
  let bestValue = -Infinity;
  let bestMoves = candidates[0].moves;

  for (const cand of candidates) {
    if (Date.now() - startTime > SEARCH_TIMEOUT_MS) break;

    let expectedValue = 0;

    for (const { dice, prob } of DICE_OUTCOMES) {
      // Set up opponent's state with this dice roll
      const oppGs = {
        board:   cand.finalGs.board.slice(),
        bar:     { white: cand.finalGs.bar.white, black: cand.finalGs.bar.black },
        off:     { white: cand.finalGs.off.white, black: cand.finalGs.off.black },
        dice:    dice.slice(),
        moveSeq: 0,
      };

      // Enumerate opponent's turn sequences via the engine
      const oppSequences = legalTurnSequences(oppGs, opp);

      if (oppSequences.length === 0) {
        // Opponent has no moves — evaluate our position as-is
        expectedValue += prob * evaluate(cand._evalGs, color);
        continue;
      }

      // Fast-evaluate opponent sequences — opponent minimizes our score
      let oppBest = Infinity;
      const limit = Math.min(oppSequences.length, MAX_OPP_CANDIDATES * 5);
      for (let i = 0; i < limit; i++) {
        const oSeq = oppSequences[i];
        const evalGs = { board: oSeq.finalGs.board, bar: oSeq.finalGs.bar, off: oSeq.finalGs.off };
        const s = evaluate(evalGs, color);
        if (s < oppBest) oppBest = s;
      }

      expectedValue += prob * oppBest;
    }

    if (expectedValue > bestValue) {
      bestValue = expectedValue;
      bestMoves = cand.moves;
    }
  }

  return bestMoves;
}
