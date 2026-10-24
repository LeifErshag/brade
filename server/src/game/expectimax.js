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
  checkWin,
  checkJanOnPass,
  applyMove,
  winPoints,
} from "./engine.js";
import { winRank } from "./scoring.js";
import { searchOffThread } from "./expectimaxThread.js";

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_OWN_CANDIDATES = 20;   // top-N pruning on our turn sequences
// Time budget for one search (#106). Positions measured locally take at most
// about 160 ms, so this only cuts pathological positions or a slow CPU short.
export const SEARCH_TIMEOUT_MS = 500;

// Value of a finished game per win point (#68). Far outside the heuristic
// range of evaluate() (a few hundred either way), so any win beats any
// continuing position, any loss is worse than one, and more points dominate.
// Wins with equal points are ordered by their §14 rank (winRank, at most 7).
const WIN_VALUE = 100000;

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
// roomId → token of the off-thread search in progress for that room. Clearing
// the room's cache drops it, so a search that was running when the game ended
// does not cache its plan into the next game.
const searchesInFlight = new Map();

export function clearExpectimaxCache(roomId) {
  turnPlanCache.delete(roomId);
  searchesInFlight.delete(roomId);
}

// ── Public entry points (getNextExpectimaxMoveOffThread is called by ai.js) ──

// Searches on the calling thread. Used by tests and benchmarks; the game
// server uses getNextExpectimaxMoveOffThread so the search cannot block it.
export function getNextExpectimaxMove(gs, color, legalMoves, roomId) {
  const planned = takePlannedMove(gs, roomId);
  if (planned !== undefined) return planned;

  let bestMoves;
  try {
    bestMoves = computeBestTurnSequence(gs, color);
  } catch (err) {
    console.error("Grandmaster search error:", err.message);
    bestMoves = null;
  }
  return startPlan(gs, legalMoves, roomId, bestMoves);
}

// Same as getNextExpectimaxMove, but the search runs in a worker thread
// (#106), so the event loop keeps serving every other room meanwhile.
export async function getNextExpectimaxMoveOffThread(gs, color, legalMoves, roomId) {
  const planned = takePlannedMove(gs, roomId);
  if (planned !== undefined) return planned;

  const token = {};
  searchesInFlight.set(roomId, token);
  let bestMoves;
  try {
    bestMoves = await searchOffThread(gs, color);
  } catch (err) {
    console.error("Grandmaster search error:", err.message);
    bestMoves = null;
  }
  const current = searchesInFlight.get(roomId) === token;
  if (current) searchesInFlight.delete(roomId);
  // The room's cache was cleared while searching: answer, but plan nothing.
  if (!current) return bestMoves?.[0] ?? legalMoves[0] ?? null;
  return startPlan(gs, legalMoves, roomId, bestMoves);
}

// The next move of the room's cached plan if the plan continues at
// gs.moveSeq; otherwise undefined, and a stale plan is discarded.
function takePlannedMove(gs, roomId) {
  const cached = turnPlanCache.get(roomId);
  if (!cached) return undefined;
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
  return undefined;
}

