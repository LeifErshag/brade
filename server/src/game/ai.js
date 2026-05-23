// ── AI opponent move selection ─────────────────────────────────────────────────
// Board convention: positive = white checkers, negative = black checkers.
// Both colors move counterclockwise (+1 mod 24 board-index direction).
// White home = board index 0 (point 1); Black home = board index 12 (point 13).
// All heuristics use path-space via idxToPath/pathToIdx.

import Anthropic from "@anthropic-ai/sdk";
import { getNextExpectimaxMove } from "./expectimax.js";
import { idxToPath, HUK_POS, Q1_LO, Q1_HI } from "./engine.js";

export const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
export const AI_DISPLAY  = { display_name: "Computer", avatar_url: null };

// One active Master call per room (prevents piling up on slow API)
const masterInProgress = new Set();

// ── Public entry point ────────────────────────────────────────────────────────

export async function pickMove(gs, color, legalMoves, difficulty, roomId) {
  if (legalMoves.length === 0) return null;
  switch (difficulty) {
    case "grandmaster": return getNextExpectimaxMove(gs, color, legalMoves, roomId);
    case "master":      return pickMoveMaster(gs, color, legalMoves, roomId);
    case "journeyman":  return pickMoveHeuristic(gs, color, legalMoves);
    default:            return pickMoveRandom(legalMoves);
  }
}

// ── Beginner: random ──────────────────────────────────────────────────────────

