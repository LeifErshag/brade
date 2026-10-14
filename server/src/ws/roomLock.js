// ── Per-room serialization of room state updates ─────────────────────────────
//
// Room state lives in Redis as one JSON blob (`room:{id}`) and every writer
// does get → modify → set across awaits. Two writers for the same room that
// interleave (e.g. a WS message and a seat release, or a human RESIGN and an
// AI move) would otherwise overwrite each other's changes.
//
// withRoomLock(roomId, fn) runs fn only after every earlier call for the same
// room has settled, so read-modify-write sections for one room never overlap.
// Different rooms run independently.
//
// SINGLE-INSTANCE ASSUMPTION: this is an in-process queue. It is correct only
// while one server process handles all WebSocket traffic for a room (the
// current single Render instance). Running several instances would need a
// Redis-side mechanism instead (WATCH/MULTI or a Lua script).
//
// DEADLOCK RULE: never call withRoomLock for a room from inside a section that
// already holds that room's lock and then await the result: the inner call
// waits for the outer one, which waits for the inner one. Fire-and-forget work
// started inside a section (e.g. triggerAiTurn) is fine; it simply queues
// behind the current section. Helpers called from inside a section (such as
// handleGameOver) must not take the lock themselves.

const tails = new Map(); // roomId → promise that settles when the queue drains

export function withRoomLock(roomId, fn) {
  const prev = tails.get(roomId) ?? Promise.resolve();
  const run  = prev.then(() => fn());
  // The tail never rejects, so one failing section does not block the next.
  const tail = run.then(() => {}, () => {});
  tails.set(roomId, tail);
  tail.then(() => { if (tails.get(roomId) === tail) tails.delete(roomId); });
  return run;
}

// Test helper: number of rooms with queued or running sections.
export function pendingRoomLockCount() {
  return tails.size;
}
