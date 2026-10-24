// ── Main-thread side of the Grandmaster search worker (#106) ────────────────
// One long-lived worker, started on the first search. It searches one
// position at a time; searches from other rooms queue behind it. If the worker
// dies, its pending searches are rejected and the next search starts a new
// worker. A worker that takes longer than the answer timeout over one search
// is treated as hung (#124): it is stopped, that search rejects, and the
// searches queued behind it move to a new worker, so a position that hangs
// every time does not use up other rooms' retries.

import { Worker } from "node:worker_threads";
import { SEARCH_TIMEOUT_MS } from "./expectimax.js";
import { log } from "../log.js";

const WORKER_URL = new URL("./expectimaxWorker.js", import.meta.url);
// Overridden by tests (configureSearchWorker). A null answerTimeoutMs means
// twice the search budget, read when used: expectimax.js imports this module,
// so its constants are not initialised yet while this module loads.
let options = { workerUrl: WORKER_URL, answerTimeoutMs: null };

let worker = null; // { thread, pending: Map<id, { msg, resolve, reject }>, timer, online }
let nextId = 1;

// Each worker has its own pending searches, so a worker that dies (or is
// stopped) after a new one has started rejects only its own searches.
function getWorker() {
  if (worker) return worker;
  const thread = new Worker(options.workerUrl);
  const w = { thread, pending: new Map(), timer: null, online: false };
  thread.once("online", () => {
    w.online = true;
    watchHead(w);
  });
  thread.on("message", ({ id, moves, error }) => {
    const p = w.pending.get(id);
    if (!p) return;
    w.pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(moves);
    if (w.pending.size === 0) thread.unref();
    watchHead(w); // the worker went on to the next queued search as it replied
  });
  thread.on("error", err => fail(w, err));
  thread.on("exit", code => fail(w, new Error(`Grandmaster worker exited with code ${code}`)));
  // An idle worker must not keep the process alive; post() refs it while a
  // search is pending. Only after the listeners: adding a "message" listener
  // refs the worker again.
  thread.unref();
  worker = w;
  return w;
}

function fail(w, err) {
  if (worker === w) worker = null;
  clearTimeout(w.timer);
  for (const p of w.pending.values()) p.reject(err);
  w.pending.clear();
}

// Times the search the worker is on: the oldest pending one, since the worker
// answers them in order. Searches queued behind it are not timed until it
// answers, so a long queue is not mistaken for a hang. Nor is starting the
// worker: timing starts once it is online (a worker that fails to start emits
// "error" or "exit" instead). A main thread blocked for longer than the
// timeout can still look like a hung worker, since timers run before a
// waiting answer is handled.
function watchHead(w) {
  clearTimeout(w.timer);
  w.timer = null;
  if (!w.online || w.pending.size === 0) return;
  const ms = options.answerTimeoutMs ?? 2 * SEARCH_TIMEOUT_MS;
  w.timer = setTimeout(() => {
    const err = new Error(`Grandmaster worker did not answer within ${ms} ms`);
    log.error(`${err.message} (or the main thread was blocked that long); stopping it`);
    const [[, hung], ...queued] = w.pending;
    w.pending.clear();
    fail(w, err); // nothing pending is left to reject; this stops the timer
    w.thread.terminate();
    hung.reject(err);
    for (const [, search] of queued) {
      try { post(search); } catch (e) { search.reject(e); }
    }
  }, ms);
  w.timer.unref();
}

// The moves of the best turn for `color` in `gs` (as computeBestTurnSequence),
// searched in the worker.
export function searchOffThread(gs, color) {
  const msg = { id: nextId++, gs, color };
  return new Promise((resolve, reject) => post({ msg, resolve, reject }));
}

// Sends a search to the worker, starting one if needed. Throws before
// anything is recorded if the search cannot be cloned.
function post(search) {
  const w = getWorker();
  w.thread.postMessage(search.msg);
  w.pending.set(search.msg.id, search);
  w.thread.ref();
  if (w.pending.size === 1) watchHead(w);
}

// Stops the worker (tests); the next search starts a new one.
export async function stopSearchWorker() {
  const w = worker;
  worker = null;
  if (!w) return;
  clearTimeout(w.timer);
  await w.thread.terminate();
}

// Replaces the worker script and the answer timeout (tests); no arguments
// restores the defaults. The script applies to the next worker started, the
// timeout to the next search timed.
export function configureSearchWorker({ workerUrl = WORKER_URL, answerTimeoutMs = null } = {}) {
  options = { workerUrl, answerTimeoutMs };
}
