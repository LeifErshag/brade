// ── Master AI: the Anthropic client has a bounded timeout and retries (#60) ──
// The Anthropic SDK is replaced with a fake that records the options it is
// constructed with and the per-request options of every messages.create call;
// no network call is made. The SDK defaults (a 10-minute timeout, with
// retries) would let one slow call stall the AI's turn for many minutes, so
// the master AI must set both explicitly: the effective timeout of each call
// (per-request option, else client option) is a finite number of
// milliseconds of at most 60 s, and the effective maxRetries is at most 2.

import { jest } from "@jest/globals";

const createCalls = []; // { params, reqOpts, ctorOpts }
class FakeAnthropic {
  constructor(opts = {}) {
    this.opts = opts;
    this.messages = {
      create: async (params, reqOpts) => {
        createCalls.push({ params, reqOpts, ctorOpts: this.opts });
        return { content: [{ type: "text", text: "0" }] };
      },
    };
  }
  withOptions(opts) { return new FakeAnthropic({ ...this.opts, ...opts }); }
}
jest.unstable_mockModule("@anthropic-ai/sdk", () => ({
  default:   FakeAnthropic,
  Anthropic: FakeAnthropic,
}));

process.env.ANTHROPIC_API_KEY = "test-key";

const { pickMove } = await import("./ai.js");
const { initGame, getLegalMoves } = await import("./engine.js");

const MAX_TIMEOUT_MS = 60_000;
const MAX_RETRIES    = 2;

function effective(call, name) {
  return call.reqOpts?.[name] ?? call.ctorOpts?.[name];
}

test("each master API call has a finite timeout of at most 60 s and at most 2 retries", async () => {
  const gs = initGame();
  gs.turn       = "black";
  gs.phase      = "moving";
  gs.firstMove  = false;
  gs.dice       = [3, 5];
  gs.rolledDice = [3, 5];
  const legal = getLegalMoves(gs, "black");
  expect(legal.length).toBeGreaterThan(0);

  const move = await pickMove(gs, "black", legal, "master", "MASTER01");
  expect(legal).toContainEqual(move);
  expect(createCalls).toHaveLength(1);

  const timeout = effective(createCalls[0], "timeout");
  expect(typeof timeout).toBe("number");
  expect(Number.isFinite(timeout)).toBe(true);
  expect(timeout).toBeGreaterThan(0);
  expect(timeout).toBeLessThanOrEqual(MAX_TIMEOUT_MS);

  const retries = effective(createCalls[0], "maxRetries");
  expect(Number.isInteger(retries)).toBe(true);
  expect(retries).toBeGreaterThanOrEqual(0);
  expect(retries).toBeLessThanOrEqual(MAX_RETRIES);
});
