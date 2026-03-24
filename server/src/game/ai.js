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

function scoreMove(gs, color, move) {
  let score = 0;

  // Bearing off is always best
  if (move.to === "off") return 200;

  // Re-entering from bar is urgent — handle first
  if (move.from === "bar") score += 100;

  const atDest = move.to === "off" ? null : gs.board[move.to];

  if (atDest !== null) {
    // Hit an opponent blot
    const oppBlot = color === "white" ? atDest === -1 : atDest === 1;
    if (oppBlot) score += 60;

    // Build a point (place 2nd checker)
    const alreadyOwn = color === "white" ? atDest >= 1 : atDest <= -1;
    if (alreadyOwn) score += 25;
  }

  // Reward advancement (pips moved toward home)
  if (move.from !== "bar" && move.to !== "off") {
    const pips = color === "white" ? (move.from - move.to) : (move.to - move.from);
    score += pips * 3;
  }

  // Penalise leaving a blot in the opponent's home zone
  if (move.from !== "bar" && move.to !== "off" && atDest !== null) {
    const ownAtDest = color === "white" ? atDest : -atDest;
    if (ownAtDest === 0) {
      // We're placing a lone checker — exposed
      if (color === "white" && move.to > 12) score -= 20;
      if (color === "black" && move.to < 11) score -= 20;
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
      `You are playing Bräde (Swedish Backgammon) as ${color}.\n` +
      `Board indices 0-23 (positive=White, negative=Black): [${boardStr}]\n` +
      `${color} bar=${gs.bar[color]} off=${gs.off[color]}  ` +
      `dice remaining=[${gs.dice.join(",")}]\n\n` +
      `Legal moves:\n${movesStr}\n\n` +
      `Reply with just the move number (e.g. 0). Choose the strongest positional move.`;

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
