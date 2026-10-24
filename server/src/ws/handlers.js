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
import { log } from "../log.js";

// ── Disconnect forfeit timers ─────────────────────────────────────────────────
// key: `${roomId}:${color}` → { timer, token }. Each schedule gets a fresh
// token object. The entry stays in the map after the timer fires, until its
// locked section has run, so that a reconnect's cancel (which deletes the
// entry) or a newer schedule (which replaces it) still invalidates a forfeit
// that has already fired and is queued for the room's lock.
const forfeitTimers = new Map();

// How long a player may stay disconnected mid-game before forfeiting.
export const DISCONNECT_FORFEIT_MS = 60_000;

// delayMs lets the close handler count the forfeit delay from the moment the
// socket dropped rather than from when its Redis read finished.
export function scheduleDisconnectForfeit(roomId, color, userId, delayMs = DISCONNECT_FORFEIT_MS) {
  const key = `${roomId}:${color}`;
  clearTimeout(forfeitTimers.get(key)?.timer);
  const token = {};
  const timer = setTimeout(async () => {
    // Caught here: an unhandled rejection from a timer would kill the process.
    try {
      await withRoomLock(roomId, () => forfeitIfStillDisconnected(roomId, userId, key, token));
    } catch (err) {
      log.error("Disconnect forfeit error", { roomId, userId, err });
    }
  }, Math.max(0, delayMs));
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
        log.error("START_GAME: no games row", { roomId, userId });
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
      log.info("Game started", { roomId, white: room.players.white, black: room.players.black, guest: room.hasGuest === true });
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
        triggerAiTurn(roomId).catch(err => log.error("AI turn error", { roomId, err }));
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
        triggerAiTurn(roomId).catch(err => log.error("AI turn error", { roomId, err }));
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
        triggerAiTurn(roomId).catch(err => log.error("AI turn error", { roomId, err }));
      }
      break;
    }

    case "RESIGN": {
      if (room.status !== "playing") break;
      if (!color) break;
      const winner = opp(color);
      // Logged here, once the resign is sure to happen. Only the server's
      // disconnect forfeit has no ws; not msg.forfeit, which a client could
      // send itself.
      if (ws) log.info("Player resigned", { roomId, userId, color });
      else log.info("Player forfeited after disconnect", { roomId, userId, color });
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
//
// A pass that throws (e.g. a Redis error) with no rerun pending is retried
// after a backoff delay, a bounded number of times (issue #79), so the AI does
// not abandon its turn half-played and stall the game. A retry never re-rolls:
// aiRoll resumes a moving phase that is already saved. After the last retry
// fails the loop gives up. Then only a player's reconnect re-triggers the AI
// (connectToRoom in server.js triggers when black is to roll or is mid-turn);
// the triggers after a human ROLL, MOVE or PASS and after a game's end fire
// only when black is to roll, which is all those writers can leave behind.
//
// A trigger that arrives while the loop sleeps a backoff delay ends that
// sleep at once (issue #87), so after Redis recovers, e.g. a human's
// reconnect resumes the AI within one thinking delay instead of waiting out
// up to 16 s. This cannot spin: every pass starts with a thinking delay, and
// a woken pass that fails still counts towards the bounded failure count.
const aiTurns = new Map(); // roomId -> { rerun: boolean, wake: (() => void) | null }

// Delay before each retry of a failed pass; its length bounds the retries.
// The count of consecutive failures is reset by every successful pass.
const AI_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
// How many times one move is asked of pickMove before the first legal move
// is played instead (pickMove returned nothing or threw).
const AI_PICK_ATTEMPTS = 3;

export async function triggerAiTurn(roomId) {
  const running = aiTurns.get(roomId);
  if (running) {
    running.rerun = true;
    running.wake?.();
    return;
  }
  const turn = { rerun: false, wake: null };
  aiTurns.set(roomId, turn);
  try {
    let failures = 0; // consecutive failed passes
    for (;;) {
      turn.rerun = false;
      let failed = false;
      try {
        await _triggerAiTurn(roomId);
        failures = 0;
      } catch (err) {
        log.error("AI turn error", { roomId, failures: failures + 1, err });
        failed = true;
        failures++;
      }
      // A failing pass does not drop a rerun that was requested meanwhile.
      if (turn.rerun) continue;
      if (!failed) break;
      if (failures > AI_RETRY_DELAYS_MS.length) {
        log.error("AI turn gave up until the next trigger", { roomId, failures });
        break;
      }
      await wakeableSleep(turn, AI_RETRY_DELAYS_MS[failures - 1]);
    }
  } finally {
    aiTurns.delete(roomId);
  }
}

// The AI turn is split into short locked sections (the roll, then one section
// per move) so the "thinking" delays and the move choice run without holding
// the room's lock. Choosing a move can take a while (Grandmaster searches the
// position in a worker thread, so other rooms keep being served meanwhile;
// #106), so it works on a snapshot taken by the previous section.
// The section that applies the move re-reads the room and applies it only if
// the position is unchanged (same game, turn, phase, dice and move sequence),
// because other writers (e.g. a human RESIGN or a reconnect) may have run in
// the meantime (issue #60).
async function _triggerAiTurn(roomId) {
  // Brief "thinking" delay
  await sleep(700 + Math.random() * 800);

  const redis = getRedis();
  // `snap` is the room as the last locked section left it, while the AI still
  // has a move to play; null when the AI's turn is over.
  let snap = await withRoomLock(roomId, () => aiRoll(redis, roomId));

  // Play moves one at a time with a small visual delay between each
  while (snap) {
    await sleep(500);
    const gs       = snap.gameState;
    const move     = await chooseAiMove(gs, !!snap.isTutorial, roomId);
    const expected = aiPositionKey(snap);
    snap = await withRoomLock(roomId, () => aiMove(redis, roomId, expected, move));
  }
}

// Ask pickMove for a move a few times; if it returns nothing (or throws)
// every time, play the first legal move so the turn always completes
// (issue #82). gs.legalMoves is non-empty here (see aiToMove).
async function chooseAiMove(gs, random, roomId) {
  for (let attempt = 1; attempt <= AI_PICK_ATTEMPTS; attempt++) {
    try {
      const move = await pickMove(gs, "black", gs.legalMoves, roomId, { random });
      if (move) return move;
      log.error("AI pickMove returned no move", { roomId, attempt });
    } catch (err) {
      log.error("AI pickMove error", { roomId, attempt, err });
    }
  }
  log.error("AI playing the first legal move", { roomId });
  return gs.legalMoves[0];
}

// What a chosen move depends on. If any of this changed since the move was
// chosen, the move is stale and must not be applied.
function aiPositionKey(room) {
  const gs = room.gameState;
  return JSON.stringify([
    room.status, room.gameNum, room.gameDbId ?? null,
    gs.turn, gs.phase, gs.moveSeq, gs.dice, gs.rolledDice,
    gs.board, gs.bar, gs.off,
  ]);
}

// The room when it is the AI's turn to move, else null.
function aiToMove(room) {
  if (!room || room.status !== "playing") return null;
  const gs = room.gameState;
  if (gs.turn !== "black" || gs.phase !== "moving") return null;
  if (gs.legalMoves.length === 0 || gs.dice.length === 0) return null;
  return room;
}

// Locked section: roll for the AI. Returns the saved room when the AI has
// moves to play, else null. If the AI has already rolled and still has moves
// left (a retry after a failed pass, or a trigger mid-turn), the saved moving
// phase is resumed as is, with the same dice: the AI never re-rolls.
async function aiRoll(redis, roomId) {
  const room = await loadRoom(redis, roomId);
  if (!room || room.status !== "playing") return null;

  const gs = room.gameState;
  if (gs.turn === "black" && gs.phase === "moving") return aiToMove(room);
  if (gs.turn !== "black" || gs.phase !== "rolling") return null; // sanity check

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
      return null;
    }
    // Otherwise pass.
    gs.phase      = "rolling";
    gs.turn       = "white";
    gs.dice       = [];
    gs.legalMoves = [];
    room.gameState = gs;
    await saveRoom(redis, roomId, room);
    broadcastState(roomId, room);
    return null;
  }

  room.gameState = gs;
  await saveRoom(redis, roomId, room);
  broadcastState(roomId, room);
  return room;
}

