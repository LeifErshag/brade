// Shared by the tournament list and detail pages.

/**
 * Display label of a tournament status ("registration", "finished"…) in the
 * current language. A status without a translation comes back raw. The
 * lookup only follows own properties, so names like "constructor" stay raw.
 */
export function statusLabel(status, t) {
  const key = `tournament.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}