function pickMoveRandom(legalMoves) {
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

// ── Journeyman: heuristic scoring (path-space, Bräde priorities) ─────────────
//
// Priority ordering:
//   1. Bear off a checker
//   2. Re-enter from the bar (urgent)
//   3. Hit / burst an opponent checker
//   4. Build the huk (own path pos 11)
//   5. Build bands in the opponent's Q1 (block re-entry, jan threat)
//   6. Build bands elsewhere
//   7. Advance toward home (measured in path-space distance gained)
//   8. Penalise leaving a blot (especially deep / in dangerous zones)
//   9. Penalise stripping a point back to a blot

function scoreMove(gs, color, move) {
  let score = 0;

  // 1. Bearing off is always best
  if (move.to === "off") return 200;

  // 2. Re-entering from bar is urgent
  if (move.from === "bar") score += 100;

  const dest = move.to;
  const atDest = gs.board[dest]; // signed: +white, -black
  const oppColor = color === "white" ? "black" : "white";

  // Own count and opp count at destination
  const ownAtDest = color === "white" ? atDest : -atDest;
  const oppAtDest = color === "white" ? -atDest : atDest;

  // 3. Hit or burst opponent
  if (oppAtDest >= 1) score += oppAtDest === 1 ? 60 : 80; // burst > hit

  // 4. Building the huk (own path pos 11)
  const destPos = idxToPath(color, dest);
  if (destPos === HUK_POS) {
    if (ownAtDest === 1) score += 55; // completing huk band
    else if (ownAtDest === 0) score += 20; // going to huk as blot (accept)
    else score += 10; // already a band there
  }

  // 5. Bands in the opponent's Q1 (block re-entry)
  const destPosInOppFrame = idxToPath(oppColor, dest);
  if (destPosInOppFrame >= Q1_LO && destPosInOppFrame <= Q1_HI) {
    if (ownAtDest === 1) score += 45; // completing a blocking band
    else if (ownAtDest >= 2) score += 10; // already a band; small incremental
  }

  // 6. Band-building elsewhere
  if (destPos !== HUK_POS && !(destPosInOppFrame >= Q1_LO && destPosInOppFrame <= Q1_HI)) {
    if (ownAtDest === 1) score += 30; // completing any other band
    else if (ownAtDest >= 2) score += 8;
  }

  // 7. Advance toward home: path distance gained
  if (move.from !== "bar") {
    const srcPos = idxToPath(color, move.from);
    const distGained = destPos - srcPos; // positive = forward
    score += distGained * 2;
  }

  // 8. Blot penalty: landing alone (ownAtDest === 0, no hit)
  if (ownAtDest === 0 && oppAtDest === 0) {
    // Zone-based: lower path pos = farther from home = more exposed
    if (destPos <= 5) {
      score -= 50; // own Q1 — most dangerous (opponent passes through)
    } else if (destPos <= 11) {
      score -= 25; // Q2 including huk area
    } else if (destPos <= 17) {
      score -= 10; // Q3
    } else {
      score -= 3;  // Q4 — close to home, less dangerous
    }
  }

  // 9. Penalise stripping a point to a blot at the source
  if (move.from !== "bar") {
    const atSrc = gs.board[move.from];
    const ownAtSrc = color === "white" ? atSrc : -atSrc;
    if (ownAtSrc === 2) {
      // Moving one checker leaves a lone blot behind
      const srcPos = idxToPath(color, move.from);
      if (srcPos <= 5) score -= 35;
      else if (srcPos <= 11) score -= 20;
      else score -= 8;
    }
  }

  return score;
}

function pickMoveHeuristic(gs, color, legalMoves) {
  let best = legalMoves[0];
  let bestScore = -Infinity;
  for (const m of legalMoves) {
    const s = scoreMove(gs, color, m);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

// ── Master: Claude Haiku API ──────────────────────────────────────────────────

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

async function pickMoveMaster(gs, color, legalMoves, roomId) {
  // Fall back if another call is already running for this room
  if (masterInProgress.has(roomId)) {
    return pickMoveHeuristic(gs, color, legalMoves);
  }

  const client = getAnthropicClient();
  if (!client) {
    console.warn("ANTHROPIC_API_KEY not set — Master AI falling back to journeyman");
    return pickMoveHeuristic(gs, color, legalMoves);
  }

  masterInProgress.add(roomId);
  try {
    const boardStr = gs.board.join(",");
    const movesStr = legalMoves
      .map((m, i) => `${i}. from=${m.from} to=${m.to} die=${m.die}`)
      .join("\n");

    const oppColor = color === "white" ? "black" : "white";

    const prompt =
      `You are Master Jan, an expert Bräde (Swedish Tables / Svenskt Bräde) player, playing as ${color}.\n\n` +
      `GEOMETRY (critical — this is NOT standard backgammon):\n` +
      `- Both colors move the SAME counterclockwise direction around the board (+1 mod 24 index direction).\n` +
      `- Board is stored as indices 0-23: positive values = White checkers, negative = Black checkers.\n` +
      `- White starts at home index 0 (point 1); Black starts at home index 12 (point 13).\n` +
      `- All checkers travel a full lap counterclockwise, then bear off.\n` +
      `- Path-space (0-23, same for both colors): Q1/home=pos 0-5, Q2=pos 6-11, Q3=pos 12-17, Q4/bear-off=pos 18-23.\n` +
      `- Huk = path pos 11 (the junction of Q2). Making it a band (2+ own) is a key strategic goal.\n` +
      `- Bar re-entry: a checker enters at path pos = die - 1 (die 1 enters at home point).\n\n` +
      `BRÄDE WIN CONDITIONS (highest value first):\n` +
      `- Sprängjan (6 pts): win while opponent has more checkers on the bar than available re-entry points, and the winning move was a burst.\n` +
      `- Jan (4 pts): win while opponent has more bar checkers than available Q1 entry points.\n` +
      `- Kronspel / Trappspel / Uppspel (2-3 pts): vackert spel — bear off all 15 in a special pattern without losing any.\n` +
      `- Hemspel (1 pt): standard bear-off win.\n\n` +
      `STRATEGIC PRIORITIES (in order):\n` +
      `1. Bear off checkers when it advances the game.\n` +
      `2. Re-enter from the bar immediately — every turn on the bar is lost.\n` +
      `3. Hit or burst opponent blots to send them to the bar.\n` +
      `4. Build and hold the HUK (path pos 11) as a band.\n` +
      `5. Build 5+ consecutive bands across the opponent's first two path quarters (pos 0-11 in opp's frame) to threaten jan.\n` +
      `6. Build bands (2+ own checkers) anywhere, especially in opponent's Q1.\n` +
      `7. Advance checkers toward Q4 for bear-off, but never leave dangerous lone blots.\n\n` +
      `Current state:\n` +
      `Board [${boardStr}]  (index 0 = White home/point 1, index 12 = Black home/point 13)\n` +
      `${color} bar=${gs.bar[color]} off=${gs.off[color]} | ${oppColor} bar=${gs.bar[oppColor]} off=${gs.off[oppColor]}\n` +
      `Dice remaining: [${gs.dice.join(",")}]\n\n` +
      `Legal moves:\n${movesStr}\n\n` +
      `Reply with ONLY the move number (e.g. 0). No explanation.`;

    const response = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 8,
      messages:   [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.text?.trim() ?? "";
    const idx  = parseInt(text, 10);
    if (!isNaN(idx) && idx >= 0 && idx < legalMoves.length) return legalMoves[idx];
    return pickMoveHeuristic(gs, color, legalMoves);
  } catch (err) {
    console.error("Master AI API error:", err.message);
    return pickMoveHeuristic(gs, color, legalMoves);
  } finally {
    masterInProgress.delete(roomId);
  }
}
