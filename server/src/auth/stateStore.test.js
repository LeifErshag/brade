import { jest } from "@jest/globals";
import { URLSearchParams } from "url";
import express from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { cookieStateStore, oauthCallback, STATE_COOKIE } from "./stateStore.js";

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

  test("verify clears the cookie on a rejected state too", () => {
    const { res } = verify({ [STATE_COOKIE]: "abc123" }, "evil99");
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    expect(res.clearCookie).toHaveBeenCalledWith(STATE_COOKIE, { path: "/auth" });
  });
});

// Set-Cookie headers that expire the state cookie.
function stateClears(res) {
  return res.headers.getSetCookie().filter((c) =>
    c.startsWith(`${STATE_COOKIE}=;`) && /Expires=Thu, 01 Jan 1970/i.test(c) && /Path=\/auth/i.test(c));
}

describe("OAuth flow with cookieStateStore", () => {
  let server, base;

  beforeAll(async () => {
    // A fresh Passport instance keeps the test strategy off the global singleton.
    const authenticator = new passport.Passport();
    const strategy = new GitHubStrategy(
      {
        clientID: "id", clientSecret: "secret",
        callbackURL: "http://localhost/auth/github/callback",
        store: cookieStateStore,
      },
      (_a, _r, profile, done) => done(null, { id: `user-${profile.id}` })
    );
    // Stub the provider round-trips (code exchange, profile fetch) so the
    // success path runs without network access.
    strategy._oauth2.getOAuthAccessToken = (code, _params, cb) =>
      (code === "good-code" ? cb(null, "access", "refresh", {}) : cb(new Error("bad code")));
    strategy.userProfile = (_accessToken, done) => done(null, { id: "42", provider: "github" });
    authenticator.use("github-test", strategy);

    const app = express();
    app.use(cookieParser("test-secret"));
    app.get("/auth/github", authenticator.authenticate("github-test", { session: false }));
    app.get("/auth/github/callback",
      oauthCallback(authenticator, "github-test", "/failed"),
      (req, res) => res.send(`ok ${req.user.id}`));
    app.use((err, _req, res, _next) => res.status(500).send("error"));
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

  async function startLogin() {
    const res = await fetch(`${base}/auth/github`, { redirect: "manual" });
    const state = new URL(res.headers.get("location")).searchParams.get("state");
    const cookie = res.headers.get("set-cookie").split(";")[0];
    return { state, cookie };
  }

  function callback(params, cookie) {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${base}/auth/github/callback?${qs}`, {
      redirect: "manual", headers: cookie ? { cookie } : {},
    });
  }

  test("callback with the matching state and cookie logs in and clears the cookie", async () => {
    const { state, cookie } = await startLogin();
    const res = await callback({ code: "good-code", state }, cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok user-42");
    expect(stateClears(res)).toHaveLength(1);
  });

  test("callback with no state cookie redirects to failure", async () => {
    const res = await callback({ code: "x", state: "forged" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/failed");
  });

  test("callback with a state from another browser redirects to failure and clears once", async () => {
    const { cookie } = await startLogin();
    const res = await callback({ code: "x", state: "forged" }, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/failed");
    expect(stateClears(res)).toHaveLength(1);
  });

  test("consent decline (access_denied) redirects to failure and clears the cookie", async () => {
    const { state, cookie } = await startLogin();
    const res = await callback({ error: "access_denied", error_description: "declined", state }, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/failed");
    expect(stateClears(res)).toHaveLength(1);
  });

  test("other provider errors reach the error handler and clear the cookie", async () => {
    const { state, cookie } = await startLogin();
    const res = await callback({ error: "server_error", state }, cookie);
    expect(res.status).toBe(500);
    expect(stateClears(res)).toHaveLength(1);
  });

  test("a failed code exchange reaches the error handler and clears the cookie once", async () => {
    const { state, cookie } = await startLogin();
    const res = await callback({ code: "bad-code", state }, cookie);
    expect(res.status).toBe(500);
    expect(stateClears(res)).toHaveLength(1);
  });
});
