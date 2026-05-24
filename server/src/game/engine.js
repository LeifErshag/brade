// ── Bräde game engine (official Svenskt Bräde / Swedish Tables rules) ─────────
//
// Storage representation (preserved from the old engine, but semantics differ):
//   board[0..23]: +n = n white checkers, -n = n black checkers on point index+1.
//
// CRITICAL — both colors move the SAME way (counterclockwise) around ONE shared
// 24-point loop in the +1 (mod 24) index direction. Each color just starts at
// its own home and finishes after a full lap.
//   White's home = index 0  (point 1).  Setup: board[0]  = +15
//   Black's home = index 12 (point 13). Setup: board[12] = -15
//
// All rule logic runs in per-color "path position" space (0..23), identical for
// both colors:
//   idxToPath(color, idx): white → idx ; black → (idx - 12 + 24) % 24
//   pathToIdx(color, pos): white → pos ; black → (pos + 12) % 24
//
// Path-space layout (same for both colors):
//   Home point ............................ pos 0
//   Quarter 1 (home quarter / re-entry) ... pos 0–5
//   Quarter 2 ............................. pos 6–11   (huk = pos 11)
//   Quarter 3 ............................. pos 12–17
//   Quarter 4 (bear-off quarter) .......... pos 18–23
//   Bear-off edge ......................... after pos 23; pips for pos p = 24 - p
//   Bar (off the board) ................... pos −1
//   Normal move ........................... pos -> pos + die
//   Bar re-entry for die d ................ lands on pos = d - 1
//
// MOVE-OBJECT CONTRACT (preserved exactly): getLegalMoves / applyMove use
// objects { from, to, die } where `from` is an absolute board index 0–23 or the
// string "bar", and `to` is an absolute board index 0–23 or the string "off".
// Path-space is internal only.

// ── Path-space conversion helpers (exported; used by AI and tests) ───────────

export function idxToPath(color, idx) {
  return color === "white" ? idx : (idx - 12 + 24) % 24;
}

export function pathToIdx(color, pos) {
  return color === "white" ? pos : (pos + 12) % 24;
}

// ── Quarter / huk helpers (exported) ─────────────────────────────────────────

export const HUK_POS = 11;          // path pos of the huk (Quarter 2)
export const HOME_POS = 0;          // path pos of the home point
export const Q4_LO = 18, Q4_HI = 23; // bear-off quarter (path space)
export const Q1_LO = 0,  Q1_HI = 5;  // re-entry quarter (path space)

export function quarterOf(pos) {
  if (pos < 0) return 0;            // bar-conceptual; treat as before Q1
  return Math.floor(pos / 6) + 1;   // 0–5→1, 6–11→2, 12–17→3, 18–23→4
}

// Pips needed to bear a checker off from path pos p.
export function pipsToBearOff(pos) {
  return 24 - pos;
}

// ── Win point table (exported; §13–14) ───────────────────────────────────────

export const WIN_POINTS = {
  sprangjan:             6,
  jan:                   4,
  kronspel_enkelt_munk:  3,
  kronspel_dubbelt_munk: 3,
  trappspel_munk:        3,
  uppspel_munk:          3,
  kronspel_enkelt:       2,
  kronspel_dubbelt:      2,
  trappspel:             2,
  uppspel:               2,
  hemspel_munk:          2,
  hemspel:               1,
  resign:                1,
};

export function winPoints(winType) {
  return WIN_POINTS[winType] ?? 1;
}

// ── Setup & teka (§1) ────────────────────────────────────────────────────────

export function initGame() {
  const board = new Array(24).fill(0);
  board[0]  = 15;   // white: all 15 on point 1   (white home)
  board[12] = -15;  // black: all 15 on point 13  (black home)
  return {
    board,
    bar:        { white: 0, black: 0 },
    off:        { white: 0, black: 0 },
    // Teka: first player of the FIRST game of a match is decided elsewhere.
    // Keep the starting turn random; do not hardcode a winner.
    turn:       Math.random() < 0.5 ? "white" : "black",
    phase:      "rolling",   // "rolling" | "moving"
    dice:       [],          // remaining dice for this turn
    rolledDice: [],          // original roll (for display)
    legalMoves: [],
    moveSeq:    0,
    firstMove:  true,        // teka/first-move marker (informational)
  };
}

export function rollDice() {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}

// ── Board read helpers (path space) ──────────────────────────────────────────

