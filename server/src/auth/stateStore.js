import crypto from "crypto";
import { Buffer } from "buffer";

// passport-oauth2 state store that binds the OAuth `state` parameter to the
// browser with a short-lived signed httpOnly cookie, so a callback can only
// complete in the browser that started the flow (login CSRF protection).
// Stateless on the server: no session store needed.
//
// Known limitation (accepted, no change planned): there is one state cookie
// per browser, so starting login in two tabs at once overwrites the first
// tab's state. That tab's callback then fails and lands on `?error=auth`;
// the user just retries.
export const STATE_COOKIE = "oauth_state";

const STATE_MAX_AGE = 10 * 60 * 1000; // 10 minutes ms

function cookieOptions() {
  return {
    httpOnly: true,
    signed:   true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",  // sent on the provider's top-level redirect back to us
    path:     "/auth",
  };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const CLEARED = Symbol("oauthStateCleared");

// Expire the state cookie. Only name, path and domain have to match for the
// browser to drop it. Idempotent per response, so the callback route's
// failure handling does not add a second Set-Cookie after `verify` cleared it.
export function clearStateCookie(res) {
  if (res[CLEARED]) return;
  res[CLEARED] = true;
  res.clearCookie(STATE_COOKIE, { path: "/auth" });
}

// OAuth callback middleware. passport-oauth2 fails or errors without calling
// the store's `verify` when the provider reports an error (e.g. the user
// declines consent: `?error=access_denied`), so the state cookie is cleared
// here on every unsuccessful outcome. Failures redirect to `failureRedirect`;
// errors go to the Express error handler, as with passport's built-in options.
export function oauthCallback(authenticator, strategy, failureRedirect) {
  return (req, res, next) => {
    authenticator.authenticate(strategy, { session: false }, (err, user) => {
      if (err) {
        clearStateCookie(res);
        return next(err);
      }
      if (!user) {
        clearStateCookie(res);
        return res.redirect(failureRedirect);
      }
      req.user = user;
      return next();
    })(req, res, next);
  };
}

// Arity matters: passport-oauth2 picks the call signature from `.length`.
export const cookieStateStore = {
  store(req, _meta, callback) {
    const state = crypto.randomBytes(24).toString("base64url");
    req.res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: STATE_MAX_AGE });
    callback(null, state);
  },

  verify(req, providedState, _meta, callback) {
    const expected = req.signedCookies?.[STATE_COOKIE];
    // Single use: cleared whether or not the state matches.
    clearStateCookie(req.res);

    if (typeof expected !== "string" || typeof providedState !== "string"
        || !safeEqual(expected, providedState)) {
      return callback(null, false, { message: "Invalid authorization request state." });
    }
    return callback(null, true);
  },
};
