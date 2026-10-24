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
// so `log` can stand in wherever a console-like logger is injected.
//
// Output goes through console.log / console.error looked up at call time, so
// tests that spy on console keep silencing it.
//
// Never pass secrets or personal data: fields named like tokens, cookies,
// passwords, secrets or emails are dropped.

const LEVELS = ["info", "warn", "error"];
const UNSAFE_KEY = /token|cookie|password|secret|authorization|email/i;

function serializeError(err) {
  if (!(err instanceof Error)) return { message: String(err) };
  const out = { message: err.message };
  if (err.name && err.name !== "Error") out.name = err.name;
  if (err.code !== undefined) out.code = err.code;
  if (err.stack) out.stack = err.stack;
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

// Builds the entry for one call. Exported for tests.
export function buildEntry(level, msg, fields) {
  const entry = { t: new Date().toISOString(), level };
  if (msg instanceof Error) {
    entry.msg = msg.message;
    entry.err = serializeError(msg);
  } else {
    entry.msg = String(msg);
  }
  if (fields instanceof Error || (fields !== undefined && !isPlainObject(fields))) {
    entry.err = serializeError(fields);
  } else if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || UNSAFE_KEY.test(key)) continue;
      if (key === "err") entry.err = serializeError(value);
      else if (!(key in entry)) entry[key] = value;
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
    // e.g. a circular field: still log something rather than throw.
    line = format(buildEntry(level, msg));
  }
  if (level === "info") console.log(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

export const log = Object.fromEntries(
  LEVELS.map(level => [level, (msg, fields) => write(level, msg, fields)])
);

export default log;