// Signed count of `color`'s checkers at a given path pos (negative = opponent).
function ownAt(gs, color, pos) {
  const idx = pathToIdx(color, pos);
  const at  = gs.board[idx];
  return color === "white" ? at : -at;  // >0 own, <0 opponent, 0 empty
}

// ── canBearOff (§7) ──────────────────────────────────────────────────────────
// True when all 15 checkers are in Quarter 4 (path pos 18–23) and none on bar.

export function canBearOff(gs, color) {
  if (gs.bar[color] > 0) return false;
  for (let idx = 0; idx < 24; idx++) {
    const at = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (at > 0) {
      const pos = idxToPath(color, idx);
      if (pos < Q4_LO || pos > Q4_HI) return false;
    }
  }
  return true;
}

// In-play checker count (not on bar, not borne off).
function onBoardCount(gs, color) {
  let n = 0;
  for (let idx = 0; idx < 24; idx++) {
    const at = color === "white" ? gs.board[idx] : -gs.board[idx];
    if (at > 0) n += at;
  }
  return n;
}

// Junker exception (§6/§10): borne off 14 → exactly one checker remains (on the
// board or on the bar). With 15 checkers total, off===14 uniquely identifies it.
function isJunker(gs, color) {
  return gs.off[color] === 14;
}

// Rearmost (lowest) Quarter-4 path pos occupied by `color` (or -1 if none).
function rearmostQ4(gs, color) {
  for (let pos = Q4_LO; pos <= Q4_HI; pos++) {
    if (ownAt(gs, color, pos) > 0) return pos;
  }
  return -1;
}

// ── Landing legality (§5) ────────────────────────────────────────────────────
// Can `color` make a NORMAL forward move landing on path pos `dest`?
// (Bursting & bear-off are handled separately.)
//
// Blocked if the opponent has a band (≥2) there.
// On the opponent's side of the board (your Q1 & Q2 = path pos 0–11) you may
// make a band ONLY at your huk (pos 11): you may not create/extend an own band
// on pos 1–10. On your own side (Q3 & Q4 = pos 12–23) bands are allowed anywhere.
function canLandNormal(gs, color, dest) {
  const here = ownAt(gs, color, dest);
  if (here <= -2) return false;                 // opponent band — blocked (no burst here)
  // Banding restriction on opponent's side (pos 1–10).
  if (dest >= 1 && dest <= 10 && here >= 1) return false; // would create/extend own band
  return true;                                   // empty, opp blot (hit), own blot/band where allowed
}

// ── Bursting eligibility (§6) ────────────────────────────────────────────────
// Re-enterable Q1 path positions: empty or holding an opponent blot.
function availableQ1ForReentry(gs, color) {
  let n = 0;
  for (let pos = Q1_LO; pos <= Q1_HI; pos++) {
    const here = ownAt(gs, color, pos);
    if (here === 0 || here === -1) n++;          // empty or opponent blot → re-enterable
  }
  return n;
}

// Case B (bar overflow): a player on the bar may burst opponent bands in Q1
// when bar[color] > availableQ1ForReentry.  Suppressed for the junker.
function mayBurstFromBar(gs, color) {
  if (gs.bar[color] === 0) return false;
  if (isJunker(gs, color)) return false;
  return gs.bar[color] > availableQ1ForReentry(gs, color);
}

// Case A (impenetrable wall): the player is NOT on the bar but has no legal
// non-burst move for ANY remaining die, AND there is a contiguous run of ≥6
// opponent bands directly in his forward path. Then he may burst one wall band.
// Not forced if any non-burst move exists. Suppressed for the junker.
function wallBurstTargets(gs, color, dice) {
  if (gs.bar[color] > 0) return [];
  if (isJunker(gs, color)) return [];

  // If any ordinary (non-burst) move exists for any die, no wall-burst.
  for (const die of new Set(dice)) {
    if (genNormalAndBearOff(gs, color, die).length > 0) return [];
  }

  // Find, per occupied source, whether a die would land/intermediate-land on a
  // contiguous wall of ≥6 opponent bands lying in the forward path. We only
  // count the wall the checker actually runs into (it never leaves Q4 except by
  // bear-off, and never wraps past pos 23).
  const targets = [];
  for (const die of new Set(dice)) {
    for (let pos = 0; pos <= 23; pos++) {
      if (ownAt(gs, color, pos) <= 0) continue;   // need own checker here
      const dest = pos + die;
      if (dest > 23) continue;                     // can't leave the loop end
      if (ownAt(gs, color, dest) <= -2) {          // dest is an opponent band
        // Is dest part of a contiguous opponent-band wall of length ≥6?
        if (contiguousBandRunCovers(gs, color, dest, 6)) {
          const from = pathToIdx(color, pos);
          const to   = pathToIdx(color, dest);
          targets.push({ from, to, die });
        }
      }
    }
  }
  return targets;
}

