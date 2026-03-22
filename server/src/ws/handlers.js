import { getRedis, keys, TTL } from "../db/redis.js";
import { send, broadcastToRoom } from "./server.js";

// Message types the server accepts from clients:
//   JOIN    — player joins room, server sends current state
//   ROLL    — server rolls dice (client never rolls)
//   MOVE    — { from, to, die }
//   PASS    — player passes turn
//   RESIGN  — player forfeits game

export async function handleMessage({ msg, userId, roomId, rooms, ws }) {
  const redis    = getRedis();
  const rawRoom  = await redis.get(keys.room(roomId));
  if (!rawRoom) { send(ws, { type: "ERROR", message: "Room not found" }); return; }

  const room = JSON.parse(rawRoom);

  // Verify sender is a participant
  const isParticipant = [room.players.white, room.players.black].includes(userId);
  if (!isParticipant) { send(ws, { type: "ERROR", message: "Not a participant" }); return; }

  switch (msg.type) {

    case "JOIN": {
      // If black seat is empty, assign this player
      if (!room.players.black && room.players.white !== userId) {
        room.players.black = userId;
        room.status = "playing";
        // Game logic initialisation will go here in Phase 10
        await saveRoom(redis, roomId, room);
        broadcastToRoom(roomId, rooms, { type: "ROOM_STATE", room });
      } else {
        send(ws, { type: "ROOM_STATE", room });
      }
      break;
    }

    case "ROLL": {
      // Server is authoritative on dice — client never sends dice values
      if (room.status !== "playing") break;
      const color = room.players.white === userId ? "white" : "black";
      if (room.gameState?.turn !== color) { send(ws, { type: "ERROR", message: "Not your turn" }); break; }
      // Full dice + move logic will be wired in Phase 10
      const dice = rollDice();
      broadcastToRoom(roomId, rooms, { type: "ROLLED", color, dice });
      break;
    }

    case "MOVE": {
      // Validate and apply move — Phase 10
      // Placeholder: echo back for now
      broadcastToRoom(roomId, rooms, { type: "MOVE_APPLIED", move: msg });
      break;
    }

    case "PASS": {
      broadcastToRoom(roomId, rooms, { type: "TURN_PASSED", userId });
      break;
    }

    case "RESIGN": {
      const winner = room.players.white === userId ? "black" : "white";
      broadcastToRoom(roomId, rooms, { type: "GAME_OVER", reason: "resign", winner });
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