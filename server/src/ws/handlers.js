import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";
import { send, broadcastToRoom, broadcastState, sendToUser, rooms } from "./server.js";
import { initGame, rollDice, getLegalMoves, applyMove, checkWin, checkJanOnPass } from "../game/engine.js";
import { computeElo } from "../game/elo.js";
import { pickMove } from "../game/ai.js";
import { clearExpectimaxCache } from "../game/expectimax.js";
import { advanceTournament } from "../game/tournament.js";
import { compareMatch } from "../game/scoring.js";
import { withRoomLock } from "./roomLock.js";

// ── Disconnect forfeit timers ─────────────────────────────────────────────────
// key: `${roomId}:${color}` → { timer, token }. Each schedule gets a fresh
// token object. The entry stays in the map after the timer fires, until its
// locked section has run, so that a reconnect's cancel (which deletes the
// entry) or a newer schedule (which replaces it) still invalidates a forfeit
// that has already fired and is queued for the room's lock.
const forfeitTimers = new Map();

export function scheduleDisconnectForfeit(roomId, color, userId) {
  const key = `${roomId}:${color}`;
  clearTimeout(forfeitTimers.get(key)?.timer);
  const token = {};
  const timer = setTimeout(async () => {
    // Caught here: an unhandled rejection from a timer would kill the process.
    try {
      await withRoomLock(roomId, () => forfeitIfStillDisconnected(roomId, userId, key, token));
    } catch (err) {
      console.error(`Disconnect forfeit error [${roomId}]:`, err);
    }
  }, 60_000);
  forfeitTimers.set(key, { timer, token });
}

// Runs under the room's lock. Once the timer has fired, clearTimeout can no
// longer stop it, and this section may have queued behind a reconnect (or the
// close handler may have scheduled the timer after a quick reconnect had
// already registered). So the decision is made here, atomically with the
// resign:
// - if this disconnect's token is no longer current, a reconnect cancelled it
//   or a later disconnect superseded it (that one forfeits on its own timer);
// - if the player has a registered connection in this room now, they are back.
// In either case nothing is forfeited. Calls handleRoomMessage directly, not
// handleMessage, because this section already holds the lock (DEADLOCK RULE).
async function forfeitIfStillDisconnected(roomId, userId, key, token) {
  if (forfeitTimers.get(key)?.token !== token) return;
  forfeitTimers.delete(key);
  const reconnected = [...(rooms.get(roomId) ?? [])].some(c => c.userId === userId);
  if (reconnected) return;
  const raw = await getRedis().get(keys.room(roomId));
  if (!raw) return;
  if (JSON.parse(raw).status !== "playing") return;
  // Force a resign for the disconnected player
  await handleRoomMessage({ msg: { type: "RESIGN", forfeit: true }, userId, roomId, ws: null });
}

export function cancelDisconnectForfeit(roomId, color) {
  const key = `${roomId}:${color}`;
  clearTimeout(forfeitTimers.get(key)?.timer);
  forfeitTimers.delete(key);
}

// Test helper: number of pending (scheduled or fired but not yet run) forfeits.
export function pendingForfeitCount() {
  return forfeitTimers.size;
}

// ── Main message handler ──────────────────────────────────────────────────────
// Each message is processed under the room's lock (see roomLock.js), so its
// read-modify-write of the room state cannot interleave with another writer.
// Nothing reachable from handleRoomMessage may take the same room's lock and
// await it; triggerAiTurn is started fire-and-forget and just queues behind.
export function handleMessage(args) {
  return withRoomLock(args.roomId, () => handleRoomMessage(args));
}