// Is path pos `dest` inside a contiguous run (length ≥ minLen) of opponent
// bands, none extending past pos 23?
function contiguousBandRunCovers(gs, color, dest, minLen) {
  let lo = dest, hi = dest;
  while (lo - 1 >= 0 && ownAt(gs, color, lo - 1) <= -2) lo--;
  while (hi + 1 <= 23 && ownAt(gs, color, hi + 1) <= -2) hi++;
  return (hi - lo + 1) >= minLen;
}

// ── First-move generation for a single die (path → absolute indices) ─────────
//
// Three move kinds are produced as { from, to, die } in ABSOLUTE indices:
//   • bar re-entry  : from "bar", to = idx
//   • normal move   : from = idx, to = idx
//   • bear-off      : from = idx, to "off"
// Bursting moves are ordinary first-moves too (they just land on an opp band).

// Normal board moves + bear-off moves for one die (NO bar re-entry, NO burst).
function genNormalAndBearOff(gs, color, die) {
  const moves = [];
  if (gs.bar[color] > 0) return moves;            // must re-enter first

  const bearing = canBearOff(gs, color);
  const rear    = bearing ? rearmostQ4(gs, color) : -1;

  for (let pos = 0; pos <= 23; pos++) {
    if (ownAt(gs, color, pos) <= 0) continue;
    const from = pathToIdx(color, pos);
    const dest = pos + die;

    if (dest <= 23) {
      // Normal forward move within the loop.
      if (canLandNormal(gs, color, dest)) {
        moves.push({ from, to: pathToIdx(color, dest), die });
      }
    } else if (bearing) {
      // Bear-off: only the rearmost Q4 checker may bear off (§7).
      if (pos !== rear) continue;
      const needed = pipsToBearOff(pos);          // 24 - pos
      if (die === needed) {
        moves.push({ from, to: "off", die });     // gå jämnt hem
      } else if (die > needed) {
        moves.push({ from, to: "off", die });     // slaget reduceras
      }
      // die < needed handled by the dest<=23 branch (move within Q4) above.
    }
  }
  return moves;
}

// All candidate first-moves for one die, INCLUDING bar re-entry and bursting.
function genFirstMovesForDie(gs, color, die, dice) {
  const moves = [];

  if (gs.bar[color] > 0) {
    // Bar has priority: re-enter only.
    const dest = die - 1;                          // re-entry lands on pos d-1
    const here = ownAt(gs, color, dest);
    const to   = pathToIdx(color, dest);
    if (here === 0 || here === -1) {
      // Empty or opponent blot → ordinary re-entry (hit if blot).
      moves.push({ from: "bar", to, die });
    } else if (here <= -2 && mayBurstFromBar(gs, color)) {
      // Opponent band → burst re-entry (Case B).
      moves.push({ from: "bar", to, die });
    }
    return moves;
  }

  // Not on bar: normal moves + bear-off.
  moves.push(...genNormalAndBearOff(gs, color, die));

  // Case A wall-burst, only if no ordinary move exists at all.
  const wall = wallBurstTargets(gs, color, dice);
  for (const w of wall) if (w.die === die) moves.push(w);

  return moves;
}

// Raw (unfiltered) candidate first-moves across all distinct remaining dice.
function genAllFirstMoves(gs, color) {
  const seen  = new Set();
  const moves = [];
  for (const die of new Set(gs.dice)) {
    for (const m of genFirstMovesForDie(gs, color, die, gs.dice)) {
      const k = `${m.from}:${m.to}:${m.die}`;
      if (!seen.has(k)) { seen.add(k); moves.push(m); }
    }
  }
  return moves;
}

// ── applyMove (§4, §6, §7) ───────────────────────────────────────────────────
// Returns { gs, hit, burst }. Deep-clones; consumes one die; increments moveSeq.

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

