import { getRedis, keys, TTL } from "../db/redis.js";
import { send, broadcastToRoom, broadcastState, sendToUser } from "./server.js";

// Message types accepted from clients:
//   PLAYER_READY  — toggle ready state for calling player
//   START_GAME    — host starts game when both players are ready
//   INVITE_PLAYER — { targetUserId } send invite notification to a user
//   ROLL          — (Phase 10) server rolls dice
//   MOVE          — (Phase 10) { from, to, die }
//   PASS          — (Phase 10) player passes turn
//   RESIGN        — (Phase 10) player forfeits

export async function handleMessage({ msg, userId, roomId, ws }) {
  const redis   = getRedis();
  const rawRoom = await redis.get(keys.room(roomId));
  if (!rawRoom) { send(ws, { type: "ERROR", message: "Room not found" }); return; }

  const room  = JSON.parse(rawRoom);
  const color = room.players.white === userId ? "white"
              : room.players.black === userId ? "black"
              : null; // spectator

  switch (msg.type) {

    case "PLAYER_READY": {
      if (!color) { send(ws, { type: "ERROR", message: "Not a player" }); break; }
      room.ready[color] = !room.ready[color];
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      break;
    }

    case "START_GAME": {
      if (room.createdBy !== userId) {
        send(ws, { type: "ERROR", message: "Only the host can start" }); break;
      }
      if (!room.players.black) {
        send(ws, { type: "ERROR", message: "Waiting for opponent" }); break;
      }
      if (!room.ready.white || !room.ready.black) {
        send(ws, { type: "ERROR", message: "Both players must be ready" }); break;
      }
      room.status = "playing";
      // Full game state initialisation goes in Phase 10
      await saveRoom(redis, roomId, room);
      broadcastState(roomId, room);
      break;
    }

    case "INVITE_PLAYER": {
      const targetId = msg.targetUserId;
      if (!targetId || typeof targetId !== "string") {
        send(ws, { type: "ERROR", message: "Invalid targetUserId" }); break;
      }
      const fromName = color ? room.playerInfo?.[color]?.display_name : null;
      const inviteUrl = `${process.env.CLIENT_ORIGIN}/game/${roomId}`;
      // Best-effort: silently dropped if target is not currently connected
      sendToUser(targetId, {
        type:     "INVITE_RECEIVED",
        fromName: fromName ?? "Someone",
        roomId,
        inviteUrl,
      });
      break;
    }

    // ── Phase 10 stubs ────────────────────────────────────────────────────────

    case "ROLL": {
      if (room.status !== "playing") break;
      if (!color) { send(ws, { type: "ERROR", message: "Not a player" }); break; }
      if (room.gameState?.turn !== color) { send(ws, { type: "ERROR", message: "Not your turn" }); break; }
      const dice = rollDice();
      broadcastToRoom(roomId, { type: "ROLLED", color, dice });
      break;
    }

    case "MOVE": {
      if (!color) { send(ws, { type: "ERROR", message: "Not a player" }); break; }
      // Full validation goes in Phase 10
      broadcastToRoom(roomId, { type: "MOVE_APPLIED", move: msg });
      break;
    }

    case "PASS": {
      if (!color) break;
      broadcastToRoom(roomId, { type: "TURN_PASSED", userId });
      break;
    }

    case "RESIGN": {
      if (!color) break;
      const winner = color === "white" ? "black" : "white";
      broadcastToRoom(roomId, { type: "GAME_OVER", reason: "resign", winner });
      break;
    }

    default:
      send(ws, { type: "ERROR", message: "Unknown message type" });
  }
}

async function saveRoom(redis, roomId, room) {
  await redis.set(keys.room(roomId), JSON.stringify(room), "EX", TTL.room);
}

function rollDice() {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}
