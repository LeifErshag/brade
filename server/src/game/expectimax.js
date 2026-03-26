// ── Expectimax search AI ("Grandmaster") for Bräde ─────────────────────────
// 2-ply expectimax with chance nodes for dice outcomes.
// Enumerates full turn sequences, evaluates positions, and caches the
// planned move sequence per room so pickMove can return one move at a time.

import { getLegalMoves } from "./engine.js";

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_OWN_CANDIDATES   = 20;   // top-N pruning on our turn sequences
const MAX_OPP_CANDIDATES   = 10;   // top-N pruning on opponent sequences
const DOUBLES_MAX_SEQUENCES = 200; // cap enumeration for doubles
const SEARCH_TIMEOUT_MS     = 5000;

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

// ── Lightweight state cloning ───────────────────────────────────────────────

function cloneGs(gs) {
  return {
    board:   gs.board.slice(),
    bar:     { white: gs.bar.white, black: gs.bar.black },
    off:     { white: gs.off.white, black: gs.off.black },
    dice:    gs.dice.slice(),
    moveSeq: gs.moveSeq,
  };
}

// ── Fast move application (mirrors engine.js applyMove but lightweight) ─────

function applyMoveLight(gs, color, from, to, die) {
  const s   = cloneGs(gs);
  const opp = color === "white" ? "black" : "white";

  // Remove checker from source
  if (from === "bar") {
    s.bar[color]--;
  } else {
    color === "white" ? s.board[from]-- : s.board[from]++;
  }

  let hit = false;

  if (to === "off") {
    s.off[color]++;
  } else {
    const at = s.board[to];
    const blot = color === "white" ? (at === -1) : (at === 1);
    if (blot) {
      s.bar[opp]++;
      s.board[to] = 0;
      hit = true;
    }
    color === "white" ? s.board[to]++ : s.board[to]--;
  }

  // Consume die
  const idx = s.dice.indexOf(die);
  if (idx !== -1) s.dice.splice(idx, 1);

  s.moveSeq++;
  return { gs: s, hit };
}

// ── State hashing for deduplication ─────────────────────────────────────────

function hashState(gs) {
  return gs.board.join(",") + "|" +
    gs.bar.white + "," + gs.bar.black + "|" +
    gs.off.white + "," + gs.off.black + "|" +
    gs.dice.join(",");
}

// ── Enumerate all distinct full-turn sequences ──────────────────────────────

function enumerateAllTurnSequences(gs, color, maxSequences) {
  const results = [];
  const limit = maxSequences || Infinity;

  function recurse(currentGs, movesPlayed) {
    if (results.length >= limit) return;

    const legal = getLegalMoves(currentGs, color);
    if (legal.length === 0 || currentGs.dice.length === 0) {
      results.push({ finalGs: currentGs, moves: movesPlayed.slice() });
      return;
    }

    const seen = new Set();
    for (const m of legal) {
      if (results.length >= limit) return;
      const { gs: nextGs } = applyMoveLight(currentGs, color, m.from, m.to, m.die);
      const key = hashState(nextGs);
      if (seen.has(key)) continue;
      seen.add(key);
      movesPlayed.push(m);
      recurse(nextGs, movesPlayed);
      movesPlayed.pop();
    }
  }

  recurse(gs, []);
  return results;
}

// ── Evaluation function ─────────────────────────────────────────────────────
// Scores a position from `color`'s perspective. Higher = better.

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

  // 3. Bar penalty
  score -= gs.bar[color] * 25;
  score += gs.bar[opp] * 25;

  // 4. Blot exposure (zone-dependent)
  score -= countWeightedBlots(gs, color);
  score += countWeightedBlots(gs, opp) * 0.5;

  // 5. Made points
  score += countMadePoints(gs, color) * 7;
  score -= countMadePoints(gs, opp) * 7;

  // 6. Home board strength
  score += homeboardStrength(gs, color) * 10;
  score -= homeboardStrength(gs, opp) * 10;

  // 7. Prime bonus
  score += primeBonus(gs, color);
  score -= primeBonus(gs, opp);

  // 8. Checkers in home board
  score += checkersInHome(gs, color) * 2;

  // 9. Bear-off readiness
  if (allInHomeBoard(gs, color)) score += 30;

  // 10. Jan threat
  score += janThreat(gs, color);

  return score;
}

// ── Evaluation helpers ──────────────────────────────────────────────────────

function pipCount(gs, color) {
  let pips = 0;
  if (color === "white") {
    for (let i = 0; i < 24; i++) {
      if (gs.board[i] > 0) pips += (i + 1) * gs.board[i];
    }
    pips += gs.bar[color] * 25;
  } else {
    for (let i = 0; i < 24; i++) {
      if (gs.board[i] < 0) pips += (24 - i) * (-gs.board[i]);
    }
    pips += gs.bar[color] * 25;
  }
  return pips;
}

