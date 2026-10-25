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
// JWTs) is masked, and the input values that pg quotes in an error's
// message and detail are left out (see maskPg for which ones).

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
  if (value instanceof Map) {
    if ([...value.keys()].every(k => typeof k === "string")) return scrub(Object.fromEntries(value), depth + 1);
    // Other keys would collapse into "[object Object]" and overwrite each
    // other, so keep the [key, value] pairs instead.
    const pairs = [...value].filter(([k]) => typeof k !== "string" || !UNSAFE_KEY.test(k));
    return scrub(pairs, depth + 1);
  }
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

// pg quotes input values, which may be personal data, in an error's detail
// ("Key (room_id)=(…) already exists.", "Failing row contains (…).",
// 'Token "…" is invalid.') and, for codes like 22P02, in its message
// ('invalid input syntax for type uuid: "…"'), or mid-message for 22003
// ('value "…" is out of range for type integer'), or at its start
// ('"…" is out of range for type real', '"…" is not a valid binary digit').
// Some other errors quote one too: 'time zone "…" not recognized',
// 'interval time zone "…" must not include months or days',
// 'unit "…" not recognized', 'unit "…" not supported for type …',
// 'invalid value "…" for "MON"' (to_date), and the details
// 'Unexpected "…" character.' (arrays), 'Expected …, but found "…".' and
// 'Escape sequence "…" is invalid.' (JSON) and '… for time zone
// abbreviation "…".' (time zones).
// Mask those, including values that span lines (but see maskPgStack for the
// frame-like lines of a changed message). A ': "' value is the end of
// pg's message, so it is masked to the end of the text even if it holds a
// '"' itself. A message that starts with an identifier ('"games" is not a
// sequence', 'relation "games" does not exist') is kept, as is a stack's
// "Error: " header. A value whose closing quote is missing, or a message cut
// off after a value that starts it (only our own code can cut one off), is
// masked too. This covers the forms pg uses for constraint, input and range
// errors and the ones above; a value quoted some other way would still be
// logged, so user text should be validated before it reaches the database.
function maskPg(text) {
  return maskLeadingValue(redact(text)
    .replace(/=\(.*\)/gs, "=(…)")
    .replace(/contains \(.*\)/gs, "contains (…)")
    .replace(/(Token|Escape sequence) ".*" is invalid/gs, '$1 "…" is invalid')
    .replace(/".*" is (out of range|not a valid (?:binary|hexadecimal) digit)/gs, '"…" is $1')
    .replace(/(time zone|unit) ".*" not (recognized|supported)/gs, '$1 "…" not $2')
    .replace(/time zone ".*" must not include/gs, 'time zone "…" must not include')
    .replace(/time zone abbreviation ".*"/gs, 'time zone abbreviation "…"')
    .replace(/invalid value ".*" for "/gs, 'invalid value "…" for "')
    .replace(/Unexpected ".*" character/gs, 'Unexpected "…" character')
    .replace(/but found ".*"/gs, 'but found "…"')
    .replace(/(?<!^[\w$.]*[Ee]rror): ".*?("?)$/s, ': "…$1'));
}

// What follows a value that starts pg's message.
const AFTER_LEADING_VALUE = [" is out of range for type ", " is not a valid binary digit", " is not a valid hexadecimal digit"];

// A message (after a stack's "Error: " header) that starts with a value and
// was cut off inside it ('"Anna', '"Anna "Bo') or inside the text after it
// ('"Anna" is out of ra'). A quote right before a letter or digit opens a
// quote inside the value rather than closing it, so the value is still open.
// pg follows a closing quote with a space or punctuation, so an identifier
// that starts the message ('"games" is not a sequence') is kept. One followed
// by nothing or by the start of a value's text is masked ('"games"' →
// '"…"', '"games" is ' → '"…" is '), which only ever masks more. A cut
// message whose stack still holds the whole one is masked from that instead
// (see maskPgMessage), so this guess only covers a message without one.
function maskLeadingValue(text) {
  const m = /^((?:[\w$.]*[Ee]rror: )?)"(.*)$/s.exec(text);
  if (!m) return text;
  const close = m[2].lastIndexOf('"');
  if (close < 0) return `${m[1]}"…`;
  const rest = m[2].slice(close + 1);
  if (/^[\p{L}\p{N}]/u.test(rest)) return `${m[1]}"…`;
  return AFTER_LEADING_VALUE.some(after => rest.startsWith(after) || after.startsWith(rest)) ? `${m[1]}"…"${rest}` : text;
}