// Locked section: play one AI move, chosen for the position `expected`.
// Returns the saved room when the AI has more to play, else null. If the room
// has changed since the move was chosen, nothing is written; the current room
// is returned if it is still the AI's move, so the caller chooses again.
async function aiMove(redis, roomId, expected, chosen) {
  const room = aiToMove(await loadRoom(redis, roomId));
  if (!room) return null;
  if (aiPositionKey(room) !== expected) return room;

  // Same position, so the chosen move should be legal. If it is not (a bug in
  // the move choice), play the first legal move instead of choosing again,
  // which could repeat forever.
  const gs = room.gameState;
  let move = chosen;
  if (!gs.legalMoves.some(m => m.from === move.from && m.to === move.to && m.die === move.die)) {
    log.error("AI chose an illegal move; playing the first legal move", { roomId, move });
    move = gs.legalMoves[0];
  }

  // Capture whether the move burst a band in the mover's first quarter.
  const { gs: newGs, burstFirstQuarter } = applyMove(gs, "black", move.from, move.to, move.die);

  logMove(room, newGs.moveSeq, "black", move.from, move.to, move.die);

  // Only a first-quarter burst can make a sprängjan (§11 p.7).
  const result = checkWin(newGs, burstFirstQuarter);
  if (result) {
    room.gameState = newGs;
    await handleGameOver(redis, roomId, room, result);
    return null;
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
      return null;
    }
    newGs.phase      = "rolling";
    newGs.turn       = "white";
    newGs.dice       = [];
    newGs.legalMoves = [];
  }

  room.gameState = newGs;
  await saveRoom(redis, roomId, room);
  broadcastState(roomId, room);
  return passing ? null : room;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sleep that ends early when turn.wake() is called (by a trigger).
