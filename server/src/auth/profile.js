// Normalises a passport profile into the fields we store on `users`.
// Google, GitHub and Microsoft return passport's standard profile shape;
// passport-discord returns Discord's raw /users/@me object instead.
export function profileFields(provider, profile) {
  if (provider === "discord") {
    return {
      oauthId: profile.id,
      name:    profile.global_name || profile.username || "Player",
      avatar:  profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null,
    };
  }
  return {
    oauthId: profile.id,
    name:    profile.displayName || profile.username || "Player",
    avatar:  profile.photos?.[0]?.value || null,
  };
}