export function applyMove(gs, color, from, to, die) {
  const s   = deepClone(gs);
  const opp = color === "white" ? "black" : "white";

  // Remove checker from source.
  if (from === "bar") {
    s.bar[color]--;
  } else {
    color === "white" ? s.board[from]-- : s.board[from]++;
  }

  let hit = false, burst = false;

  if (to === "off") {
    s.off[color]++;
  } else {
    const at      = s.board[to];
    const oppHere = color === "white" ? -at : at;   // opponent count at dest
    if (oppHere === 1) {
      // Ordinary hit of an opponent blot.
      s.bar[opp]++;
      s.board[to] = 0;
      hit = true;
    } else if (oppHere >= 2) {
      // Bursting an opponent band: ALL its checkers go to the opp's bar.
      s.bar[opp] += oppHere;
      s.board[to] = 0;
      hit = true;
      burst = true;
    }
    color === "white" ? s.board[to]++ : s.board[to]--;
  }

  // Consume one die.
  const di = s.dice.indexOf(die);
  if (di !== -1) s.dice.splice(di, 1);

  s.moveSeq++;
  s.firstMove = false;
  return { gs: s, hit, burst };
}

// Lightweight clone+apply used internally by the turn-level enumerator.
function simApply(gs, color, m) {
  const s = {
    board: gs.board.slice(),
    bar:   { white: gs.bar.white, black: gs.bar.black },
    off:   { white: gs.off.white, black: gs.off.black },
    dice:  gs.dice.slice(),
  };
  const opp = color === "white" ? "black" : "white";

  if (m.from === "bar") s.bar[color]--;
  else color === "white" ? s.board[m.from]-- : s.board[m.from]++;

  let burst = false;
  if (m.to === "off") {
    s.off[color]++;
  } else {
    const at = s.board[m.to];
    const oppHere = color === "white" ? -at : at;
    if (oppHere === 1) { s.bar[opp]++; s.board[m.to] = 0; }
    else if (oppHere >= 2) { s.bar[opp] += oppHere; s.board[m.to] = 0; burst = true; }
    color === "white" ? s.board[m.to]++ : s.board[m.to]--;
  }

  const di = s.dice.indexOf(m.die);
  if (di !== -1) s.dice.splice(di, 1);

  return { gs: s, burst };
}

// Reduction (overshoot pips) of a bear-off move from absolute index `from`.
function bearOffReduction(color, from, die) {
  const pos    = idxToPath(color, from);
  const needed = pipsToBearOff(pos);
  return Math.max(0, die - needed);
}

// ── Turn-level legality (§2 maximal-use / higher-die; §7 min-reduction; §12) ──
//
// Enumerate every complete legal move sequence reachable from the current state
// using the remaining dice. A sequence is "complete" when no further first-move
// exists (dice exhausted or stuck). Then filter:
//   1. keep only sequences of maximal length;
//   2. (§2) if max length == 1 and both a higher-die and lower-die single move
//      are individually available, drop sequences whose single die is not the
//      maximum playable single die;
//   3. (§7) among survivors, keep those with minimal total bear-off reduction;
//   4. (§12) sequences that END THE GAME are exempt from the length, higher-die
//      and min-reduction filters — they always survive.
// getLegalMoves returns the de-duplicated set of FIRST moves of the survivors.

// Strip a sim-state down to the plain { board, bar, off } final-position shape.
function finalState(simGs) {
  return {
    board: simGs.board.slice(),
    bar:   { white: simGs.bar.white, black: simGs.bar.black },
    off:   { white: simGs.off.white, black: simGs.off.black },
  };
}

function enumerateSequences(gs, color) {
  const results = [];        // { moves:[...], length, reduction, ends, finalGs }
  const MAX = 4000;          // safety cap

  function recurse(curGs, played, reduction) {
    if (results.length >= MAX) return;

    // Game-ending check at this state (after the moves played so far).
    if (played.length > 0) {
      const win = checkWin({ ...curGs, turn: color });
      if (win) {
        results.push({ moves: played.slice(), length: played.length, reduction, ends: true, finalGs: finalState(curGs) });
        return;                // §12: may not keep playing once the game ends
      }
    }

    const firsts = genAllFirstMovesSim(curGs, color);
    if (firsts.length === 0 || curGs.dice.length === 0) {
      if (played.length > 0) {
        results.push({ moves: played.slice(), length: played.length, reduction, ends: false, finalGs: finalState(curGs) });
      }
      return;
    }

    const seen = new Set();
    for (const m of firsts) {
      const { gs: nextGs } = simApply(curGs, color, m);
      // Dedup identical resulting states (different die-order, etc.).
      const key = stateKey(nextGs) + "#" + (played.length + 1);
      if (seen.has(key)) continue;
      seen.add(key);
      const add = m.to === "off" ? bearOffReduction(color, m.from, m.die) : 0;
      played.push(m);
      recurse(nextGs, played, reduction + add);
      played.pop();
    }
  }

  recurse(simRoot(gs), [], 0);
  return results;
}

