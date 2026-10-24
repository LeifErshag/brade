// Benchmark for Grandmaster's synchronous search (#106).
//
// Generates positions by random self-play from initGame(), then times one
// full search (computeBestTurnSequence) on each, without the time budget, so
// a slow position is measured rather than cut short. The game server runs
// this search in a worker thread with a 500 ms budget; here it runs on the
// main thread, so these timings are how long a search blocks a thread.
//
// Usage (from server/):
//   node scripts/bench-grandmaster.js [games] [seed] [mode]
// Defaults: 40 games, seed 1, mode "random". The same arguments give the
// same positions. Mode "random" plays a uniformly random legal turn for both
// sides (many hits, bar and jan positions); mode "grandmaster" lets
// Grandmaster play both sides (positions closer to real AI games: more
// bands and primes).

import { performance } from "node:perf_hooks";
import os from "node:os";
import { initGame, legalTurnSequences, getLegalMoves, applyMove, checkWin, checkJanOnPass } from "../src/game/engine.js";
import { getNextExpectimaxMove, clearExpectimaxCache, computeBestTurnSequence } from "../src/game/expectimax.js";

const GAMES = Number(process.argv[2] ?? 40);
const SEED  = Number(process.argv[3] ?? 1);
const MODE  = process.argv[4] ?? "random";
if (MODE !== "random" && MODE !== "grandmaster") {
  console.error(`Unknown mode "${MODE}" (use "random" or "grandmaster")`);
  process.exit(1);
}
const MAX_TURNS_PER_GAME = 400;
const SLOWEST_SHOWN = 10;
const OPENING_TURNS = 4; // the first few turns of a game count as "opening"

// Small seeded PRNG (mulberry32) so runs are reproducible.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const die  = () => 1 + Math.floor(rand() * 6);
function roll() {
  const d1 = die(), d2 = die();
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}

// ── Position generation (self-play) ─────────────────────────────────────────

// Play a whole turn with Grandmaster's moves; returns the resulting
// { board, bar, off }. Its turn plan is cached per room, so one search per
// turn, as in a real game.
let gmRoom = 0;
function playGrandmasterTurn(pos, color) {
  const roomId = "GEN" + (gmRoom++);
  let cur = pos;
  while (cur.dice.length > 0) {
    const legal = getLegalMoves(cur, color);
    if (legal.length === 0) break;
    const m = getNextExpectimaxMove(cur, color, legal, roomId);
    cur = { ...applyMove(cur, color, m.from, m.to, m.die).gs, turn: color };
    if (checkWin(cur)) break;
  }
  clearExpectimaxCache(roomId);
  return { board: cur.board, bar: cur.bar, off: cur.off };
}

function generatePositions() {
  const positions = [];
  for (let g = 0; g < GAMES; g++) {
    const start = initGame();
    let gs = { board: start.board, bar: start.bar, off: start.off };
    let color = rand() < 0.5 ? "white" : "black";
    for (let turn = 0; turn < MAX_TURNS_PER_GAME; turn++) {
      const dice = roll();
      const pos = {
        board: gs.board.slice(),
        bar:   { ...gs.bar },
        off:   { ...gs.off },
        dice,
        moveSeq: 0,
        turn: color,
      };
      const seqs = legalTurnSequences(pos, color);
      if (seqs.length === 0) {
        if (checkJanOnPass(pos)) break;
      } else {
        positions.push({ gs: pos, color, game: g, turn, sequences: seqs.length });
        gs = MODE === "random"
          ? seqs[Math.floor(rand() * seqs.length)].finalGs
          : playGrandmasterTurn(pos, color);
        if (checkWin({ ...gs, turn: color })) break;
      }
      color = color === "white" ? "black" : "white";
    }
  }
  return positions;
}

// ── Timing ──────────────────────────────────────────────────────────────────

function timeSearch(p) {
  const gs = { ...p.gs, board: p.gs.board.slice(), bar: { ...p.gs.bar }, off: { ...p.gs.off }, dice: p.gs.dice.slice() };
  const t0 = performance.now();
  computeBestTurnSequence(gs, p.color, Infinity);
  return performance.now() - t0;
}

function percentile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function summarize(label, ms) {
  const s = ms.slice().sort((a, b) => a - b);
  const f = x => x.toFixed(1).padStart(8);
  console.log(
    label.padEnd(18) + String(s.length).padStart(6) +
    f(percentile(s, 0.5)) + f(percentile(s, 0.95)) + f(percentile(s, 0.99)) + f(s[s.length - 1] ?? NaN),
  );
}

// Compact board in path terms of the absolute board array: white positive,
// black negative, index 0 = point 1.
function describe(p) {
  const pts = p.gs.board
    .map((n, i) => (n === 0 ? null : `${i + 1}:${n > 0 ? "W" : "B"}${Math.abs(n)}`))
    .filter(Boolean)
    .join(" ");
  return `${p.color} dice=[${p.gs.dice}] bar=W${p.gs.bar.white}/B${p.gs.bar.black} ` +
         `off=W${p.gs.off.white}/B${p.gs.off.black} seqs=${p.sequences}\n      ${pts}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`Node ${process.version} on ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} cores)`);
console.log(`Games: ${GAMES}, seed: ${SEED}, mode: ${MODE}`);

const positions = generatePositions();
console.log(`Positions: ${positions.length}`);

// Warm up the JIT so the first timings are not inflated.
for (const p of positions.slice(0, 50)) timeSearch(p);

for (const p of positions) p.ms = timeSearch(p);

// A GC pause, another process or the machine sleeping can inflate a single
// timing. Re-time the slowest 1% (at least 20) a few more times and keep the
// fastest run, so the tail reflects the search itself.
const RETIMES = 3;
const tail = positions.slice().sort((a, b) => b.ms - a.ms)
  .slice(0, Math.max(20, Math.ceil(positions.length / 100)));
for (const p of tail) {
  for (let i = 0; i < RETIMES; i++) p.ms = Math.min(p.ms, timeSearch(p));
}

const isDouble  = p => p.gs.dice.length === 4;
const isBar     = p => p.gs.bar[p.color] > 0;
const isOpening = p => p.turn < OPENING_TURNS;

console.log("\nms per search       count     p50     p95     p99     max");
summarize("all",       positions.map(p => p.ms));
summarize("opening",   positions.filter(isOpening).map(p => p.ms));
summarize("doubles",   positions.filter(isDouble).map(p => p.ms));
summarize("non-doubles", positions.filter(p => !isDouble(p)).map(p => p.ms));
summarize("on bar",    positions.filter(isBar).map(p => p.ms));
summarize("doubles+bar", positions.filter(p => isDouble(p) && isBar(p)).map(p => p.ms));

const total = positions.reduce((a, p) => a + p.ms, 0);
console.log(`\nTotal search time: ${(total / 1000).toFixed(1)} s, mean ${(total / positions.length).toFixed(1)} ms`);
for (const limit of [50, 100, 250, 500, 1000]) {
  const n = positions.filter(p => p.ms > limit).length;
  console.log(`  > ${String(limit).padStart(4)} ms: ${n} (${(100 * n / positions.length).toFixed(2)}%)`);
}

console.log(`\nSlowest ${SLOWEST_SHOWN} positions:`);
for (const p of positions.slice().sort((a, b) => b.ms - a.ms).slice(0, SLOWEST_SHOWN)) {
  console.log(`  ${p.ms.toFixed(1).padStart(8)} ms  game ${p.game} turn ${p.turn}  ${describe(p)}`);
}
