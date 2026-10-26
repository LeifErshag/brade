import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as DiscordStrategy } from "passport-discord";
import { query } from "../db/postgres.js";
import { cookieStateStore } from "./stateStore.js";
import { profileFields } from "./profile.js";

function makeOAuthHandler(provider) {
  return async (_accessToken, _refreshToken, profile, done) => {
    try {
      const { oauthId, name, avatar } = profileFields(provider, profile);

      // Upsert user — create on first login, update avatar/name on subsequent logins
      const { rows } = await query(
        `INSERT INTO users (oauth_provider, oauth_id, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (oauth_provider, oauth_id)
         DO UPDATE SET avatar_url = EXCLUDED.avatar_url
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
    store:        cookieStateStore,
  },
  makeOAuthHandler("google")
));

passport.use(new GitHubStrategy(
  {
    clientID:     process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL:  process.env.GITHUB_CALLBACK_URL,
    store:        cookieStateStore,
  },
  makeOAuthHandler("github")
));

passport.use(new MicrosoftStrategy(
  {
    clientID:     process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL:  process.env.MICROSOFT_CALLBACK_URL,
    tenant:       "common", // personal (Outlook/Hotmail) and work/school accounts
    store:        cookieStateStore,
  },
  makeOAuthHandler("microsoft")
));

passport.use(new DiscordStrategy(
  {
    clientID:     process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL:  process.env.DISCORD_CALLBACK_URL,
    store:        cookieStateStore,
  },
  makeOAuthHandler("discord")
));

export default passport;