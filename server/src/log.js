// Minimal structured logger, so a player's problem can be traced in Render's
// log viewer by searching for their userId or roomId.
//
//   log.info("Game started", { roomId, userId });
//   log.error("AI turn error", { roomId, err });
//
// In production (NODE_ENV=production, or on Render) every call prints one JSON line:
//   {"t":"…","level":"error","msg":"AI turn error","roomId":"A3F9B2C1","err":{"message":"…","stack":"…"}}
// Elsewhere it prints a readable line instead (LOG_FORMAT=json|pretty overrides).
//
// The second argument may also be an Error on its own (log.error("msg", err)),
// so `log` can stand in wherever a console-like logger is injected. A value
// that may not be an Error (a rejection reason) belongs in { err }, which
// records whatever it is, including undefined.
//
// Output goes through console.log / console.error looked up at call time, so
// tests that spy on console keep silencing it.
//
// Never pass secrets or personal data. As a safety net, fields named like
// tokens, cookies, passwords, secrets or emails are dropped (also inside
// nested objects), token-looking text in strings (`token=…`, `Bearer …`,
// JWTs) is masked, and the row values that pg quotes in an error's detail
// are left out.

const LEVELS = ["info", "warn", "error"];
const UNSAFE_KEY = /token|cookie|password|secret|authorization|email/i;

const SECRET_TEXT = [
  [/([?&]token=)[^&\s"']+/gi, "$1[redacted]"],
  [/(Bearer\s+)[\w.~+/=-]+/gi, "$1[redacted]"],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
];
const MAX_DEPTH = 4;

// String() itself throws for some values (e.g. Object.create(null)).
function safeString(value) {
  try { return String(value); } catch { return "[unprintable]"; }
}

export function redact(text) {
  let out = typeof text === "string" ? text : safeString(text);
  for (const [pattern, replacement] of SECRET_TEXT) out = out.replace(pattern, replacement);
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

// Masks token-looking text and drops unsafe keys, recursing into objects and
// arrays. Anything else that JSON.stringify would print is turned into plain
// data first (toJSON's result, a Map's entries, a Set's values, an Error's
// serialised form, a class instance's own fields), so it is checked too.
function scrub(value, depth = 0) {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value !== "object") return value;
  // Too deep to check for unsafe keys: leave it out.
  if (depth >= MAX_DEPTH) return "[too deep]";
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if (value instanceof Error) return serializeError(value);
  if (typeof value.toJSON === "function") {
    let json;
    try { json = value.toJSON(); } catch { return "[unprintable]"; }
    return scrub(json, depth + 1);
  }
  if (value instanceof Map) return scrub(Object.fromEntries(value), depth + 1);
  if (value instanceof Set) return scrub([...value], depth + 1);
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined && !UNSAFE_KEY.test(key)) out[key] = scrub(v, depth + 1);
  }
  return out;
}

// Anything can be thrown or rejected with, so a non-Error is kept as text.
function describe(value) {
  if (typeof value === "string") return value;
  if (isPlainObject(value) || Array.isArray(value)) {
    try { return JSON.stringify(scrub(value)); } catch { /* circular: fall through */ }
  }
  return safeString(value);
}

// pg's detail quotes row values ("Key (room_id)=(…) already exists.",
// "Failing row contains (…)."), which may be personal data: mask them.
function maskDetail(detail) {
  return redact(detail).replace(/=\(.*\)/g, "=(…)").replace(/contains \(.*\)/g, "contains (…)");
}

// How many causes deep err.cause is followed.
const MAX_CAUSES = 3;

function serializeError(err, causes = 0) {
  if (!(err instanceof Error)) return { message: redact(describe(err)) };
  const out = { message: redact(err.message) };
  if (typeof err.name === "string" && err.name !== "Error") out.name = err.name;
  if (typeof err.code === "string" || typeof err.code === "number") out.code = err.code;
  // pg's DatabaseError fields: which constraint, table or column was involved.
  if (typeof err.detail === "string") out.detail = maskDetail(err.detail);
  for (const key of ["constraint", "table", "column"]) {
    if (typeof err[key] === "string") out[key] = redact(err[key]);
  }
  if (err.stack) out.stack = redact(err.stack);
  if (err.cause !== undefined) {
    out.cause = causes < MAX_CAUSES ? serializeError(err.cause, causes + 1) : "[too deep]";
  }
  return out;
}

// Builds the entry for one call. Exported for tests.
export function buildEntry(level, msg, fields) {
  const entry = { t: new Date().toISOString(), level };
  if (msg instanceof Error) {
    entry.msg = redact(msg.message);
    entry.err = serializeError(msg);
  } else {
    entry.msg = redact(describe(msg));
  }
  if (fields instanceof Error || (fields != null && !isPlainObject(fields))) {
    entry.err = serializeError(fields);
  } else if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      // err is kept even when undefined: a rejection without a reason
      // should still say so.
      if (key === "err") entry.err = serializeError(value);
      else if (value === undefined || UNSAFE_KEY.test(key)) continue;
      else if (!(key in entry)) entry[key] = scrub(value);
    }
  }
  return entry;
}

function useJson() {
  const format = process.env.LOG_FORMAT;
  if (format === "json") return true;
  if (format === "pretty") return false;
  // Render sets RENDER=true on every service; NODE_ENV may be unset there.
  return process.env.NODE_ENV === "production" || process.env.RENDER === "true";
}

export function format(entry, json = useJson()) {
  if (json) return JSON.stringify(entry);
  const { t, level, msg, err, ...rest } = entry;
  const extras = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  let line = `${t} ${level.toUpperCase()} ${msg}${extras.length ? ` ${extras.join(" ")}` : ""}`;
  if (err) line += `\n  ${err.stack ?? err.message}`;
  return line;
}

function write(level, msg, fields) {
  let line;
  try {
    line = format(buildEntry(level, msg, fields));
  } catch {
    // e.g. a circular field: still log something rather than throw. Logging
    // runs in error handlers (the pg pool's, the process's), so it must
    // never throw itself.
    try {
      line = format(buildEntry(level, msg));
    } catch {
      line = format({ t: new Date().toISOString(), level, msg: "[unloggable message]" });
    }
  }
  if (level === "info") console.log(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

export const log = Object.fromEntries(
  LEVELS.map(level => [level, (msg, fields) => write(level, msg, fields)])
);

export default log;
