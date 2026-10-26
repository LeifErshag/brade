// The name a signed-out player last chose, so they don't retype it for every
// game. Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and a failure just means an empty field.
const KEY = "guest_name";

// Keep in sync with GuestNameSchema in server/src/routes/guestName.js.
export const GUEST_NAME_MAX = 30;

export function loadGuestName() {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function saveGuestName(name) {
  try { localStorage.setItem(KEY, name); } catch { /* not persisted */ }
}