// A V8 stack frame: "    at fn (file:1:2)", "    at file:1:2",
// "    at new Promise (<anonymous>)", "    at async Promise.all (index 0)".
const STACK_FRAME = /^\s+at .*(?::\d+:\d+\)?|\(?<anonymous>\)?|\(native\)|\(index \d+\))$/;

// Masks the part of a stack before its frames, i.e. the message the stack
// was captured with. The frames are the lines at the end that look like
// frames, so a line of the message that looks like one ("    at …") is still
// masked as long as a line after it doesn't (pg's quoted values end in '"').
// A frame-like line the engine wrote some other way is masked too.
function maskStackHead(stack) {
  const lines = stack.split("\n");
  const first = firstFrame(lines);
  return [maskPg(lines.slice(0, first).join("\n")), ...lines.slice(first)].join("\n");
}

// The index of a stack's first frame line (see maskStackHead).
function firstFrame(lines) {
  let first = lines.length;
  while (first > 1 && STACK_FRAME.test(lines[first - 1])) first--;
  return first;
}

// The "Name: " header a stack starts with. V8 writes err.name there, which
// may hold any character ("Database Error"), so that is tried first; a name
// changed since the stack was captured falls back to a name-like header.
function stackHeader(stack, name) {
  if (typeof name === "string" && name && stack.startsWith(`${name}: `)) return `${name}: `;
  return /^[\w$.]*: /.exec(stack)?.[0] ?? "";
}

// The message a stack was captured with, if the current message is a cut
// of it (a proper prefix).
function cutFrom(stack, message, name) {
  const lines = stack.split("\n");
  const head = lines.slice(0, firstFrame(lines)).join("\n");
  const old = head.slice(stackHeader(head, name).length);
  return message && old.length > message.length && old.startsWith(message) ? old : undefined;
}

// Masks a pg error's message. One our own code cut off from the message its
// stack was captured with is masked from that whole message instead, so a cut
// inside a value isn't taken for the value's end ('"Anna "Bo" Svens'). The
// masked text that differs from the old one sits between their common start
// and common end: a cut in the common end keeps the masked text up to it, and
// a cut inside the masked part ends in "…" right after the common start.
function maskPgMessage(message, stack, name) {
  const old = stack ? cutFrom(stack, message, name) : undefined;
  if (old === undefined) return maskPg(message);
  const masked = maskPg(old);
  let start = 0;
  while (start < old.length && old[start] === masked[start]) start++;
  if (message.length <= start) return maskPg(message);
  let end = 0;
  while (
    end < Math.min(old.length, masked.length) - start
    && old[old.length - 1 - end] === masked[masked.length - 1 - end]
  ) end++;
  const kept = message.length - (old.length - end);
  return kept < 0 ? `${masked.slice(0, start)}…` : masked.slice(0, masked.length - end + kept);
}

// A stack is "Name: message" and then its frames. If it still holds the
// error's current message, only that is swapped for the masked one, so an
// unchanged message reads the same in the stack. Otherwise (the message was
// changed after the stack was captured) the whole head is masked. The text
// before the message must be just the name and every line after it a frame,
// or the current message may be the tail or the start of the old one.
// The current message may also be a middle slice of the old one, ending in
// lines that look like frames, so those lines are kept as frames; where it
// still appears afterwards it is swapped for the masked one too. That swap
// runs over the frames as well, not just the head: a line of the old message
// that looks like a frame may hold the current message, and a real frame
// whose file path holds it is rewritten too, which only ever masks more.
// A frame-like line of the old message may also quote a value the current
// message doesn't hold, so every frame is then masked like a message line
// too. A real frame holds none of the forms maskPg masks, so it reads the
// same (a function named "contains" would lose its location). Each frame is
// masked on its own, because the ': "', '=(' and 'contains (' rules would
// otherwise swallow the real frames after it. So a value of the old message
// that continues onto a frame-like line keeps the part on that line
// ('    at f contains (Anna (y:1:2)' and '    at g, Bo) (y:3:4)' →
// '    at f contains (…)' and '    at g, Bo) (y:3:4)'), also when it starts on
// the line before the frames. That needs our own code to change a pg message
// whose value spans such lines.
function maskPgStack(stack, message, masked, name) {
  const at = message ? stack.indexOf(message) : -1;
  if (at === 0 || (at > 0 && at === stackHeader(stack, name).length)) {
    const rest = stack.slice(at + message.length);
    if (rest.split("\n").slice(1).every(line => STACK_FRAME.test(line)) && /^(?:\n|$)/.test(rest)) {
      return stack.slice(0, at) + masked + rest;
    }
  }
  const head = maskStackHead(stack);
  const swapped = message ? head.split(message).join(masked) : head;
  return swapped.split("\n").map(line => (STACK_FRAME.test(line) ? maskPg(line) : line)).join("\n");
}