async function handleRoomMessage({ msg, userId, roomId, ws }) {
  const redis   = getRedis();
  const rawRoom = await redis.get(keys.room(roomId));
  if (!rawRoom) { ws && send(ws, { type: "ERROR", message: "Room not found" }); return; }

  const room  = JSON.parse(rawRoom);
  const color = room.players.white === userId ? "white"
              : room.players.black === userId ? "black"
              : null; // spectator

  switch (msg.type) {

    // ── Lobby ──────────────────────────────────────────────────────────────

    case "PLAYER_READY": {
      if (!color) { ws && send(ws, { type: "ERROR", message: "Not a player" }); break; }
      room.ready[color] = !room.ready[color];
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      break;
    }

    case "START_GAME": {
      // Only a lobby can be started. Tutorial and AI rooms are created already
      // playing (and tutorial rooms have no games row), so reject them up front.
      if (room.isTutorial || room.status !== "waiting") {
        ws && send(ws, { type: "ERROR", message: "Game cannot be started" }); break;
      }
      if (room.createdBy !== userId) {
        ws && send(ws, { type: "ERROR", message: "Only the host can start" }); break;
      }
      if (!room.players.black) {
        ws && send(ws, { type: "ERROR", message: "Waiting for opponent" }); break;
      }
      if (!room.ready.white || !room.ready.black) {
        ws && send(ws, { type: "ERROR", message: "Both players must be ready" }); break;
      }

      let wElo, bElo;
      if (room.hasGuest) {
        // Guest game: only look up the host's ELO; guest has no DB record
        const { rows: [whiteRow] } = await query(
          `SELECT elo FROM users WHERE id = $1`, [room.players.white]
        );
        wElo = whiteRow?.elo ?? 1200;
        bElo = 1200;
        // Don't update games table with black_id — guest has no DB user row
      } else {
        // Fetch ELOs for both players
        const { rows: players } = await query(
          `SELECT id, elo FROM users WHERE id = ANY($1::uuid[])`,
          [[room.players.white, room.players.black]]
        );
        const eloMap = Object.fromEntries(players.map(p => [p.id, p.elo]));
        wElo = eloMap[room.players.white] ?? 1200;
        bElo = eloMap[room.players.black] ?? 1200;

        // Persist black player + starting ELOs into the games record
        await query(
          `UPDATE games
              SET black_id = $2, white_elo_before = $3, black_elo_before = $4
            WHERE room_id = $1`,
          [roomId, room.players.black, wElo, bElo]
        );
      }

      const { rows: [gameRow] } = await query(
        `SELECT id FROM games WHERE room_id = $1`, [roomId]
      );
      if (!gameRow) {
        console.error(`START_GAME: no games row for room ${roomId}`);
        ws && send(ws, { type: "ERROR", message: "Game record not found" }); break;
      }

      const gs       = initGame();
      gs.legalMoves  = []; // will be populated after first ROLL

      // §1 Teka: each player rolls one die; lower die starts; tie → re-roll.
      let tekaWhite, tekaBlack;
      do {
        tekaWhite = Math.ceil(Math.random() * 6);
        tekaBlack = Math.ceil(Math.random() * 6);
      } while (tekaWhite === tekaBlack);
      const tekaStarter = tekaWhite < tekaBlack ? "white" : "black";
      gs.turn = tekaStarter;

      room.status      = "playing";
      room.score       = { white: 0, black: 0 };
      room.gameResults = []; // per-game results for §14 tie-break
      room.gameNum     = 1;
      room.gameDbId    = gameRow.id;
      room.gameState   = gs;
      room.ready       = { white: false, black: false };
      room.teka        = { white: tekaWhite, black: tekaBlack, starter: tekaStarter };

      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      break;
    }

    case "INVITE_PLAYER": {
      const targetId = msg.targetUserId;
      if (!targetId || typeof targetId !== "string") {
        ws && send(ws, { type: "ERROR", message: "Invalid targetUserId" }); break;
      }
      const fromName  = color ? room.playerInfo?.[color]?.display_name : null;
      const inviteUrl = `${process.env.CLIENT_ORIGIN}/game/${roomId}`;
      sendToUser(targetId, {
        type: "INVITE_RECEIVED", fromName: fromName ?? "Someone", roomId, inviteUrl,
      });
      break;
    }

    // ── In-game ────────────────────────────────────────────────────────────

    case "ROLL": {
      if (room.status !== "playing") break;
      if (!color) { ws && send(ws, { type: "ERROR", message: "Not a player" }); break; }
      const gs = room.gameState;
      if (gs.phase !== "rolling") { ws && send(ws, { type: "ERROR", message: "Not rolling phase" }); break; }
      if (gs.turn !== color)      { ws && send(ws, { type: "ERROR", message: "Not your turn" }); break; }

      const dice       = rollDice();
      gs.dice          = dice.slice();
      gs.rolledDice    = dice.slice();
      gs.phase         = "moving";
      gs.legalMoves    = getLegalMoves(gs, color);

      if (gs.legalMoves.length === 0) {
        // No moves. If the player is closed out on the bar, that's a jan (§10) —
        // checked here because it is the stuck player's own turn, so the post-move
        // checkWin never sees it.
        const janResult = checkJanOnPass(gs);   // gs.turn still === color
        if (janResult) {
          room.gameState = gs;
          await handleGameOver(redis, roomId, room, janResult);
          return;
        }
        // Otherwise auto pass.
        gs.phase      = "rolling";
        gs.turn       = opp(color);
        gs.dice       = [];
        gs.legalMoves = [];
        broadcastToRoom(roomId, { type: "NO_MOVES", color, dice });
      }

      room.gameState = gs;
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);

      // Trigger AI if turn switched to it
      if (room.isAi && gs.turn === "black" && gs.phase === "rolling") {
        triggerAiTurn(roomId, room.aiDifficulty).catch(e => console.error("AI turn error:", e));
      }
      break;
    }

    case "MOVE": {
      if (room.status !== "playing") break;
      if (!color) { ws && send(ws, { type: "ERROR", message: "Not a player" }); break; }
      const gs = room.gameState;
      if (gs.phase !== "moving") { ws && send(ws, { type: "ERROR", message: "Not moving phase" }); break; }
      if (gs.turn  !== color)    { ws && send(ws, { type: "ERROR", message: "Not your turn" }); break; }

      const { from, to, die } = msg;
      const legal = gs.legalMoves.find(m => m.from === from && m.to === to && m.die === die);
      if (!legal) { ws && send(ws, { type: "ERROR", message: "Illegal move" }); break; }

      // Capture whether the move burst a band in the mover's first quarter.
      const { gs: newGs, burstFirstQuarter } = applyMove(gs, color, from, to, die);

      logMove(room, newGs.moveSeq, color, from, to, die);

      // Only a first-quarter burst can make a sprängjan (§11 p.7).
      const result = checkWin(newGs, burstFirstQuarter);
      if (result) {
        room.gameState = newGs;
        await handleGameOver(redis, roomId, room, result);
        return;
      }

      // Determine if the mover can continue, otherwise the turn passes.
      let passing = false;
      if (newGs.dice.length === 0) {
        passing = true;
      } else {
        newGs.legalMoves = getLegalMoves(newGs, color);
        if (newGs.legalMoves.length === 0) passing = true;
      }

      if (passing) {
        // The mover is done. If they're still closed out on the bar (e.g. entered
        // some but not all), that's a jan (§10) against the mover.
        const janResult = checkJanOnPass(newGs);   // newGs.turn still === color
        if (janResult) {
          room.gameState = newGs;
          await handleGameOver(redis, roomId, room, janResult);
          return;
        }
        newGs.phase      = "rolling";
        newGs.turn       = opp(color);
        newGs.dice       = [];
        newGs.legalMoves = [];
      }

      room.gameState = newGs;
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);

      // Trigger AI if turn switched to it
      if (room.isAi && newGs.turn === "black" && newGs.phase === "rolling") {
        triggerAiTurn(roomId, room.aiDifficulty).catch(e => console.error("AI turn error:", e));
      }
      break;
    }

    case "PASS": {
      if (room.status !== "playing") break;
      if (!color) break;
      const gs = room.gameState;
      if (gs.phase !== "moving") { ws && send(ws, { type: "ERROR", message: "Not moving phase" }); break; }
      if (gs.turn !== color) { ws && send(ws, { type: "ERROR", message: "Not your turn" }); break; }
      if (gs.legalMoves.length > 0) { ws && send(ws, { type: "ERROR", message: "You have legal moves" }); break; }

      // A pass while closed out on the bar is a jan (§10) against the passer.
      const janResult = checkJanOnPass(gs);   // gs.turn still === color
      if (janResult) {
        room.gameState = gs;
        await handleGameOver(redis, roomId, room, janResult);
        return;
      }

      gs.phase      = "rolling";
      gs.turn       = opp(color);
      gs.dice       = [];
      gs.legalMoves = [];
      room.gameState = gs;
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);

      // Trigger AI if turn switched to it
      if (room.isAi && gs.turn === "black" && gs.phase === "rolling") {
        triggerAiTurn(roomId, room.aiDifficulty).catch(e => console.error("AI turn error:", e));
      }
      break;
    }

    case "RESIGN": {
      if (room.status !== "playing") break;
      if (!color) break;
      const winner = opp(color);
      // Resign ends the whole match immediately.
      const result = { winner, winType: "resign", points: 1, monk: false };
      await handleGameOver(redis, roomId, room, result, true /* forceMatchOver */);
      break;
    }

    default:
      ws && send(ws, { type: "ERROR", message: "Unknown message type" });
  }
}