function countWeightedBlots(gs, color) {
  let penalty = 0;
  // Zone boundaries depend on color
  const [oppHomeLo, oppHomeHi] = color === "white" ? [18, 23] : [0, 5];
  const [oppOuterLo, oppOuterHi] = color === "white" ? [12, 17] : [6, 11];
  const [ownOuterLo, ownOuterHi] = color === "white" ? [6, 11] : [12, 17];
  // ownHome is [0,5] for white, [18,23] for black

  for (let i = 0; i < 24; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n === 1) {
      if (i >= oppHomeLo && i <= oppHomeHi)       penalty += 12;
      else if (i >= oppOuterLo && i <= oppOuterHi) penalty += 8;
      else if (i >= ownOuterLo && i <= ownOuterHi) penalty += 5;
      else                                          penalty += 3;
    }
  }
  return penalty;
}

function countMadePoints(gs, color) {
  let count = 0;
  for (let i = 0; i < 24; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n >= 2) count++;
  }
  return count;
}

function homeboardStrength(gs, color) {
  const [lo, hi] = color === "white" ? [0, 5] : [18, 23];
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n >= 2) count++;
  }
  return count;
}

function primeBonus(gs, color) {
  // Find longest consecutive run of made points
  let longest = 0;
  let run = 0;
  for (let i = 0; i < 24; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n >= 2) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  // Bonus for primes of length 3+
  return longest >= 3 ? (longest - 2) * 20 : 0;
}

function checkersInHome(gs, color) {
  const [lo, hi] = color === "white" ? [0, 5] : [18, 23];
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n > 0) count += n;
  }
  return count;
}

function allInHomeBoard(gs, color) {
  if (gs.bar[color] > 0) return false;
  const [lo, hi] = color === "white" ? [0, 5] : [18, 23];
  for (let i = 0; i < 24; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n > 0 && (i < lo || i > hi)) return false;
  }
  return true;
}

function janThreat(gs, color) {
  const opp = color === "white" ? "black" : "white";
  if (gs.bar[opp] === 0) return 0;

  // Count how many of opponent's 6 entry points we block
  const q1 = opp === "white" ? [18, 19, 20, 21, 22, 23] : [0, 1, 2, 3, 4, 5];
  let blocked = 0;
  for (const idx of q1) {
    const n = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (n >= 2) blocked++;
  }

  // Bonus if opponent has more bar checkers than accessible points
  const accessible = 6 - blocked;
  if (gs.bar[opp] > accessible) return 50 + (gs.bar[opp] - accessible) * 20;
  if (blocked >= 4) return 30;
  return 0;
}

// ── Core search ─────────────────────────────────────────────────────────────

function computeBestTurnSequence(gs, color) {
  const startTime = Date.now();
  const opp = color === "white" ? "black" : "white";

  // Determine if this is a doubles roll (more sequences → more aggressive pruning)
  const isDoubles = gs.dice.length === 4;
  const seqLimit = isDoubles ? DOUBLES_MAX_SEQUENCES : undefined;

  // Enumerate all our full-turn sequences
  const mySequences = enumerateAllTurnSequences(gs, color, seqLimit);

  if (mySequences.length === 0) return null;
  if (mySequences.length === 1) return mySequences[0].moves;

  // 1-ply fast evaluation for top-N pruning
  for (const seq of mySequences) {
    seq.score = evaluate(seq.finalGs, color);
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
      const oppGs = cloneGs(cand.finalGs);
      oppGs.dice = dice.slice();

      // Enumerate opponent's turn sequences
      const oppSeqLimit = isDoubles ? 50 : undefined;
      const oppSequences = enumerateAllTurnSequences(oppGs, opp, oppSeqLimit);

      if (oppSequences.length === 0) {
        // Opponent has no moves — evaluate our position
        expectedValue += prob * evaluate(cand.finalGs, color);
        continue;
      }

      // Fast-evaluate opponent sequences and take top-N
      for (const seq of oppSequences) {
        seq.score = evaluate(seq.finalGs, color);
      }
      // Opponent minimizes our score, so sort ascending and take the top (lowest for us)
      oppSequences.sort((a, b) => a.score - b.score);
      const topOpp = oppSequences.slice(0, MAX_OPP_CANDIDATES);

      // Opponent picks their best (worst for us = minimum of our eval)
      let oppBest = Infinity;
      for (const oSeq of topOpp) {
        if (oSeq.score < oppBest) oppBest = oSeq.score;
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
