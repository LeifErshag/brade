// Client-side log that also reaches the server (issue #140).
//
//   clientLog.warn("[ws] closed", { code: 1006, attempt: 2 });
//
// Every call prints to the browser console as before and is kept in a small
// ring buffer (recentLogs(), attached to problem reports). Warnings and errors
// are also POSTed to /api/client-log, where they land in the server log with
// the player's userId, so a reported problem can be traced on Render.
//
// Sending must never get in the way of the game: it is fire-and-forget,
// failures are ignored, and at most MAX_SENDS_PER_MINUTE lines are sent (the
// same message at most once per DEDUPE_MS), so a reconnect loop cannot flood
// the server. The last ERROR_RESERVE of those are kept for errors, so a burst
// of warnings cannot crowd out a crash that follows it.

const API = import.meta.env.VITE_API_URL ?? "";

const BUFFER_SIZE          = 50;
const MAX_SENDS_PER_MINUTE = 10;
const ERROR_RESERVE        = 3;
const DEDUPE_MS            = 30_000;
const MAX_MSG              = 500;
const MAX_CONTEXT_KEYS     = 20;
const MAX_CONTEXT_STRING   = 1000;
const ROOM_ID              = /^[A-Z0-9]{8}$/;
// Below the server's 64 kB body limit for problem reports. Counted in UTF-8
// bytes, as the server counts it.
const MAX_REPORT_BYTES     = 60_000;

const recent   = [];
const sentAt   = [];          // timestamps of sends in the last minute
const lastSent = new Map();   // msg → when it was last sent

// Set by the Game page: the room being played, the token it plays with (a
// guest token is not in sessionStorage under access_token) and a function
// returning a summary of what the page shows, for problem reports.
//
// It is kept when the page unmounts, so a report sent from the crash screen
// after Game crashed still has its room, state and token, but it is only used
// while the address is still that room's page.
let current = { roomId: null, token: null, state: null };

export function setLogContext(next) {
  current = { ...current, ...next };
}

const GAME_PAGE = /^\/game\/([^/]+)\/?$/;

function roomContext() {
  const match = GAME_PAGE.exec(window.location?.pathname ?? "");
  let roomId = null;
  try { roomId = match && decodeURIComponent(match[1]); } catch { /* malformed escape */ }
  return roomId !== null && roomId === current.roomId ? current : {};
}

// The last BUFFER_SIZE log lines, oldest first.
export function recentLogs() {
  return recent.slice();
}

// Same patterns as server/src/log.js, so a token never leaves the browser in
// a log line (e.g. the WebSocket URL carries ?token=).
// String() itself throws for some values (Object.create(null), objects with
// a throwing toString), and anything can be thrown or rejected with.
function safeString(value) {
  try { return String(value); } catch { return "[unprintable]"; }
}

// The message of a thrown value, whatever it is.
export function describeError(value) {
  let message;
  try { message = value?.message; } catch { /* throwing getter */ }
  return safeString(message ?? value);
}

