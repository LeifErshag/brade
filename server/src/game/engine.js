// ── Bräde game engine ────────────────────────────────────────────────────────
// board[0..23]: positive = white checkers, negative = black checkers
// White starts at index 23 (point 24), moves DECREASING toward index 0
// Black starts at index 0  (point 1),  moves INCREASING toward index 23
//
// Bar re-entry:
//   white: index = 24 - die  (die=1 → idx 23, die=6 → idx 18)
//   black: index = die - 1   (die=1 → idx 0,  die=6 → idx 5)
//
// Home / bear-off range:
//   white: indices 0-5   (points 1-6)
//   black: indices 18-23 (points 19-24)
//
// Closing restriction (cannot make a closed point = 2+ own checkers):
//   Forbidden zone is your own Q1+Q2 (starting territory), EXCEPT head and huk:
//   white: forbidden at indices 13-22  (pts 14-23; head=idx23/pt24 and huk=idx12/pt13 are allowed)
//   black: forbidden at indices 1-10   (pts 2-11;  head=idx0/pt1   and huk=idx11/pt12 are allowed)
//
// Bar re-entry additional restriction:
//   Cannot re-enter at own head point if any own checker is already there
//   (white head = idx 23, black head = idx 0)

export function initGame() {
  const board = new Array(24).fill(0);
  board[23] = 15;   // white: all 15 on point 24
  board[0]  = -15;  // black: all 15 on point 1
  return {
    board,
    bar:       { white: 0, black: 0 },
    off:       { white: 0, black: 0 },
    turn:      Math.random() < 0.5 ? "white" : "black",
    phase:     "rolling",   // "rolling" | "moving"
    dice:      [],          // remaining dice for this turn
    rolledDice: [],         // original roll (for display)
    legalMoves: [],
    moveSeq:   0,
  };
}

export function rollDice() {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}

// Returns true when all of color's checkers are in the home board (ready to bear off)
export function canBearOff(gs, color) {
  if (gs.bar[color] > 0) return false;
  const [lo, hi] = color === "white" ? [0, 5] : [18, 23];
  for (let i = 0; i < 24; i++) {
    const n = color === "white" ? gs.board[i] : -gs.board[i];
    if (n > 0 && (i < lo || i > hi)) return false;
  }
  return true;
}

// Can color land on idx?
function canLand(gs, color, idx) {
  const at = gs.board[idx];
  if (color === "white") {
    if (at <= -2) return false;                    // 2+ black checkers — blocked
    if (idx >= 13 && idx <= 22 && at === 1) return false; // closing restriction: cannot make a point in pts 14-23
  } else {
    if (at >= 2) return false;                     // 2+ white checkers — blocked
    if (idx >= 1 && idx <= 10 && at === -1) return false; // closing restriction: cannot make a point in pts 2-11
  }
  return true;
}

function uniqueDice(dice) {
  return [...new Set(dice)];
}

// Is there a checker of `color` further from the bear-off edge than `from`?
function hasMoreDistant(gs, color, from) {
  if (color === "white") {
    for (let i = from + 1; i <= 5; i++) if (gs.board[i] > 0) return true;
  } else {
    for (let i = 18; i < from; i++) if (gs.board[i] < 0) return true;
  }
  return false;
}

export function getLegalMoves(gs, color) {
  const dir      = color === "white" ? -1 : 1;
  const seen     = new Set();
  const moves    = [];

  function push(m) {
    const k = `${m.from}:${m.to}:${m.die}`;
    if (!seen.has(k)) { seen.add(k); moves.push(m); }
  }

  // If on bar, must re-enter first
  if (gs.bar[color] > 0) {
    const headIdx = color === "white" ? 23 : 0;
    for (const die of uniqueDice(gs.dice)) {
      const idx = color === "white" ? (24 - die) : (die - 1);
      // Cannot re-enter at own head point if any own checker is there
      if (idx === headIdx) {
        const ownAtHead = color === "white" ? gs.board[headIdx] : -gs.board[headIdx];
        if (ownAtHead > 0) continue;
      }
      if (canLand(gs, color, idx)) push({ from: "bar", to: idx, die });
    }
    return moves;
  }

  const bearingOff = canBearOff(gs, color);

  for (const die of uniqueDice(gs.dice)) {
    if (bearingOff) {
      const [lo, hi] = color === "white" ? [0, 5] : [18, 23];
      for (let from = lo; from <= hi; from++) {
        const n = color === "white" ? gs.board[from] : -gs.board[from];
        if (n <= 0) continue;
        const exact = color === "white" ? (from + 1) : (24 - from);
        if (die === exact) {
          push({ from, to: "off", die });
        } else if (die > exact && !hasMoreDistant(gs, color, from)) {
          push({ from, to: "off", die });
        }
      }
    }

    // Regular board moves
    for (let from = 0; from < 24; from++) {
      const n = color === "white" ? gs.board[from] : -gs.board[from];
      if (n <= 0) continue;
      const to = from + dir * die;
      if (to >= 0 && to <= 23 && canLand(gs, color, to)) {
        push({ from, to, die });
      }
    }
  }

  return moves;
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// Returns { gs, hit: boolean }
export function applyMove(gs, color, from, to, die) {
  const s   = deepClone(gs);
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

// Checks whether the player who just moved (gs.turn, before the turn flip) has
// achieved Jan: the opponent has more checkers on the bar than accessible entry
// points in their own Q1.
//
// Accessible = not blocked by opponent's closed point (≥2) AND no own checker
// (closing restriction prevents re-entry onto own occupied Q1 point; head
// restriction prevents re-entry onto own head point).
//
// white Q1 (entry zone): indices 18-23  (die 1→idx 23 … die 6→idx 18)
// black Q1 (entry zone): indices  0-5   (die 1→idx 0  … die 6→idx 5)
function checkJan(gs) {
  const winner = gs.turn;
  const loser  = winner === "white" ? "black" : "white";
  if (gs.bar[loser] === 0) return null;

  const q1 = loser === "white" ? [18, 19, 20, 21, 22, 23] : [0, 1, 2, 3, 4, 5];

  let accessible = 0;
  for (const idx of q1) {
    const at = gs.board[idx];
    const loserHere    = loser  === "white" ? at > 0  : at < 0;   // loser has ≥1 checker
    const winnerClosed = winner === "white" ? at >= 2 : at <= -2;  // winner has closed point
    if (!loserHere && !winnerClosed) accessible++;
  }

  if (gs.bar[loser] > accessible) {
    return { winner, winType: "jan", points: 4, monk: false };
  }
  return null;
}

// Returns { winner, winType, points, monk } or null
export function checkWin(gs) {
  // Jan: more bar checkers than accessible Q1 entry points
  const jan = checkJan(gs);
  if (jan) return jan;

  // Bear-off / gammon / monk
  function test(winner, loser) {
    if (gs.off[winner] !== 15) return null;
    const monk = gs.off[loser] === 0 && (
      winner === "white"
        ? gs.board[0] === -15
        : gs.board[23] === 15
    );
    const gammon = gs.off[loser] === 0;
    return {
      winner,
      winType: monk ? "monk" : gammon ? "gammon" : "normal",
      points:  monk ? 3 : gammon ? 2 : 1,
      monk,
    };
  }
  return test("white", "black") || test("black", "white") || null;
}
