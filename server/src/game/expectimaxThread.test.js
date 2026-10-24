// ── Grandmaster's search worker (#106) ───────────────────────────────────────
// searchOffThread runs computeBestTurnSequence in a worker thread:
//   1. it answers what the search answers on the main thread;
//   2. the main thread's event loop keeps running while it searches;
//   3. a search that throws in the worker rejects, and the worker goes on;
//   4. if the worker exits, pending searches reject and the next search
//      starts a new worker;
//   5. a worker exiting after a new one started rejects only its own
//      searches, not the new worker's;
//   6. a worker that does not answer a search in time is stopped: that
//      search rejects, and the searches queued behind it are answered by a
//      new worker (#124);
//   7. searches queued behind a slow one are not timed until the worker
//      starts on them, so a long queue is not taken for a hang;
//   8. the worker does not keep the process from exiting, even when the
//      first search fails before reaching it.

import { jest } from "@jest/globals";
import { setInterval, clearInterval } from "node:timers";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchOffThread, stopSearchWorker, configureSearchWorker } from "./expectimaxThread.js";
import { computeBestTurnSequence } from "./expectimax.js";
import { pathToIdx } from "./engine.js";

function gsWith(color, dice, placements) {
  const gs = {
    board: new Array(24).fill(0),
    bar:   { white: 0, black: 0 },
    off:   { white: 0, black: 0 },
    turn:  color,
    phase: "moving",
    dice:  dice.slice(),
    rolledDice: dice.slice(),
    legalMoves: [],
    moveSeq: 0,
    firstMove: false,
  };
  for (const [c, pos, n] of placements) gs.board[pathToIdx(c, pos)] = c === "white" ? n : -n;
  return gs;
}

const midGame = () => gsWith("white", [2, 4], [
  ["white", 0, 11], ["white", 6, 1], ["white", 11, 1], ["white", 16, 1], ["white", 21, 1],
  ["black", 0, 15],
]);

afterAll(() => stopSearchWorker());

test("answers what the search answers on the main thread", async () => {
  const gs = midGame();
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

test("the event loop keeps running during a search", async () => {
  // A wide-open doubles position, one of the heaviest searches (see
  // expectimax.test.js).
  const board = [2, 2, -2, -2, 0, -2, -2, 0, 1, 2, 0, 1, 0, -2, -2, 1, 1, 2, 1, -2, 0, 0, 2, -1];
  const gs = { ...gsWith("white", [2, 2, 2, 2], []), board };
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const search = searchOffThread(gs, "white");
    expect(ticks).toBe(0);
    const moves = await search;
    expect(moves.length).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
  }
});

test("a search that throws rejects, and the worker answers the next one", async () => {
  await expect(searchOffThread({ dice: [1, 2] }, "white")).rejects.toThrow();
  const gs = midGame();
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

test("pending searches reject when the worker exits; the next search starts a new one", async () => {
  const gs = midGame();
  const pending = searchOffThread(gs, "white");
  const settled = expect(pending).rejects.toThrow(/exited/);
  await stopSearchWorker();
  await settled;
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

test("an old worker exiting does not reject the new worker's searches", async () => {
  const gs = midGame();
  await searchOffThread(gs, "white"); // the worker is up
  const old = searchOffThread(gs, "white");
  const oldSettled = expect(old).rejects.toThrow(/exited/);
  const stopping = stopSearchWorker(); // not awaited: the old worker exits later
  const fresh = searchOffThread(gs, "white"); // starts a new worker
  await stopping;
  await oldSettled;
  expect(await fresh).toEqual(computeBestTurnSequence(gs, "white"));
});

test("a game state that cannot be cloned rejects, and the worker goes on", async () => {
  const gs = midGame();
  await expect(searchOffThread({ ...gs, extra: () => {} }, "white")).rejects.toThrow();
  expect(await searchOffThread(gs, "white")).toEqual(computeBestTurnSequence(gs, "white"));
});

// ── Slow and hung workers (#124) ─────────────────────────────────────────────

describe("with a stand-in worker that is busy for busyMs per search", () => {
  const busy = busyMs => searchOffThread({ busyMs }, "white");

  beforeEach(async () => {
    await stopSearchWorker();
    configureSearchWorker({ workerUrl: new URL("./expectimaxWorker.fixture.js", import.meta.url), answerTimeoutMs: 1000 });
  });
  afterEach(async () => {
    await stopSearchWorker();
    configureSearchWorker();
  });

  test("a hung worker is stopped: its search rejects, and the queued ones move to a new worker", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const hung = busy(60000);
      const queued = [busy(0), busy(1)];
      await expect(hung).rejects.toThrow("did not answer within 1000 ms");
      expect(await Promise.all(queued)).toEqual([[0], [1]]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("did not answer"));
    } finally {
      error.mockRestore();
    }
    expect(await busy(0)).toEqual([0]);
  });

  test("searches queued behind a slow one are not timed out while they wait", async () => {
    // 4 × 400 ms in all, well past the 1000 ms timeout; each one is within it.
    const searches = [busy(400), busy(400), busy(400), busy(400)];
    expect(await Promise.all(searches)).toEqual([[400], [400], [400], [400]]);
  });
});

describe("the worker does not keep the process alive", () => {
  const moduleUrl = new URL("./expectimaxThread.js", import.meta.url).href;
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "brade-worker-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Runs `body` as a script file (the worker inherits the process's flags,
  // so not with -e) in a new Node process that has imported searchOffThread,
  // and returns how it ended. A process kept alive by the worker is killed by
  // the timeout.
  const run = (name, body) => {
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, `import { searchOffThread } from ${JSON.stringify(moduleUrl)};
${body}`);
    return spawnSync(process.execPath, [file], { timeout: 10000, encoding: "utf8" });
  };

  test.each([
    ["after a search answers", "answers",
      `const moves = await searchOffThread(${JSON.stringify(midGame())}, "white");
       console.log(moves.length > 0 ? "answered" : "no moves");`,
      "answered"],
    ["when the first search cannot be sent to it", "uncloneable",
      `await searchOffThread({ f() {} }, "white").catch(() => console.log("rejected"));`,
      "rejected"],
  ])("%s", (_label, name, body, stdout) => {
    const result = run(name, body);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(stdout);
    expect(result.status).toBe(0);
  }, 15000);
});
