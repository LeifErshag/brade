// ── i18n core ────────────────────────────────────────────────────────────────
// Plain JS (no React) so it can be used from Node as well as the browser.
import sv from "./sv.js";
import en from "./en.js";

export const LANGUAGES   = ["sv", "en"];
export const STORAGE_KEY = "brade.lang";

const DICTS = { sv, en };
const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

function dictFor(lang) {
  return has(DICTS, lang) ? DICTS[lang] : DICTS.en;
}

function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/** "sv" for Swedish browser languages (sv, sv-SE, sv-FI…), otherwise "en". */
export function detectLanguage(navLang) {
  return typeof navLang === "string" && /^sv\b/i.test(navLang) ? "sv" : "en";
}

/** A valid stored choice wins; otherwise the browser language decides. Never throws. */
export function getInitialLanguage(storage, navLang) {
  try {
    const stored = storage?.getItem?.(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage blocked (private mode, disabled cookies…): fall back.
  }
  return detectLanguage(navLang);
}

/** Persists the choice. Never throws (storage may be blocked or full). */
export function saveLanguage(lang, storage) {
  try {
    storage?.setItem?.(STORAGE_KEY, lang);
  } catch {
    // Ignore: the choice still applies for this session.
  }
}

/** window.localStorage, or null when even accessing it throws. */
export function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function lookup(dict, dottedKey) {
  if (typeof dottedKey !== "string" || dottedKey === "") return undefined;
  let node = dict;
  for (const part of dottedKey.split(".")) {
    if (!has(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

function substitute(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) =>
    has(params, name) && params[name] != null ? String(params[name]) : match);
}

/**
 * Looks up a dotted key ("home.learn") and fills in {placeholders}.
 * Unknown languages fall back to English; a missing key returns the key.
 * A string-array value returns an array with each item substituted.
 */
export function translate(lang, dottedKey, params) {
  let value = lookup(dictFor(lang), dottedKey);
  if (value === undefined) value = lookup(DICTS.en, dottedKey);
  if (typeof value === "string") return substitute(value, params);
  if (Array.isArray(value)) return value.map(v => substitute(String(v), params));
  return String(dottedKey);
}

/** Display name of a server win type (e.g. "hemspel_munk"); unknown types come back raw. */
export function winTypeLabel(lang, winType) {
  const labels = dictFor(lang).winType;
  return has(labels, winType) ? labels[winType] : winType;
}

/**
 * Maps an exact English text from the server to the current language.
 * Unknown text comes back unchanged; an empty one becomes error.generic.
 */
export function translateServerError(lang, text) {
  if (text === undefined || text === null || text === "") return translate(lang, "error.generic");
  const map = dictFor(lang).serverError;
  return has(map, text) ? map[text] : text;
}
