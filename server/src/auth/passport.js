import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { query } from "../db/postgres.js";

function makeOAuthHandler(provider) {
  return async (_accessToken, _refreshToken, profile, done) => {
    try {
      const oauthId   = profile.id;
      const name      = profile.displayName || profile.username || "Player";
      const avatar    = profile.photos?.[0]?.value || null;

      // Upsert user — create on first login, update avatar/name on subsequent logins
      const { rows } = await query(
        `INSERT INTO users (oauth_provider, oauth_id, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (oauth_provider, oauth_id)
         DO UPDATE SET display_name = EXCLUDED.display_name,
                       avatar_url   = EXCLUDED.avatar_url
         RETURNING id, display_name, elo`,
        [provider, oauthId, name, avatar]
      );
      return done(null, rows[0]);
    } catch (err) {
      return done(err);
    }
  };
}

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL,
  },
  makeOAuthHandler("google")
));

passport.use(new GitHubStrategy(
  {
    clientID:     process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL:  process.env.GITHUB_CALLBACK_URL,
  },
  makeOAuthHandler("github")
));

export default passport;