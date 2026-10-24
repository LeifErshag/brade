// ── Stand-in for expectimaxWorker.js in expectimaxThread.test.js (#124) ─────
// Answers { id, gs: { busyMs } } with { id, moves: [busyMs] } after keeping
// its thread busy for busyMs, so a test can make the worker slow or hung.

import { parentPort } from "node:worker_threads";

parentPort.on("message", ({ id, gs }) => {
  const end = Date.now() + gs.busyMs;
  while (Date.now() < end); // busy, like a search: terminate() can interrupt it
  parentPort.postMessage({ id, moves: [gs.busyMs] });
});