// ── AI turn automation ────────────────────────────────────────────────────────

// Guard: at most one AI turn loop runs per room. A trigger that arrives while
// a turn is running is not dropped: it sets `rerun`, and the running loop
// plays another turn once the current one finishes (issue #57). That covers
// the AI losing a non-final game during its own turn: handleGameOver starts
// the next game with black to roll and triggers the AI from inside the
// running turn. Each rerun re-checks the room state (aiRoll), so a redundant
// trigger only costs one thinking delay and writes nothing. Reruns happen
// only on explicit triggers, so this cannot loop by itself.
const aiTurns = new Map(); // roomId → { rerun: boolean, aiDifficulty }

export async function triggerAiTurn(roomId, aiDifficulty) {
  const running = aiTurns.get(roomId);
  if (running) {
    running.rerun        = true;
    running.aiDifficulty = aiDifficulty;
    return;
  }
  const turn = { rerun: false, aiDifficulty };
  aiTurns.set(roomId, turn);
  try {
    do {
      turn.rerun = false;
      await _triggerAiTurn(roomId, turn.aiDifficulty);
    } while (turn.rerun);
  } finally {
    aiTurns.delete(roomId);
  }
}

// The AI turn is split into short locked sections (the roll, then one section
// per move) so the "thinking" delays run without holding the room's lock.
// Each section re-reads the room and checks it is still the AI's turn in the
// expected phase, because other writers (e.g. a human RESIGN) may have run
// during a delay.
async function _triggerAiTurn(roomId, aiDifficulty) {
  // Brief "thinking" delay
  await sleep(700 + Math.random() * 800);

  const redis  = getRedis();
  const rolled = await withRoomLock(roomId, () => aiRoll(redis, roomId));
  if (!rolled) return;

  // Play moves one at a time with a small visual delay between each
  for (;;) {
    await sleep(500);
    const more = await withRoomLock(roomId, () => aiMove(redis, roomId, aiDifficulty));
    if (!more) return;
  }
}

