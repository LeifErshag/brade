import express from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as DiscordStrategy } from "passport-discord";
import { cookieStateStore, STATE_COOKIE } from "./stateStore.js";
import { profileFields } from "./profile.js";

describe("profileFields", () => {
  test("uses passport's standard profile shape for Google, GitHub and Microsoft", () => {
    expect(profileFields("google", {
      id: "g1", displayName: "Anna", photos: [{ value: "https://example.com/a.png" }],
    })).toEqual({ oauthId: "g1", name: "Anna", avatar: "https://example.com/a.png" });
    expect(profileFields("github", { id: "7", username: "octo" }))
      .toEqual({ oauthId: "7", name: "octo", avatar: null });
    expect(profileFields("microsoft", { id: "m1", displayName: "Bo Ek", name: {} }))
      .toEqual({ oauthId: "m1", name: "Bo Ek", avatar: null });
  });

  test("maps Discord's raw user object, preferring the global name", () => {
    expect(profileFields("discord", {
      id: "123", username: "bo_ek", global_name: "Bo", avatar: "abc",
    })).toEqual({
      oauthId: "123", name: "Bo", avatar: "https://cdn.discordapp.com/avatars/123/abc.png",
    });
    expect(profileFields("discord", { id: "123", username: "bo_ek", global_name: null, avatar: null }))
      .toEqual({ oauthId: "123", name: "bo_ek", avatar: null });
  });

  test("falls back to a placeholder name", () => {
    expect(profileFields("discord", { id: "1" }).name).toBe("Player");
    expect(profileFields("microsoft", { id: "1" }).name).toBe("Player");
    expect(profileFields("google", { id: "1", displayName: "   " }).name).toBe("Player");
  });

  test("trims names and clamps them to the 50-character display_name column", () => {
    const long = "Lastname, Firstname (Department of Something / Company AB)";
    expect(profileFields("microsoft", { id: "1", displayName: `  ${long}  ` }).name)
      .toBe(long.slice(0, 50));
    // Truncation counts code points, so a trailing emoji is kept whole.
    const emoji = profileFields("discord", { id: "1", global_name: `${"å".repeat(49)}😀😀` }).name;
    expect(Array.from(emoji)).toHaveLength(50);
    expect(emoji.endsWith("😀")).toBe(true);
  });
});

describe("Microsoft and Discord strategies", () => {
  let server, base;

  beforeAll(async () => {
    const authenticator = new passport.Passport();
    const opts = (name) => ({
      clientID: "id", clientSecret: "secret",
      callbackURL: `http://localhost/auth/${name}/callback`,
      store: cookieStateStore,
    });
    const verify = (_a, _r, profile, done) => done(null, profile);
    authenticator.use(new MicrosoftStrategy({ ...opts("microsoft"), tenant: "common" }, verify));
    authenticator.use(new DiscordStrategy(opts("discord"), verify));

    const app = express();
    app.use(cookieParser("test-secret"));
    app.get("/auth/microsoft", authenticator.authenticate("microsoft", { scope: ["User.Read"], session: false }));
    app.get("/auth/discord", authenticator.authenticate("discord", { scope: ["identify"], session: false }));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test.each([
    ["microsoft", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "User.Read"],
    ["discord",   "https://discord.com/api/oauth2/authorize",                      "identify"],
  ])("/auth/%s redirects to the provider with a state bound to a cookie", async (name, authorizeUrl, scope) => {
    const res = await fetch(`${base}/auth/${name}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location"));
    expect(`${location.origin}${location.pathname}`).toBe(authorizeUrl);
    expect(location.searchParams.get("scope")).toBe(scope);
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(res.headers.getSetCookie().some(c => c.startsWith(`${STATE_COOKIE}=`))).toBe(true);
  });
});
