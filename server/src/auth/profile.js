// users.display_name is VARCHAR(50); Entra work-account names can be far longer.
const MAX_NAME = 50;

// Trims and truncates by code point so an emoji or å is never split in half.
function clampName(name) {
  return Array.from((name || "").trim()).slice(0, MAX_NAME).join("") || "Player";
}

// Normalises a passport profile into the fields we store on `users`.
// Google, GitHub and Microsoft return passport's standard profile shape;
// passport-discord returns Discord's raw /users/@me object instead.
export function profileFields(provider, profile) {
  if (provider === "discord") {
    return {
      oauthId: profile.id,
      name:    clampName(profile.global_name || profile.username),
      avatar:  profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null,
    };
  }
  return {
    oauthId: profile.id,
    name:    clampName(profile.displayName || profile.username),
    avatar:  profile.photos?.[0]?.value || null,
  };
}