// Locked section: roll for the AI. Returns true when the AI has moves to play.
async function aiRoll(redis, roomId) {
  const room = await loadRoom(redis, roomId);
  if (!room || room.status !== "playing") return false;

  const gs = room.gameState;
  if (gs.turn !== "black" || gs.phase !== "rolling") return false; // sanity check

  // Roll dice
  const dice    = rollDice();
  gs.dice       = dice.slice();
  gs.rolledDice = dice.slice();
  gs.phase      = "moving";
  gs.legalMoves = getLegalMoves(gs, "black");

  if (gs.legalMoves.length === 0) {
    // No moves. If the AI is closed out on the bar, that's a jan (§10) for white.
    const janResult = checkJanOnPass(gs);   // gs.turn still === "black"
    if (janResult) {
      room.gameState = gs;
      await handleGameOver(redis, roomId, room, janResult);
      return false;
    }
    // Otherwise pass.
    gs.phase      = "rolling";
    gs.turn       = "white";
    gs.dice       = [];
    gs.legalMoves = [];
    room.gameState = gs;
    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    return false;
  }

  room.gameState = gs;
  await saveRoom(redis, roomId, room);
  broadcastState(roomId, room);
  return true;
}

// Locked section: play one AI move. Returns true when the AI has more to play.
async function aiMove(redis, roomId, aiDifficulty) {
  const room = await loadRoom(redis, roomId);
  if (!room || room.status !== "playing") return false;

  const gs = room.gameState;
  if (gs.turn !== "black" || gs.phase !== "moving") return false;
  if (gs.legalMoves.length === 0 || gs.dice.length === 0) return false;

  const move = await pickMove(gs, "black", gs.legalMoves, aiDifficulty, roomId);
  if (!move) return false;

  // Capture whether the move burst a band in the mover's first quarter.
  const { gs: newGs, burstFirstQuarter } = applyMove(gs, "black", move.from, move.to, move.die);

  logMove(room, newGs.moveSeq, "black", move.from, move.to, move.die);

  // Only a first-quarter burst can make a sprängjan (§11 p.7).
  const result = checkWin(newGs, burstFirstQuarter);
  if (result) {
    room.gameState = newGs;
    await handleGameOver(redis, roomId, room, result);
    return false;
  }

  let passing = false;
  if (newGs.dice.length === 0) {
    passing = true;
  } else {
    newGs.legalMoves = getLegalMoves(newGs, "black");
    if (newGs.legalMoves.length === 0) passing = true;
  }

  if (passing) {
    // AI is done; if it's still closed out on the bar, that's a jan (§10) for white.
    const janResult = checkJanOnPass(newGs);   // newGs.turn still === "black"
    if (janResult) {
      room.gameState = newGs;
      await handleGameOver(redis, roomId, room, janResult);
      return false;
    }
    newGs.phase      = "rolling";
    newGs.turn       = "white";
    newGs.dice       = [];
    newGs.legalMoves = [];
  }

  room.gameState = newGs;
  await saveRoom(redis, roomId, room);
  broadcastState(roomId, room);
  return !passing;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function opp(color) { return color === "white" ? "black" : "white"; }

// Log a move to the DB (best-effort, never blocks the game). Tutorial games
// have no `games` row, so their moves are never written.
function logMove(room, seq, color, from, to, die) {
  if (room.isTutorial || !room.gameDbId) return;
  const fromPt = from === "bar" ? "bar" : String(from + 1);
  const toPt   = to   === "off" ? "off" : String(to + 1);
  query(
    `INSERT INTO moves (game_id, seq, color, from_pt, to_pt, die)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [room.gameDbId, seq, color, fromPt, toPt, die]
  ).catch(err => console.error("Move log error:", err.message));
}

async function loadRoom(redis, roomId) {
  const raw = await redis.get(keys.room(roomId));
  return raw ? JSON.parse(raw) : null;
}

async function saveRoom(redis, roomId, room) {
  await redis.set(keys.room(roomId), JSON.stringify(room), "EX", TTL.room);
}

/**
 * Determine the match winner from cumulative scores and per-game results.
 * Returns "white" | "black" | null (null only if truly identical, which we
 * then fall back to the last-game winner).
 *
 * @param {object} score       { white: number, black: number }
 * @param {Array}  gameResults [{ winner, winType, points }, ...]
 * @param {string} lastWinner  winner of the most recent game (final fallback)
 */
function resolveMatchWinner(score, gameResults, lastWinner) {
  // Split per-game winTypes by which player won each game.
  const wTypes = gameResults.filter(r => r.winner === "white").map(r => r.winType);
  const bTypes = gameResults.filter(r => r.winner === "black").map(r => r.winType);

  const verdict = compareMatch(wTypes, bTypes);
  if (verdict === "a") return "white";
  if (verdict === "b") return "black";
  // Truly identical — fall back to last-game winner
  return lastWinner;
}

/**
 * handleGameOver — called whenever a game ends (win or resign).
 *
 * Change 2: match ends after `room.matchLength` games (fixed count).
 * Cumulative points decide the match winner; tie-break via §14 winRank.
 *
 * @param {boolean} [forceMatchOver=false]  true for RESIGN (ends match immediately)
 */
async function handleGameOver(redis, roomId, room, result, forceMatchOver = false) {
  clearExpectimaxCache(roomId);
  const { winner, winType, points, monk } = result;

  room.score[winner] += points ?? 1;

  // Accumulate per-game result for §14 tie-break
  if (!room.gameResults) room.gameResults = [];
  room.gameResults.push({ winner, winType, points: points ?? 1 });

  // ── Tutorial game: never rated. No games row, no ELO, no wins/losses. ──
  // Checked before anything touches the DB, and decided by the server-set room
  // flag, so a client cannot get a tutorial game recorded.
  if (room.isTutorial) {
    room.status      = "finished";
    room.matchResult = { winner, winType, score: room.score, unrated: true };
    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    broadcastToRoom(roomId, { type: "MATCH_OVER", winner, score: room.score, winType });
    return;
  }

  // Change 2: match is over after matchLength games (or on forced resign)
  const matchOver = forceMatchOver || (room.gameNum >= room.matchLength);

  if (matchOver) {
    // Determine match winner. A forced end (RESIGN/forfeit) always goes to the
    // non-resigner (`winner`), regardless of cumulative points; otherwise the
    // match winner is decided by total points with the §14 tie-break.
    const matchWinner = forceMatchOver
      ? winner
      : resolveMatchWinner(room.score, room.gameResults, winner);
    const matchLoser  = opp(matchWinner);

    // ── Guest game: skip ELO, record result without guest's user row ─────
    if (room.hasGuest) {
      // Default guestColor = "black" preserves earlier host-vs-guest behaviour
      const guestColor    = room.guestColor ?? "black";
      const nonGuestColor = guestColor === "white" ? "black" : "white";
      const winnerIsGuest = matchWinner === guestColor;
      // winner_id must reference an existing user — null if guest won
      await query(
        `UPDATE games
            SET winner_id   = $2,
                win_type    = $3,
                monk        = $4,
                white_score = $5,
                black_score = $6,
                ended_at    = now()
          WHERE room_id = $1`,
        [roomId, winnerIsGuest ? null : room.players[nonGuestColor], winType, monk ?? false,
         room.score.white, room.score.black]
      );
      room.status      = "finished";
      room.matchResult = { winner: matchWinner, winType, score: room.score };
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      broadcastToRoom(roomId, { type: "MATCH_OVER", winner: matchWinner, score: room.score, winType });
      return;
    }

    // ── Regular / AI game: compute ELO ───────────────────────────────────
    let wElo, bElo;

    if (room.isAi) {
      const { rows: [humanRow] } = await query(
        `SELECT elo FROM users WHERE id = $1`, [room.players.white]
      );
      wElo = humanRow?.elo ?? 1200;
      bElo = 1200; // fixed AI ELO
    } else {
      const { rows: players } = await query(
        `SELECT id, elo FROM users WHERE id = ANY($1::uuid[])`,
        [[room.players.white, room.players.black]]
      );
      const eloMap = Object.fromEntries(players.map(p => [p.id, p.elo]));
      wElo = eloMap[room.players.white] ?? 1200;
      bElo = eloMap[room.players.black] ?? 1200;
    }

    // ELO is based on match winner (not necessarily last-game winner)
    const eloResult = computeElo(wElo, bElo, matchWinner === "white" ? 1 : 0);

    // Persist game result (last game's winType/monk are written to the games row)
    await query(
      `UPDATE games
          SET winner_id       = $2,
              win_type        = $3,
              monk            = $4,
              white_score     = $5,
              black_score     = $6,
              white_elo_after = $7,
              black_elo_after = $8,
              ended_at        = now()
        WHERE room_id = $1`,
      [roomId, room.players[matchWinner], winType, monk ?? false,
       room.score.white, room.score.black,
       eloResult.whiteAfter, eloResult.blackAfter]
    );

    // Update player stats — skip the AI user
    if (!room.isAi || matchWinner === "white") {
      await query(
        `UPDATE users SET elo = $2, wins = wins + 1 WHERE id = $1`,
        [room.players[matchWinner], eloResult[matchWinner === "white" ? "whiteAfter" : "blackAfter"]]
      );
    }
    if (!room.isAi || matchLoser === "white") {
      await query(
        `UPDATE users SET elo = $2, losses = losses + 1 WHERE id = $1`,
        [room.players[matchLoser], eloResult[matchLoser === "white" ? "whiteAfter" : "blackAfter"]]
      );
    }

    room.status      = "finished";
    room.matchResult = {
      winner:        matchWinner,
      winType,
      score:         room.score,
      whiteEloAfter: eloResult.whiteAfter,
      blackEloAfter: eloResult.blackAfter,
    };

    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    broadcastToRoom(roomId, {
      type:    "MATCH_OVER",
      winner:  matchWinner,
      score:   room.score,
      winType,
    });

    // Advance tournament bracket if this was a tournament match
    if (room.tournamentId && room.tournamentMatchId) {
      const winnerId = room.players[matchWinner];
      const loserId  = room.players[matchLoser];
      advanceTournament(room.tournamentId, room.tournamentMatchId, winnerId, loserId)
        .catch(err => console.error("Tournament advance error:", err.message));
    }
  } else {
    // Start next game in match — loser goes first (§1)
    room.gameNum++;
    const gs      = initGame();
    gs.turn       = opp(winner); // loser of just-finished game starts next
    gs.legalMoves = [];
    room.gameState = gs;

    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    broadcastToRoom(roomId, {
      type:   "GAME_OVER",
      winner,
      winType,
      score:  room.score,
    });

    if (room.isAi && gs.turn === "black" && gs.phase === "rolling") {
      triggerAiTurn(roomId, room.aiDifficulty).catch(e => console.error("AI turn error:", e));
    }
  }
}
