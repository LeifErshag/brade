// ── Main-thread side of the Grandmaster search worker (#106) ────────────────
// One long-lived worker, started on the first search. It searches one
// position at a time; searches from other rooms queue behind it, each bounded
// by SEARCH_TIMEOUT_MS. If the worker dies, its pending searches are rejected
// and the next search starts a new worker.

import { Worker } from "node:worker_threads";

let worker = null; // { thread, pending: Map<id, { resolve, reject }> }
let nextId = 1;

// Each worker has its own pending searches, so a worker that dies (or is
// stopped) after a new one has started rejects only its own searches.
function getWorker() {
  if (worker) return worker;
  const thread = new Worker(new URL("./expectimaxWorker.js", import.meta.url));
  const w = { thread, pending: new Map() };
  thread.on("message", ({ id, moves, error }) => {
    const p = w.pending.get(id);
    if (!p) return;
    w.pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(moves);
    // An idle worker must not keep the process alive.
    if (w.pending.size === 0) thread.unref();
  });
  const fail = (err) => {
    if (worker === w) worker = null;
    for (const p of w.pending.values()) p.reject(err);
    w.pending.clear();
  };
  thread.on("error", fail);
  thread.on("exit", code => fail(new Error(`Grandmaster worker exited with code ${code}`)));
  worker = w;
  return w;
}

// The moves of the best turn for `color` in `gs` (as computeBestTurnSequence),
// searched in the worker.
export function searchOffThread(gs, color) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // Throws (and rejects) before anything is recorded if gs cannot be cloned.
    w.thread.postMessage({ id, gs, color });
    w.pending.set(id, { resolve, reject });
    w.thread.ref();
  });
}

// Stops the worker (tests); the next search starts a new one.
export async function stopSearchWorker() {
  const w = worker;
  worker = null;
  if (w) await w.thread.terminate();
}
