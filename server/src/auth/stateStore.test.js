import { jest } from "@jest/globals";
import express from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { cookieStateStore, STATE_COOKIE } from "./stateStore.js";

function fakeReq(signedCookies = {}) {
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  return { req: { signedCookies, res }, res };
}

function issueState() {
  const { req, res } = fakeReq();
  let state;
  cookieStateStore.store(req, {}, (err, s) => { state = s; });
  return { state, res };
}

function verify(signedCookies, providedState) {
  const { req, res } = fakeReq(signedCookies);
  const callback = jest.fn();
  cookieStateStore.verify(req, providedState, {}, callback);
  return { callback, res };
}

describe("cookieStateStore", () => {
  test("store issues a random state and sets it as a signed httpOnly cookie", () => {
    const { state, res } = issueState();
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(issueState().state).not.toBe(state);
    expect(res.cookie).toHaveBeenCalledWith(STATE_COOKIE, state, expect.objectContaining({
      httpOnly: true, signed: true, sameSite: "lax", path: "/auth", maxAge: expect.any(Number),
    }));
  });

  test("verify accepts a state matching the cookie", () => {
    const { callback } = verify({ [STATE_COOKIE]: "abc123" }, "abc123");
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  test.each([
    ["mismatched state",  { [STATE_COOKIE]: "abc123" }, "evil99"],
    ["different length",  { [STATE_COOKIE]: "abc123" }, "abc"],
    ["missing cookie",    {},                           "abc123"],
    ["tampered cookie",   { [STATE_COOKIE]: false },    "abc123"],
    ["missing state",     { [STATE_COOKIE]: "abc123" }, undefined],
  ])("verify rejects %s", (_name, cookies, provided) => {
    const { callback } = verify(cookies, provided);
    expect(callback).toHaveBeenCalledWith(null, false, expect.objectContaining({ message: expect.any(String) }));
  });

  test("verify clears the cookie so a state is single-use", () => {
    const { res } = verify({ [STATE_COOKIE]: "abc123" }, "abc123");
    expect(res.clearCookie).toHaveBeenCalledWith(STATE_COOKIE, { path: "/auth" });
  });
});

describe("OAuth flow with cookieStateStore", () => {
  let server, base;

  beforeAll(async () => {
    // A fresh Passport instance keeps the test strategy off the global singleton.
    const authenticator = new passport.Passport();
    authenticator.use("github-test", new GitHubStrategy(
      {
        clientID: "id", clientSecret: "secret",
        callbackURL: "http://localhost/auth/github/callback",
        store: cookieStateStore,
      },
      (_a, _r, _profile, done) => done(null, { id: "u1" })
    ));
    const app = express();
    app.use(cookieParser("test-secret"));
    app.get("/auth/github", authenticator.authenticate("github-test", { session: false }));
    app.get("/auth/github/callback",
      authenticator.authenticate("github-test", { session: false, failureRedirect: "/failed" }),
      (_req, res) => res.send("ok"));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test("authorize redirect carries a state that matches the cookie", async () => {
    const res = await fetch(`${base}/auth/github`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const state = new URL(res.headers.get("location")).searchParams.get("state");
    expect(state).toBeTruthy();
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${STATE_COOKIE}=s%3A${state}.`);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  test("callback with no state cookie redirects to failure", async () => {
    const res = await fetch(`${base}/auth/github/callback?code=x&state=forged`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/failed");
  });

  test("callback with a state from another browser redirects to failure", async () => {
    const start = await fetch(`${base}/auth/github`, { redirect: "manual" });
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const res = await fetch(`${base}/auth/github/callback?code=x&state=forged`, {
      redirect: "manual", headers: { cookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/failed");
  });
});
