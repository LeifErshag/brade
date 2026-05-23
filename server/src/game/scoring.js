/**
 * Match-scoring helpers for Bräde (§14 tie-break).
 *
 * winRank(winType) → number (higher = better; ties share the same rank).
 * compareMatch(aResults, bResults) → "a" | "b" | "tie"
 *   aResults / bResults: arrays of winType strings for games THAT PLAYER WON.
 */

import { winPoints } from "./engine.js";

// §14 rank order (high → low).
// Plays listed together share the same rank value.
const WIN_RANK = {
  sprangjan:             7,
  jan:                   6,
  // 5-point group (munk variants of the 2-point plays)
  kronspel_enkelt_munk:  5,
  kronspel_dubbelt_munk: 5,
  trappspel_munk:        5,
  uppspel_munk:          5,
  // 4-point group (plain 2-point plays)
  kronspel_enkelt:       4,
  kronspel_dubbelt:      4,
  trappspel:             4,
  uppspel:               4,
  // 3-point group
  hemspel_munk:          3,
  // 2-point group
  hemspel:               2,
  // 1-point group (resign is 1 pt but ranks lowest)
  resign:                1,
};

/**
 * Return the §14 rank of a win type.
 * Unknown types default to rank 0 (below resign).
 */
export function winRank(winType) {
  return WIN_RANK[winType] ?? 0;
}

/**
 * Compare two players' match records and return who wins overall.
 *
 * Algorithm (§14):
 *   1. Sum cumulative points — higher wins.
 *   2. Tie: compare each player's won-game winTypes sorted descending by
 *      winRank. Walk index by index; first difference wins.
 *   3. Still tied: return "tie".
 *
 * @param {string[]} aResults  winTypes of games player A won
 * @param {string[]} bResults  winTypes of games player B won
 * @returns {"a"|"b"|"tie"}
 */
export function compareMatch(aResults, bResults) {
  const aPoints = aResults.reduce((s, wt) => s + winPoints(wt), 0);
  const bPoints = bResults.reduce((s, wt) => s + winPoints(wt), 0);

  if (aPoints !== bPoints) return aPoints > bPoints ? "a" : "b";

  // Tie-break: descending rank lists
  const aRanks = aResults.map(winRank).sort((x, y) => y - x);
  const bRanks = bResults.map(winRank).sort((x, y) => y - x);

  const len = Math.max(aRanks.length, bRanks.length);
  for (let i = 0; i < len; i++) {
    const ar = aRanks[i] ?? 0;
    const br = bRanks[i] ?? 0;
    if (ar !== br) return ar > br ? "a" : "b";
  }

  return "tie";
}
