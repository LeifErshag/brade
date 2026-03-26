// ── AI opponent move selection ─────────────────────────────────────────────────
// Board convention: positive = white checkers, negative = black checkers
// White moves DECREASING (index 23 → 0), Black moves INCREASING (0 → 23)

import Anthropic from "@anthropic-ai/sdk";

export const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
export const AI_DISPLAY  = { display_name: "Computer", avatar_url: null };

// One active Master call per room (prevents piling up on slow API)
const masterInProgress = new Set();

// ── Public entry point ────────────────────────────────────────────────────────

export async function pickMove(gs, color, legalMoves, difficulty, roomId) {
  if (legalMoves.length === 0) return null;
  switch (difficulty) {
    case "master":     return pickMoveMaster(gs, color, legalMoves, roomId);
    case "journeyman": return pickMoveHeuristic(gs, color, legalMoves);
    default:           return pickMoveRandom(legalMoves);
  }
}

// ── Beginner: random ──────────────────────────────────────────────────────────

function pickMoveRandom(legalMoves) {
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

// ── Journeyman: heuristic scoring ────────────────────────────────────────────
// Strategy: build stacks/points aggressively, keep own home board (first
// quarter, indices 0-5 for white / 18-23 for black) free of lone blots.

function scoreMove(gs, color, move) {
  let score = 0;

  // Bearing off is always best
  if (move.to === "off") return 200;

  // Re-entering from bar is urgent
  if (move.from === "bar") score += 100;

  const dest = move.to;
  const atDest = gs.board[dest]; // positive=white, negative=black, 0=empty

  // Hit an opponent blot
  const isOppBlot = color === "white" ? atDest === -1 : atDest === 1;
  if (isOppBlot) score += 60;

  // Stack-building: strongly reward landing on own checkers
  const ownCountAtDest = color === "white" ? atDest : -atDest;
  if (ownCountAtDest === 1) score += 50;  // completing a point (2nd checker)
  if (ownCountAtDest >= 2) score += 20;   // extending a stack (3rd+)

  // Reward advancement toward home
  if (move.from !== "bar") {
    const pips = color === "white" ? (move.from - dest) : (dest - move.from);
    score += pips * 2;
  }

  // Penalise landing as a blot (lone checker) anywhere
  if (atDest === 0) {
    const inOwnHome  = color === "white" ? dest <= 5  : dest >= 18;
    const inOppHome  = color === "white" ? dest >= 18 : dest <= 5;

    if (inOwnHome)  score -= 50;  // heavy: blot inside own home board
    else if (inOppHome) score -= 25;  // moderate: blot deep in enemy home
    else             score -= 10;  // small general blot penalty
  }

  // Penalise stripping a point to a blot at the source
  if (move.from !== "bar") {
    const atSrc = gs.board[move.from];
    const ownCountAtSrc = color === "white" ? atSrc : -atSrc;
    if (ownCountAtSrc === 2) {
      // Moving one checker leaves a lone blot behind
      const srcInOwnHome = color === "white" ? move.from <= 5 : move.from >= 18;
      score -= srcInOwnHome ? 35 : 8;
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

    const prompt =
      `You are Master Jan, an expert Bräde (Swedish Backgammon) player, playing as ${color}.\n` +
      `Board indices 0-23 (positive=White checkers, negative=Black checkers): [${boardStr}]\n` +
      `${color} bar=${gs.bar[color]} off=${gs.off[color]}  ` +
      `dice remaining=[${gs.dice.join(",")}]\n\n` +
      `Your strategic priorities (in order):\n` +
      `1. Bear off checkers when possible.\n` +
      `2. Re-enter from the bar immediately.\n` +
      `3. Hit opponent blots to send them to the bar.\n` +
      `4. Build and extend STACKS (points with 2+ own checkers) — never leave lone blots if avoidable.\n` +
      `5. Keep your HOME BOARD (indices 0-5 for White, 18-23 for Black) free of lone blots — a blot there is a serious liability.\n` +
      `6. Make a closed board (6 consecutive owned points) if the opportunity arises.\n` +
      `7. Advance checkers toward home, but never at the cost of leaving dangerous blots.\n\n` +
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
