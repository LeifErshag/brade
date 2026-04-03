import { getRedis, keys, TTL } from "../db/redis.js";
import { query } from "../db/postgres.js";
import { send, broadcastToRoom, broadcastState, sendToUser } from "./server.js";
import { initGame, rollDice, getLegalMoves, applyMove, checkWin } from "../game/engine.js";
import { computeElo } from "../game/elo.js";
import { pickMove } from "../game/ai.js";
import { clearExpectimaxCache } from "../game/expectimax.js";
import { advanceTournament } from "../game/tournament.js";

// ── Disconnect forfeit timers ─────────────────────────────────────────────────
const forfeitTimers = new Map(); // key: `${roomId}:${color}`

export function scheduleDisconnectForfeit(roomId, color, userId) {
  const key = `${roomId}:${color}`;
  clearTimeout(forfeitTimers.get(key));
  const timer = setTimeout(async () => {
    forfeitTimers.delete(key);
    const redis  = getRedis();
    const raw    = await redis.get(keys.room(roomId));
    if (!raw) return;
    const room = JSON.parse(raw);
    if (room.status !== "playing") return;
    // Force a resign for the disconnected player
    await handleMessage({ msg: { type: "RESIGN", forfeit: true }, userId, roomId, ws: null });
  }, 60_000);
  forfeitTimers.set(key, timer);
}

export function cancelDisconnectForfeit(roomId, color) {
  const key = `${roomId}:${color}`;
  clearTimeout(forfeitTimers.get(key));
  forfeitTimers.delete(key);
}