function simRoot(gs) {
  return {
    board: gs.board.slice(),
    bar:   { white: gs.bar.white, black: gs.bar.black },
    off:   { white: gs.off.white, black: gs.off.black },
    dice:  gs.dice.slice(),
  };
}

function stateKey(gs) {
  return gs.board.join(",") + "|" + gs.bar.white + "," + gs.bar.black +
         "|" + gs.off.white + "," + gs.off.black + "|" + gs.dice.slice().sort().join(",");
}

// genAllFirstMoves but operating on a sim-state (no turn/phase fields needed).
function genAllFirstMovesSim(simGs, color) {
  return genAllFirstMoves(simGs, color);
}

// ── legalTurnSequences (exported) ────────────────────────────────────────────
// Enumerate all complete legal turn sequences, then apply the turn-level
// survivor filters (§2 maximal-use / higher-die, §7 min-reduction, §12 ending
// exemption). Returns the SURVIVING sequences — the same set getLegalMoves
// derives its first moves from — so the AI search can reuse them.
//
// Each survivor is:
//   { moves:   [{from,to,die}, ...],   // absolute-index move objects, in order
//     finalGs: { board, bar, off },    // plain sim-state after the whole sequence
//     ends:    boolean,                // §12: does this sequence end the game?
//     reduction: number }              // total bear-off reduction
export function legalTurnSequences(gs, color) {
  if (!gs.dice || gs.dice.length === 0) return [];

  const seqs = enumerateSequences(gs, color);
  if (seqs.length === 0) return [];

  const ending     = seqs.filter(s => s.ends);
  const nonEnding  = seqs.filter(s => !s.ends);

  const survivors = [];

  // §12: every game-ending sequence survives (length / higher-die / reduction
  // obligations relaxed for the ending move).
  for (const s of ending) survivors.push(s);

  if (nonEnding.length > 0) {
    // §2: maximal length.
    const maxLen = Math.max(...nonEnding.map(s => s.length));
    let pool = nonEnding.filter(s => s.length === maxLen);

    // §2: higher-die rule when max length == 1.
    if (maxLen === 1) {
      const dice = [...new Set(pool.map(s => s.moves[0].die))];
      if (dice.length > 1) {
        const hi = Math.max(...dice);
        pool = pool.filter(s => s.moves[0].die === hi);
      }
    }

    // §7: minimize total bear-off reduction.
    const minRed = Math.min(...pool.map(s => s.reduction));
    pool = pool.filter(s => s.reduction === minRed);

    for (const s of pool) survivors.push(s);
  }

  // Return survivors with only the public shape (drop the internal `length`).
  return survivors.map(s => ({
    moves:     s.moves,
    finalGs:   s.finalGs,
    ends:      s.ends,
    reduction: s.reduction,
  }));
}

export function getLegalMoves(gs, color) {
  const survivors = legalTurnSequences(gs, color);

  // De-duplicated first moves of surviving sequences.
  const seen  = new Set();
  const moves = [];
  for (const s of survivors) {
    const m = s.moves[0];
    const k = `${m.from}:${m.to}:${m.die}`;
    if (!seen.has(k)) { seen.add(k); moves.push(m); }
  }
  return moves;
}

// ── Vackert spel pattern detection (§8) ──────────────────────────────────────
// Requires off[color] === 0 (no checker borne off yet) and all 15 in Q4 in one
// of the named patterns. Returns the base winType string or null.
function vackertSpel(gs, color) {
  if (gs.off[color] !== 0) return null;
  if (gs.bar[color] > 0) return null;
  if (onBoardCount(gs, color) !== 15) return null;

  // All 15 must be in Quarter 4.
  const c = {};
  for (let pos = 0; pos <= 23; pos++) {
    const n = ownAt(gs, color, pos);
    if (n > 0) {
      if (pos < Q4_LO) return null;   // a checker outside Q4 → not vackert spel
      c[pos] = n;
    }
  }

  const eq = (obj) => {
    const keys = Object.keys(c).map(Number);
    const wantKeys = Object.keys(obj).map(Number);
    if (keys.length !== wantKeys.length) return false;
    for (const k of wantKeys) if (c[k] !== obj[k]) return false;
    return true;
  };

  // Enkelt kronspel: 3 on each of pos 19–23 (points 20–24).
  if (eq({ 19: 3, 20: 3, 21: 3, 22: 3, 23: 3 })) return "kronspel_enkelt";
  // Dubbelt kronspel: 5 on each of pos 21–23 (points 22–24).
  if (eq({ 21: 5, 22: 5, 23: 5 })) return "kronspel_dubbelt";
  // Trappspel: 7 on pos 23, 5 on pos 22, 3 on pos 21 (points 24/23/22).
  if (eq({ 21: 3, 22: 5, 23: 7 })) return "trappspel";
  // Uppspel: 15 on pos 23 (point 24).
  if (eq({ 23: 15 })) return "uppspel";

  return null;
}