// pg's DatabaseError carries the server's severity ("ERROR", "FATAL", …).
function isPgError(err) {
  return typeof err.severity === "string";
}

// How many causes deep err.cause is followed.
const MAX_CAUSES = 3;

function serializeError(err, causes = 0) {
  if (!(err instanceof Error)) return { message: redact(describe(err)) };
  const pg = isPgError(err);
  const message = redact(err.message);
  const stack = err.stack ? redact(err.stack) : undefined;
  const out = { message: pg ? maskPgMessage(message, stack, err.name) : message };
  if (typeof err.name === "string" && err.name !== "Error") out.name = err.name;
  if (typeof err.code === "string" || typeof err.code === "number") out.code = err.code;
  // pg's DatabaseError fields: which constraint, table or column was involved.
  if (typeof err.detail === "string") out.detail = maskPg(err.detail);
  for (const key of ["constraint", "table", "column"]) {
    if (typeof err[key] === "string") out[key] = redact(err[key]);
  }
  if (stack !== undefined) {
    // The stack starts with the message, so mask it the same way.
    out.stack = pg ? maskPgStack(stack, message, out.message, err.name) : stack;
  }
  if (err.cause !== undefined) {
    out.cause = causes < MAX_CAUSES ? serializeError(err.cause, causes + 1) : "[too deep]";
  }
  return out;
}

// Builds the entry for one call. Exported for tests.
export function buildEntry(level, msg, fields) {
  const entry = { t: new Date().toISOString(), level };
  if (msg instanceof Error) {
    entry.err = serializeError(msg);
    entry.msg = entry.err.message;
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

function pairs(fields) {
  return Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
}

// A serialised error as indented lines: its stack (or message), its other
// fields (code, detail, …), then its cause.
function prettyError(err, indent = "  ") {
  if (typeof err !== "object") return `${indent}${err}`;
  const { message, stack, cause, ...fields } = err;
  delete fields.name; // already at the start of the stack
  const lines = String(stack ?? message).split("\n").map(l => `${indent}${l}`);
  if (Object.keys(fields).length) lines.push(`${indent}${pairs(fields).join(" ")}`);
  if (cause !== undefined) lines.push(`${indent}Caused by:`, prettyError(cause, `${indent}  `));
  return lines.join("\n");
}

export function format(entry, json = useJson()) {
  if (json) return JSON.stringify(entry);
  const { t, level, msg, err, ...rest } = entry;
  const extras = pairs(rest);
  let line = `${t} ${level.toUpperCase()} ${msg}${extras.length ? ` ${extras.join(" ")}` : ""}`;
  if (err) line += `\n${prettyError(err)}`;
  return line;
}

// The string, number and boolean fields that can be read without throwing,
// for the fallback line. undefined if the fields can't be listed (e.g. a
// Proxy whose ownKeys trap throws), so the message is still kept.
function plainFields(fields) {
  let keys;
  try {
    if (!isPlainObject(fields)) return undefined;
    keys = Object.keys(fields);
  } catch {
    return undefined;
  }
  const out = {};
  for (const key of keys) {
    try {
      const value = fields[key];
      if (["string", "number", "boolean"].includes(typeof value)) out[key] = value;
    } catch { /* a throwing getter: leave it out */ }
  }
  return out;
}

function write(level, msg, fields) {
  let line;
  try {
    line = format(buildEntry(level, msg, fields));
  } catch {
    // e.g. a circular field: still log something rather than throw. Logging
    // runs in error handlers (the pg pool's, the process's), so it must
    // never throw itself. Keep the plain fields (roomId, userId) if possible.
    try {
      line = format(buildEntry(level, msg, plainFields(fields)));
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
