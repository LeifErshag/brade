// ── Main-thread side of the Grandmaster search worker (#106) ────────────────
// One long-lived worker, started on the first search. It searches one
// position at a time; searches from other rooms queue behind it, each bounded
// by SEARCH_TIMEOUT_MS. If the worker dies, its pending searches are rejected
// and the next search starts a new worker.

import { Worker } from "node:worker_threads";

let worker  = null;
let nextId  = 1;
const pending = new Map(); // id → { resolve, reject }

function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL("./expectimaxWorker.js", import.meta.url));
  w.on("message", ({ id, moves, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(moves);
    // An idle worker must not keep the process alive.
    if (pending.size === 0) w.unref();
  });
  const fail = (err) => {
    if (worker === w) worker = null;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  w.on("error", fail);
  w.on("exit", code => fail(new Error(`Grandmaster worker exited with code ${code}`)));
  worker = w;
  return w;
}

// The moves of the best turn for `color` in `gs` (as computeBestTurnSequence),
// searched in the worker.
export function searchOffThread(gs, color) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.ref();
    w.postMessage({ id, gs, color });
  });
}

// Stops the worker (tests); the next search starts a new one.
export async function stopSearchWorker() {
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}