// ── Jan / sprängjan detection (§10, §11) ─────────────────────────────────────
// The opponent is "jan" when bar[opp] > available, where `available` = number
// of the OPPONENT's Q1 path positions NOT occupied by the OPPONENT's OWN
// checkers (empty, or holding the winner's blot, or holding the winner's band —
// the band counts because it is burstable).
//
// Edge: if the junker exception applies to the opponent (14 off + 1 left, no
// bursting), winner bands do NOT count as available.
function checkJan(gs, lastMoveBurst) {
  const winner = gs.turn;
  const loser  = winner === "white" ? "black" : "white";
  if (gs.bar[loser] === 0) return null;

  const loserJunker = isJunker(gs, loser);

  let available = 0;
  for (let pos = Q1_LO; pos <= Q1_HI; pos++) {
    const loserHere = ownAt(gs, loser, pos);    // >0 own (loser), <0 winner, 0 empty
    if (loserHere > 0) continue;                // loser's own checker → not available
    if (loserHere <= -2) {
      // Winner band: burstable → counts as available UNLESS loser is junker.
      if (loserJunker) continue;
    }
    available++;                                 // empty, winner blot, or burstable band
  }

  if (gs.bar[loser] > available) {
    const winType = lastMoveBurst ? "sprangjan" : "jan";
    return { winner, winType, points: winPoints(winType), monk: false };
  }
  return null;
}

// ── checkWin (§7–§11) ────────────────────────────────────────────────────────
// Called on the POST-move state; the mover is gs.turn.
// Optional lastMoveBurst upgrades jan → sprängjan (§11).
// Returns { winner, winType, points, monk } | null.

export function checkWin(gs, lastMoveBurst = false) {
  const mover = gs.turn;
  const opp   = mover === "white" ? "black" : "white";

  // 1. Bear-off win (all 15 off) — hemspel / hemspel_munk (§7, §9).
  if (gs.off[mover] === 15) {
    const monk = gs.bar[opp] >= 1;            // opponent has ≥1 on bar → med munk
    const winType = monk ? "hemspel_munk" : "hemspel";
    return { winner: mover, winType, points: winPoints(winType), monk };
  }

  // 2. Vackert spel (§8) — pattern win, requires off === 0.
  const pattern = vackertSpel(gs, mover);
  if (pattern) {
    const monk = gs.bar[opp] >= 1;            // §9 munk variant
    const winType = monk ? `${pattern}_munk` : pattern;
    return { winner: mover, winType, points: winPoints(winType), monk };
  }

  // 3. Jan / sprängjan (§10, §11).
  const jan = checkJan(gs, lastMoveBurst);
  if (jan) return jan;

  return null;
}

// ── checkJanOnPass (§10) ──────────────────────────────────────────────────────
// checkWin runs post-move and only detects a jan against the MOVER's OPPONENT.
// It cannot see the symmetric case: the player whose turn it is rolls (or runs
// out of moves) while closed out on the bar — THEY are the one who is jan, but
// it is their own turn so checkWin never fires. Call this at every no-legal-moves
// auto-pass: if the player to move (gs.turn) is on the bar with more checkers
// there than re-entry points, their opponent wins by jan.
// A pass involves no move, so it is never a burst → jan, never sprängjan.
// Returns { winner, winType, points, monk } | null.
export function checkJanOnPass(gs) {
  const stuck = gs.turn;
  if (gs.bar[stuck] === 0) return null;        // not on the bar → ordinary forced pass
  const probe = { ...gs, turn: stuck === "white" ? "black" : "white" };
  return checkJan(probe, false);
}