function wakeableSleep(turn, ms) {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      turn.wake = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    turn.wake = done;
  });
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
  ).catch(err => log.error("Move log error", { gameId: room.gameDbId, seq, err }));
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
 * Mark the room's game state as over when the match ends, so the saved and
 * broadcast state never describes a live turn (#72): phase "over" and no legal
 * moves. The final position (board, bar, off) is kept as is.
 */
function endMatchState(room) {
  if (!room.gameState) return;
  room.gameState.phase      = "over";
  room.gameState.legalMoves = [];
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
  log.info("Game over", {
    roomId, gameNum: room.gameNum, winner, winType, points: points ?? 1, score: room.score,
    white: room.players.white, black: room.players.black, forced: forceMatchOver,
  });

  // Accumulate per-game result for §14 tie-break
  if (!room.gameResults) room.gameResults = [];
  room.gameResults.push({ winner, winType, points: points ?? 1 });

  // ── Tutorial game: never rated. No games row, no ELO, no wins/losses. ──
  // Checked before anything touches the DB, and decided by the server-set room
  // flag, so a client cannot get a tutorial game recorded.
  if (room.isTutorial) {
    room.status      = "finished";
    endMatchState(room);
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
      endMatchState(room);
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
    endMatchState(room);
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
        .catch(err => log.error("Tournament advance error", { roomId, tournamentId: room.tournamentId, err }));
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
      triggerAiTurn(roomId).catch(err => log.error("AI turn error", { roomId, err }));
    }
  }
}
