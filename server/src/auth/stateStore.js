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

// Arity matters: passport-oauth2 picks the call signature from `.length`.
export const cookieStateStore = {
  store(req, _meta, callback) {
    const state = crypto.randomBytes(24).toString("base64url");
    req.res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: STATE_MAX_AGE });
    callback(null, state);
  },

  verify(req, providedState, _meta, callback) {
    const expected = req.signedCookies?.[STATE_COOKIE];
    // Single use. Only the path (and domain) must match for the browser to
    // drop the cookie; `signed` is ignored by clearCookie.
    req.res.clearCookie(STATE_COOKIE, { path: "/auth" });

    if (typeof expected !== "string" || typeof providedState !== "string"
        || !safeEqual(expected, providedState)) {
      return callback(null, false, { message: "Invalid authorization request state." });
    }
    return callback(null, true);
  },
};
