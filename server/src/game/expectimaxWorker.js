// ── Worker thread entry for Grandmaster's search (#106) ─────────────────────
// Runs computeBestTurnSequence off the main thread, so a long search does not
// block the event loop that serves every room. One request at a time:
// { id, gs, color } in, { id, moves } or { id, error } out.

import { parentPort } from "node:worker_threads";
import { computeBestTurnSequence } from "./expectimax.js";

parentPort.on("message", ({ id, gs, color }) => {
  try {
    parentPort.postMessage({ id, moves: computeBestTurnSequence(gs, color) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