export function redact(text) {
  return safeString(text)
    .replace(/([?&]token=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, "$1[redacted]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]");
}

// Flat, small and scalar-only, as /api/client-log accepts.
function cleanContext(ctx) {
  if (!ctx || typeof ctx !== "object") return undefined;
  const out = {};
  for (const [key, value] of Object.entries(ctx).slice(0, MAX_CONTEXT_KEYS)) {
    const k = key.slice(0, 50);
    if (value === null || typeof value === "number" || typeof value === "boolean") out[k] = value;
    else if (value !== undefined) out[k] = redact(value).slice(0, MAX_CONTEXT_STRING);
  }
  return Object.keys(out).length ? out : undefined;
}

function token() {
  const room = roomContext();
  if (room.token) return room.token;
  try { return sessionStorage.getItem("access_token"); } catch { return null; }
}

// key: the message plus the close code, if any, so a series of different
// closes is not collapsed into the first.
function mayBeSent(level, key) {
  const now = Date.now();
  while (sentAt.length && now - sentAt[0] >= 60_000) sentAt.shift();
  const budget = level === "error" ? MAX_SENDS_PER_MINUTE : MAX_SENDS_PER_MINUTE - ERROR_RESERVE;
  if (sentAt.length >= budget) return false;
  if (now - (lastSent.get(key) ?? -Infinity) < DEDUPE_MS) return false;
  sentAt.push(now);
  lastSent.set(key, now);
  if (lastSent.size > 100) lastSent.delete(lastSent.keys().next().value);
  return true;
}

function send(level, msg, ctx) {
  if (!mayBeSent(level, `${msg}|${ctx?.code ?? ""}`)) return;
  const body = { level, msg: msg.slice(0, MAX_MSG) || "(empty)" };
  const { roomId } = roomContext();
  if (ROOM_ID.test(roomId ?? "")) body.roomId = roomId;
  const page = window.location?.pathname;
  if (page) body.page = page.slice(0, 200);
  const context = cleanContext(ctx);
  if (context) body.context = context;
  const tkn = token();
  // No keepalive: a cross-origin keepalive request that needs a CORS
  // preflight (it carries Authorization) is rejected by some browsers. Lines
  // logged while the page is closing are lost, which is acceptable: the
  // socket cleanup on unload logs nothing.
  try {
    fetch(`${API}/api/client-log`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // Never let logging throw into the caller.
  }
}

// echo: print to the console too (off for errors the browser already printed).
// remote: send warnings and errors to the server.
// Never throws: it runs in error handlers (the error boundary, the global
// handlers), where a throw would lose the original error or blank the page.
function write(level, msg, ctx, { echo = true, remote = true } = {}) {
  try {
    const text = redact(msg);
    if (echo) {
      const out = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
      if (ctx === undefined) out(text); else out(text, ctx);
    }
    recent.push({ t: new Date().toISOString(), level, msg: text, ...(ctx ? { ctx: cleanContext(ctx) } : {}) });
    if (recent.length > BUFFER_SIZE) recent.shift();
    if (remote && level !== "info") send(level, text, ctx);
  } catch {
    // Drop the line.
  }
}

export const clientLog = {
  info:  (msg, ctx, opts) => write("info",  msg, ctx, opts),
  warn:  (msg, ctx, opts) => write("warn",  msg, ctx, opts),
  error: (msg, ctx, opts) => write("error", msg, ctx, opts),
};

export function stackOf(err) {
  try { return typeof err?.stack === "string" ? err.stack : undefined; } catch { return undefined; }
}

// In development builds React also hands an error that an error boundary
// catches to window's "error" handlers. It re-renders the failing component
// to do so, so the window sees a different error object with the same
// message. In development the window handler therefore waits a moment and
// drops its line if a boundary reported the same message meanwhile; the
// boundary's line is the one kept, as it has the component stack. Production
// builds do not do this, so there the window line is sent at once.
const BOUNDARY_WAIT_MS = 1000;
const boundaryCaught   = new Map();   // message → when a boundary caught it

export function noteBoundaryCatch(err) {
  if (!import.meta.env.DEV) return;
  boundaryCaught.set(describeError(err), Date.now());
  if (boundaryCaught.size > 20) boundaryCaught.delete(boundaryCaught.keys().next().value);
}

// Uncaught errors and unhandled rejections. The browser already prints them,
// so they are only recorded and sent.
export function installGlobalErrorHandlers() {
  window.addEventListener("error", (e) => {
    const text = describeError(e);
    const ctx  = { file: e.filename, line: e.lineno, col: e.colno, stack: stackOf(e.error) };
    const report = () => clientLog.error(`Uncaught error: ${text}`, ctx, { echo: false });
    if (!import.meta.env.DEV) { report(); return; }
    const message = describeError(e.error ?? e);
    const seenAt  = Date.now();
    setTimeout(() => {
      if ((boundaryCaught.get(message) ?? -Infinity) < seenAt) report();
    }, BOUNDARY_WAIT_MS);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    clientLog.error(`Unhandled rejection: ${describeError(reason)}`, {
      stack: stackOf(reason),
    }, { echo: false });
  });
}

// Sends a "Report a problem" note (issue #141) with the page's state summary
// and the recent log lines, so the report can be investigated after Render's
// logs have expired. Resolves to the short report ID; rejects with an Error
// whose `serverError` is the server's error text, if any.
export async function sendProblemReport(note) {
  const body = { note };
  const room = roomContext();
  if (ROOM_ID.test(room.roomId ?? "")) body.roomId = room.roomId;
  const page = window.location?.pathname;
  if (page) body.page = page.slice(0, 200);
  try {
    const state = room.state?.();
    if (state && typeof state === "object") body.state = state;
  } catch {
    // A broken summary must not stop the report.
  }
  body.logs = recent.map(({ t, level, msg, ctx }) => ({
    t, level, msg: msg.slice(0, 600), ...(ctx ? { ctx } : {}),
  }));
  // The server accepts 64 kB; drop the oldest lines until the report fits.
  const bytes = (text) => new TextEncoder().encode(text).length;
  let json = JSON.stringify(body);
  while (bytes(json) > MAX_REPORT_BYTES && body.logs.length) {
    body.logs.shift();
    json = JSON.stringify(body);
  }

  const tkn = token();
  const res = await fetch(`${API}/api/support-reports`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}),
    },
    body: json,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.reportId !== "string") {
    const err = new Error(`Report failed (${res.status})`);
    err.serverError = data.error;
    throw err;
  }
  clientLog.info(`Problem report sent: ${data.reportId}`);
  return data.reportId;
}
