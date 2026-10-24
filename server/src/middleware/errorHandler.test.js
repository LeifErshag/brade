// The final error middleware passes 4xx errors (e.g. body-parser's 400/413)
// through, turns everything else into a generic 500, and hands off to Express
// when the response has already started.

import { jest } from "@jest/globals";
import express from "express";
import { errorHandler } from "./errorHandler.js";

describe("errorHandler over HTTP", () => {
  let server, base, logger;

  beforeAll(async () => {
    logger = { error: jest.fn(), warn: jest.fn() };
    const app = express();
    app.use(express.json({ limit: "10kb" }));
    app.post("/echo", (req, res) => res.json(req.body));
    app.get("/boom", () => { throw new Error("db password is hunter2"); });
    app.get("/teapot", () => {
      const err = new Error("internal detail");
      err.status = 418; // 4xx without expose: generic message
      throw err;
    });
    app.use(errorHandler(logger));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => { logger.error.mockClear(); logger.warn.mockClear(); });

  const post = (body) => fetch(`${base}/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  test("malformed JSON returns 400", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a 4xx log line has the status and type but none of the client's body", async () => {
    const res = await post("{secret-body-fragment");
    expect(res.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [line] = logger.warn.mock.calls[0];
    expect(line).toBe("Client error 400 (entity.parse.failed)");
    expect(line).not.toContain("secret");
  });

  test("a body over the size limit returns 413", async () => {
    const res = await post(JSON.stringify({ pad: "x".repeat(20 * 1024) }));
    expect(res.status).toBe(413);
    // The client translates this text (i18n serverError).
    expect(await res.json()).toEqual({ error: "request entity too large" });
  });

  test("an error without a status returns a generic 500", async () => {
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(logger.error).toHaveBeenCalledWith("Request failed", expect.objectContaining({
      method: "GET", path: "/boom", err: expect.any(Error),
    }));
  });

  test("a non-exposed 4xx keeps its status but hides the message", async () => {
    const res = await fetch(`${base}/teapot`);
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "Bad request" });
    expect(logger.warn).toHaveBeenCalledWith("Client error 418");
  });

  test("a valid request still works", async () => {
    const res = await post(JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe("errorHandler unit", () => {
  function fakeRes(headersSent) {
    const res = { headersSent };
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  test("delegates to next(err) when headers were already sent", () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const res = fakeRes(true);
    const next = jest.fn();
    const err = new Error("mid-stream failure");
    errorHandler(logger)(err, { method: "GET", path: "/api/games", url: "/api/games?token=x", userId: "u1" }, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("Request failed", { method: "GET", path: "/api/games", userId: "u1", err });
  });

  test("a 5xx status on the error is not passed through", () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const res = fakeRes(false);
    const err = Object.assign(new Error("upstream"), { status: 503, expose: false });
    errorHandler(logger)(err, {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });
});