// ── Main message handler ──────────────────────────────────────────────────────
export async function handleMessage({ msg, userId, roomId, ws }) {
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

      const gs       = initGame();
      gs.legalMoves  = []; // will be populated after first ROLL

      room.status    = "playing";
      room.score     = { white: 0, black: 0 };
      room.gameNum   = 1;
      room.gameDbId  = gameRow.id;
      room.gameState = gs;
      room.ready     = { white: false, black: false };

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
        // No moves — auto pass
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

      const { gs: newGs } = applyMove(gs, color, from, to, die);

      // Log move to DB (best-effort, don't block on failure)
      const fromPt = from === "bar" ? "bar" : String(from + 1);
      const toPt   = to   === "off" ? "off" : String(to + 1);
      query(
        `INSERT INTO moves (game_id, seq, color, from_pt, to_pt, die)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [room.gameDbId, newGs.moveSeq, color, fromPt, toPt, die]
      ).catch(err => console.error("Move log error:", err.message));

      // Check win
      const result = checkWin(newGs);
      if (result) {
        room.gameState = newGs;
        await handleGameOver(redis, roomId, room, result);
        return;
      }

      // Determine if turn should switch
      if (newGs.dice.length === 0) {
        newGs.phase      = "rolling";
        newGs.turn       = opp(color);
        newGs.legalMoves = [];
      } else {
        newGs.legalMoves = getLegalMoves(newGs, color);
        if (newGs.legalMoves.length === 0) {
          newGs.phase      = "rolling";
          newGs.turn       = opp(color);
          newGs.dice       = [];
          newGs.legalMoves = [];
        }
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
      if (gs.turn !== color) { ws && send(ws, { type: "ERROR", message: "Not your turn" }); break; }
      if (gs.legalMoves.length > 0) { ws && send(ws, { type: "ERROR", message: "You have legal moves" }); break; }

      gs.phase      = "rolling";
      gs.turn       = opp(color);
      gs.dice       = [];
      gs.legalMoves = [];
      room.gameState = gs;
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      break;
    }

    case "RESIGN": {
      if (room.status !== "playing") break;
      if (!color) break;
      const winner = opp(color);
      const result = { winner, winType: "resign", points: 1, monk: false };
      await handleGameOver(redis, roomId, room, result);
      break;
    }

    default:
      ws && send(ws, { type: "ERROR", message: "Unknown message type" });
  }
}

// ── AI turn automation ────────────────────────────────────────────────────────

async function triggerAiTurn(roomId, aiDifficulty) {
  // Brief "thinking" delay
  await sleep(700 + Math.random() * 800);

  const redis = getRedis();
  const raw   = await redis.get(keys.room(roomId));
  if (!raw) return;
  let room = JSON.parse(raw);
  if (room.status !== "playing") return;

  let gs = room.gameState;
  if (gs.turn !== "black" || gs.phase !== "rolling") return; // sanity check

  // Roll dice
  const dice    = rollDice();
  gs.dice       = dice.slice();
  gs.rolledDice = dice.slice();
  gs.phase      = "moving";
  gs.legalMoves = getLegalMoves(gs, "black");

  if (gs.legalMoves.length === 0) {
    // No moves — pass
    gs.phase      = "rolling";
    gs.turn       = "white";
    gs.dice       = [];
    gs.legalMoves = [];
    room.gameState = gs;
    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    return;
  }

  room.gameState = gs;
  await saveRoom(redis, roomId, room);
  broadcastState(roomId, room);

  // Play moves one at a time with a small visual delay between each
  while (gs.legalMoves.length > 0 && gs.dice.length > 0) {
    await sleep(500);

    const move = await pickMove(gs, "black", gs.legalMoves, aiDifficulty, roomId);
    if (!move) break;

    const { gs: newGs } = applyMove(gs, "black", move.from, move.to, move.die);

    // Log to DB (best-effort)
    const fromPt = move.from === "bar" ? "bar" : String(move.from + 1);
    const toPt   = move.to   === "off" ? "off" : String(move.to   + 1);
    query(
      `INSERT INTO moves (game_id, seq, color, from_pt, to_pt, die)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [room.gameDbId, newGs.moveSeq, "black", fromPt, toPt, move.die]
    ).catch(err => console.error("AI move log error:", err.message));

    // Check win
    const result = checkWin(newGs);
    if (result) {
      room.gameState = newGs;
      await handleGameOver(redis, roomId, room, result);
      return;
    }

    if (newGs.dice.length === 0) {
      newGs.phase      = "rolling";
      newGs.turn       = "white";
      newGs.legalMoves = [];
    } else {
      newGs.legalMoves = getLegalMoves(newGs, "black");
      if (newGs.legalMoves.length === 0) {
        newGs.phase      = "rolling";
        newGs.turn       = "white";
        newGs.dice       = [];
        newGs.legalMoves = [];
      }
    }

    gs = newGs;
    room.gameState = gs;
    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function opp(color) { return color === "white" ? "black" : "white"; }

async function saveRoom(redis, roomId, room) {
  await redis.set(keys.room(roomId), JSON.stringify(room), "EX", TTL.room);
}

async function handleGameOver(redis, roomId, room, result) {
  clearExpectimaxCache(roomId);
  const { winner, winType, points, monk } = result;
  room.score[winner] += points ?? 1;

  const needed = Math.ceil(room.matchLength / 2);
  const matchOver = room.score[winner] >= needed;

  if (matchOver) {
    // ── Guest game: skip ELO, record result without black_id ─────────────
    if (room.hasGuest) {
      // winner_id must reference an existing user — null if guest won
      const winnerIsGuest = winner === "black";
      await query(
        `UPDATE games
            SET winner_id   = $2,
                win_type    = $3,
                monk        = $4,
                white_score = $5,
                black_score = $6,
                ended_at    = now()
          WHERE room_id = $1`,
        [roomId, winnerIsGuest ? null : room.players.white, winType, monk ?? false,
         room.score.white, room.score.black]
      );
      room.status      = "finished";
      room.matchResult = { winner, winType, score: room.score };
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      broadcastToRoom(roomId, { type: "MATCH_OVER", winner, score: room.score, winType });
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

    const eloResult = computeElo(wElo, bElo, winner === "white" ? 1 : 0);

    // Persist game result
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
      [roomId, room.players[winner], winType, monk ?? false,
       room.score.white, room.score.black,
       eloResult.whiteAfter, eloResult.blackAfter]
    );

    // Update player stats — skip the AI user
    const loser = opp(winner);
    if (!room.isAi || winner === "white") {
      await query(
        `UPDATE users SET elo = $2, wins = wins + 1 WHERE id = $1`,
        [room.players[winner], eloResult[winner === "white" ? "whiteAfter" : "blackAfter"]]
      );
    }
    if (!room.isAi || loser === "white") {
      await query(
        `UPDATE users SET elo = $2, losses = losses + 1 WHERE id = $1`,
        [room.players[loser], eloResult[loser === "white" ? "whiteAfter" : "blackAfter"]]
      );
    }

    room.status      = "finished";
    room.matchResult = {
      winner,
      winType,
      score:         room.score,
      whiteEloAfter: eloResult.whiteAfter,
      blackEloAfter: eloResult.blackAfter,
    };

    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    broadcastToRoom(roomId, {
      type:    "MATCH_OVER",
      winner,
      score:   room.score,
      winType,
    });

    // Advance tournament bracket if this was a tournament match
    if (room.tournamentId && room.tournamentMatchId) {
      const winnerId = room.players[winner];
      const loserId  = room.players[opp(winner)];
      advanceTournament(room.tournamentId, room.tournamentMatchId, winnerId, loserId)
        .catch(err => console.error("Tournament advance error:", err.message));
    }
  } else {
    // Start next game in match — loser goes first
    room.gameNum++;
    const gs      = initGame();
    gs.turn       = opp(winner);
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
  }
}
