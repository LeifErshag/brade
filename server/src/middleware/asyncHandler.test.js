// asyncHandler forwards errors from async route handlers to the Express error
// middleware instead of leaving them as unhandled promise rejections.

import { jest } from "@jest/globals";
import express from "express";
import { asyncHandler } from "./asyncHandler.js";

describe("asyncHandler", () => {
  let server, base, errors;

  beforeAll(async () => {
    const app = express();
    app.get("/reject", asyncHandler(async () => {
      throw new Error("db down");
    }));
    app.get("/throw", asyncHandler(() => {
      throw new Error("sync boom");
    }));
    app.get("/ok", asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    }));
    app.use((err, _req, res, _next) => {
      errors.push(err);
      res.status(500).json({ error: "Internal server error" });
    });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => { errors = []; });

  test("a rejected async handler reaches the error middleware as a 500", async () => {
    const res = await fetch(`${base}/reject`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(errors.map((e) => e.message)).toEqual(["db down"]);
  });

  test("a synchronous throw is forwarded too", async () => {
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(500);
    expect(errors.map((e) => e.message)).toEqual(["sync boom"]);
  });

  test("a successful handler is unaffected", async () => {
    const res = await fetch(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(errors).toEqual([]);
  });

  test("passes req, res and next through to the handler", async () => {
    const fn = jest.fn(async () => {});
    const req = {}, res = {}, next = jest.fn();
    asyncHandler(fn)(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fn).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});