// Caches the searched turn `bestMoves` and returns its first move, or the
// first legal move if the search found nothing.
function startPlan(gs, legalMoves, roomId, bestMoves) {
  if (!bestMoves || bestMoves.length === 0) {
    // Fallback: pick first legal move
    return legalMoves[0] ?? null;
  }

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
//   8. Jan threat (ours against the opponent, minus theirs against us)

export function evaluate(gs, color) {
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

  // 8. Jan threat: ours against the opponent, minus theirs against us (#68)
  score += janThreat(gs, color, opp);
  score -= janThreat(gs, opp, color);

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

// Jan threat (§10 p.6): bonus when the opponent is on the bar with more
// checkers than they have entry points in their first quarter. Mirrors the
// engine's checkJan: an entry point (opponent path pos 0-5) is available unless
// the opponent's OWN checkers stand on it. Empty points, our blots and our
// bands all count as available ("tomma eller upptagna av spelarens band eller
// blottor"), so our bands there never make the opponent jan.
// Returns >= 50 exactly when bar[opp] > available (checkJan's jan condition
// with `color` as the winner); otherwise at most a near-jan bonus below 50.
export function janThreat(gs, color, opp) {
  const onBar = gs.bar[opp];
  if (onBar === 0) return 0;

  let available = 0;
  for (let pos = Q1_LO; pos <= Q1_HI; pos++) {
    const idx = pathToIdx(opp, pos);
    // The opponent's own count at that index (>0 theirs, <0 ours, 0 empty)
    const theirs = opp === "white" ? gs.board[idx] : -gs.board[idx];
    if (theirs <= 0) available++;
  }

  if (onBar > available) {
    return 50 + (onBar - available) * 20;
  }
  // Near jan: one more checker on the bar (or one fewer entry point) wins.
  if (onBar === available) return 30;
  return 0;
}

// ── Opponent reply (min node) ───────────────────────────────────────────────
// Value of the position `gs` (after our turn) for `color` when the opponent
// rolls `dice` and plays the reply that is worst for us: the minimum of
// evaluate(finalGs, color) over EVERY legal opponent sequence (#62). No
// truncation, so the result does not depend on the engine's enumeration order.
// If the opponent cannot move, the position stands as it is, unless `color`
// is jan in it (#88): on the bar with more checkers than entry points. The
// game handlers run checkJanOnPass on the mover when the turn passes, so that
// is a plain jan loss (never sprängjan: a pass bursts nothing), -JAN_VALUE.
// A reply that ends the game (checkWin with the opponent as mover) is a loss
// worth -WIN_VALUE per point (#68), sprängjan included (see winValue). If `gs` itself already ends the game in
// `color`'s favour it is terminal: its win value is returned, no reply search.
// Only gs.board/bar/off are read; neither gs nor dice is mutated.
// `evalCache` (optional) maps a colour + position key to its value, so
// positions reached by several sequences, candidates or rolls are valued once.
// Keys include the colour, so one cache may be shared across both colours.
export function opponentReplyValue(gs, color, dice, evalCache = new Map()) {
  const opp = color === "white" ? "black" : "white";
  const won = winValue(gs, color);
  if (won !== null) return won;
  const oppGs = {
    board:   gs.board.slice(),
    bar:     { white: gs.bar.white, black: gs.bar.black },
    off:     { white: gs.off.white, black: gs.off.black },
    dice:    dice.slice(),
    moveSeq: 0,
  };

  const oppSequences = legalTurnSequences(oppGs, opp);
  if (oppSequences.length === 0) {
    const stand = { board: gs.board, bar: gs.bar, off: gs.off };
    if (checkJanOnPass({ ...stand, turn: color })) return -JAN_VALUE;
    return evaluate(stand, color);
  }

  let worst = Infinity;
  for (const { finalGs, moves } of oppSequences) {
    const key = color + "|" + positionKey(finalGs);
    let s = evalCache.get(key);
    if (s === undefined) {
      const lost = winValue(finalGs, opp);
      s = lost !== null ? -lost : evaluate(finalGs, color);
      evalCache.set(key, s);
    }
    // Whether a jan is a sprängjan depends on the sequence, not just the
    // final position, so it is not cached: replay this reply (rare).
    if (s === -JAN_VALUE) s = -winValue(finalGs, opp, oppGs, moves);
    if (s < worst) worst = s;
  }
  return worst;
}

function positionKey(gs) {
  return gs.board.join(",") + "|" + gs.bar.white + "," + gs.bar.black +
         "|" + gs.off.white + "," + gs.off.black;
}

// WIN_VALUE * points + §14 rank if the position {board, bar, off} has ended
// the game with `mover` as the winner (hemspel, vackert spel, jan; with munk),
// else null. A position alone cannot tell jan from sprängjan (§11: the move
// that made the opponent jan burst a band in the mover's first quarter). When
// the sequence that led here is given (`startGs` + `moves`) and it ended in
// jan, it is replayed with applyMove and the last move's burstFirstQuarter
// flag is passed to checkWin, as the game handlers do.
function winValue(gs, mover, startGs = null, moves = null) {
  let win = checkWin({ board: gs.board, bar: gs.bar, off: gs.off, turn: mover });
  if (!win) return null;
  if (win.winType === "jan" && moves && moves.length > 0) {
    let cur = {
      board: startGs.board.slice(),
      bar:   { ...startGs.bar },
      off:   { ...startGs.off },
      dice:  (startGs.dice ?? []).slice(),
    };
    let last = null;
    for (const m of moves) {
      last = applyMove(cur, mover, m.from, m.to, m.die);
      cur = last.gs;
    }
    win = checkWin({ ...cur, turn: mover }, last.burstFirstQuarter);
  }
  return WIN_VALUE * win.points + winRank(win.winType);
}

const JAN_VALUE = WIN_VALUE * winPoints("jan") + winRank("jan");

// ── Core search ─────────────────────────────────────────────────────────────
// Uses legalTurnSequences() from the engine for correct, cheap enumeration.
// The engine already applies all turn-level filters (maximal use, higher-die,
// min-reduction) — we just need to evaluate the finalGs of each sequence.
// Returns the moves of the best turn, or null if there is no legal turn.
// The search stops after `timeoutMs` (#106) and returns the best of the
// candidates it finished; candidates are tried in 1-ply order, so the 1-ply
// best is returned if not even the first one finished.

export function computeBestTurnSequence(gs, color, timeoutMs = SEARCH_TIMEOUT_MS) {
  const startTime = Date.now();

  // Enumerate our legal turn sequences
  const mySequences = legalTurnSequences(gs, color);

  if (mySequences.length === 0) return null;
  if (mySequences.length === 1) return mySequences[0].moves;

  // Game-ending sequences are terminal (#68): take the one worth the most
  // points (ties by §14 rank), without searching any opponent reply.
  let bestWin = null;
  let bestWinValue = -Infinity;
  for (const seq of mySequences) {
    const v = winValue(seq.finalGs, color, gs, seq.moves);
    if (v !== null && v > bestWinValue) {
      bestWinValue = v;
      bestWin = seq;
    }
  }
  if (bestWin) return bestWin.moves;

  // 1-ply fast evaluation for top-N pruning
  for (const seq of mySequences) {
    // Build a full gs shape for evaluate (finalGs only has board/bar/off)
    seq._evalGs = { board: seq.finalGs.board, bar: seq.finalGs.bar, off: seq.finalGs.off };
    seq.score = evaluate(seq._evalGs, color);
  }
  mySequences.sort((a, b) => b.score - a.score);

  const candidates = mySequences.slice(0, MAX_OWN_CANDIDATES);

  // If time is already tight, return 1-ply best
  if (Date.now() - startTime > timeoutMs * 0.8) {
    return candidates[0].moves;
  }

  // 2-ply expectimax: for each candidate, average over the 21 rolls the
  // opponent's best reply among ALL their legal sequences (#62)
  let bestValue = -Infinity;
  let bestMoves = candidates[0].moves;
  // Evaluations of opponent final positions, shared across candidates and
  // dice outcomes: different candidates often lead to the same positions.
  const evalCache = new Map();

  search:
  for (const cand of candidates) {
    let expectedValue = 0;

    // The clock is checked per roll, as one candidate can take most of the
    // budget. A candidate cut short is not compared: its sum is incomplete.
    for (const { dice, prob } of DICE_OUTCOMES) {
      if (Date.now() - startTime > timeoutMs) break search;
      expectedValue += prob * opponentReplyValue(cand.finalGs, color, dice, evalCache);
    }

    if (expectedValue > bestValue) {
      bestValue = expectedValue;
      bestMoves = cand.moves;
    }
  }

  return bestMoves;
}
