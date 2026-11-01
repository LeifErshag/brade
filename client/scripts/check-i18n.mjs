#!/usr/bin/env node
// i18n consistency check for the client (issue #76). No dependencies beyond
// what the client already has: it uses ESLint's bundled parser (a direct
// devDependency) to find hard-coded user-visible strings in JSX.
//
//   cd client && npm run check:i18n          # exit 1 on any failure
//   node scripts/check-i18n.mjs --verbose    # also list warnings
//
// What it expects (the contract for issue #76):
//   client/src/i18n/sv.js, client/src/i18n/en.js
//       `export default { ... }` — plain nested objects. Leaves are non-empty
//       strings (arrays of strings are allowed, e.g. paragraph lists).
//       Rich text may use only <t>…</t> (game term), <em>…</em>, <strong>…</strong>.
//       Placeholders look like {name}.
//   client/src/i18n/core.js  (plain JS, no React, no JSX)
//       LANGUAGES, STORAGE_KEY ("brade.lang"), detectLanguage, getInitialLanguage,
//       saveLanguage, translate, winTypeLabel, translateServerError
//
// Checks:
//   1. sv and en have identical key sets; no empty values; same placeholders
//      and the same rich-text tags per key; only allowed tags.
//   2. Required keys: winType.<every win type in server/src/game/scoring.js>,
//      error.generic, and serverError["<text>"] for every error text the
//      server can send (ERROR messages, `error: "..."` JSON bodies, custom Zod
//      messages). Swedish win-type names must be the official ones.
//   3. core.js behaves as specified (language detection, storage, translate).
//   4. No hard-coded user-visible string literals in client/src/**/*.{js,jsx}
//      outside src/i18n/. Every literal key passed to t("...") exists.
//      Escape hatch: a comment containing `i18n-ignore` on the same line or
//      the line above.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Linter } from "eslint";

const here       = path.dirname(fileURLToPath(import.meta.url));
const CLIENT     = path.resolve(here, "..");
const SRC        = path.join(CLIENT, "src");
const I18N       = path.join(SRC, "i18n");
const SERVER_SRC = path.resolve(CLIENT, "..", "server", "src");
const VERBOSE    = process.argv.includes("--verbose");

const failures = [];
const warnings = [];
const fail = (section, msg) => failures.push(`[${section}] ${msg}`);
const warn = (section, msg) => warnings.push(`[${section}] ${msg}`);

// ── Helpers ──────────────────────────────────────────────────────────────────
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Flatten to [pathArray, value] pairs. Path segments are kept as an array so
// keys containing spaces or punctuation (serverError texts) stay intact.
function flatten(obj, prefix = [], out = []) {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, [...prefix, String(i)], out));
  } else if (isPlainObject(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, [...prefix, k], out);
  } else {
    out.push([prefix, obj]);
  }
  return out;
}
const keyId   = p => JSON.stringify(p);
const keyShow = p => p.map(s => (/^[\w-]+$/.test(s) ? s : JSON.stringify(s))).join(".");

const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const tags         = s => [...s.matchAll(/<\/?([a-zA-Z][\w-]*)\s*\/?>/g)].map(m => m[0].replace(/\s/g, "")).sort();
const ALLOWED_TAGS = new Set(["t", "em", "strong"]);

async function importIfExists(file) {
  if (!fs.existsSync(file)) return { missing: true };
  try {
    return { mod: await import(pathToFileURL(file).href) };
  } catch (err) {
    return { error: err };
  }
}

// ── 1. Dictionaries ──────────────────────────────────────────────────────────
const svFile = path.join(I18N, "sv.js");
const enFile = path.join(I18N, "en.js");
const svImp  = await importIfExists(svFile);
const enImp  = await importIfExists(enFile);
let sv = null, en = null;

for (const [name, imp, file] of [["sv", svImp, svFile], ["en", enImp, enFile]]) {
  const rel = path.relative(CLIENT, file).split(path.sep).join("/");
  if (imp.missing) { fail("dict", `${rel} does not exist`); continue; }
  if (imp.error)   { fail("dict", `${rel} failed to import: ${imp.error.message}`); continue; }
  const d = imp.mod.default;
  if (!isPlainObject(d)) { fail("dict", `${rel} must \`export default\` a plain object`); continue; }
  if (name === "sv") sv = d; else en = d;
}

if (sv && en) {
  const svFlat = new Map(flatten(sv).map(([p, v]) => [keyId(p), [p, v]]));
  const enFlat = new Map(flatten(en).map(([p, v]) => [keyId(p), [p, v]]));

  for (const [id, [p]] of svFlat) if (!enFlat.has(id)) fail("keys", `missing in en: ${keyShow(p)}`);
  for (const [id, [p]] of enFlat) if (!svFlat.has(id)) fail("keys", `missing in sv: ${keyShow(p)}`);

  for (const [lang, flat] of [["sv", svFlat], ["en", enFlat]]) {
    for (const [, [p, v]] of flat) {
      if (typeof v !== "string") { fail("values", `${lang} ${keyShow(p)} is ${v === null ? "null" : typeof v}, expected a string`); continue; }
      if (v.trim() === "") fail("values", `${lang} ${keyShow(p)} is empty`);
      for (const tg of tags(v)) {
        const name = tg.replace(/[</>]/g, "");
        if (!ALLOWED_TAGS.has(name)) fail("values", `${lang} ${keyShow(p)} uses tag ${tg}; only <t>, <em>, <strong> are allowed`);
      }
    }
  }

  let identical = 0;
  for (const [id, [p, a]] of svFlat) {
    const e = enFlat.get(id);
    if (!e || typeof a !== "string" || typeof e[1] !== "string") continue;
    const b = e[1];
    const pa = placeholders(a).join(","), pb = placeholders(b).join(",");
    if (pa !== pb) fail("placeholders", `${keyShow(p)}: sv {${pa}} vs en {${pb}}`);
    const ta = tags(a).join(""), tb = tags(b).join("");
    if (ta !== tb) fail("markup", `${keyShow(p)}: sv ${ta || "(none)"} vs en ${tb || "(none)"}`);
    if (a === b && p[0] !== "serverError") { identical++; warn("same-text", `${keyShow(p)} is identical in sv and en: ${JSON.stringify(a)}`); }
  }
  console.log(`dictionaries: ${svFlat.size} sv keys, ${enFlat.size} en keys, ${identical} identical values (warnings)`);
}

// ── 2. Required keys ─────────────────────────────────────────────────────────
// Win types come from the server's ranking table, the single list of every
// winType the server can report.
function serverWinTypes() {
  const file = path.join(SERVER_SRC, "game", "scoring.js");
  const src  = fs.readFileSync(file, "utf8");
  const m    = src.match(/WIN_RANK\s*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error("could not find WIN_RANK in server/src/game/scoring.js");
  return [...m[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map(x => x[1]);
}

// Official Swedish names (Spelregler för bräde, §13).
const OFFICIAL_SV = {
  hemspel:               "Hemspel",
  hemspel_munk:          "Hemspel med munk",
  kronspel_enkelt:       "Enkelt kronspel",
  kronspel_enkelt_munk:  "Enkelt kronspel med munk",
  kronspel_dubbelt:      "Dubbelt kronspel",
  kronspel_dubbelt_munk: "Dubbelt kronspel med munk",
  trappspel:             "Trappspel",
  trappspel_munk:        "Trappspel med munk",
  uppspel:               "Uppspel",
  uppspel_munk:          "Uppspel med munk",
  jan:                   "Jan",
  sprangjan:             "Sprängjan",
};

// Every error text the server can put in front of a user.
function serverErrorTexts() {
  const files = [];
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.js$/.test(ent.name) && !/\.test\.js$/.test(ent.name)) files.push(full);
    }
  };
  walk(SERVER_SRC);
  const found = new Map(); // text -> first location
  const add = (text, file, src, index) => {
    if (found.has(text)) return;
    const line = src.slice(0, index).split("\n").length;
    found.set(text, `${path.relative(path.resolve(CLIENT, ".."), file).split(path.sep).join("/")}:${line}`);
  };
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // WebSocket: { type: "ERROR", message: "..." }
    for (const m of src.matchAll(/type:\s*"ERROR"\s*,\s*message:\s*"([^"\n]+)"/g)) add(m[1], file, src, m.index);
    // REST: res.status(..).json({ error: "..." }) and similar (an object key,
    // so console.error("... error:", err) is not picked up)
    for (const m of src.matchAll(/[{,]\s*error:\s*"([^"\n]+)"/g)) add(m[1], file, src, m.index);
    // errorHandler's fallback for non-exposed 4xx messages
    for (const m of src.matchAll(/:\s*"(Bad request)"/g)) add(m[1], file, src, m.index);
    // Custom Zod messages, shown by Profile via issues[0].message
    for (const m of src.matchAll(/\.(?:min|max|length|regex|email|url)\([^()\n]*?,\s*"([^"\n]+)"\s*\)/g)) add(m[1], file, src, m.index);
    for (const m of src.matchAll(/(?:required_error|invalid_type_error)\s*:\s*"([^"\n]+)"/g)) add(m[1], file, src, m.index);
  }
  return found;
}

const winTypes  = serverWinTypes();
const srvErrors = serverErrorTexts();
console.log(`server: ${winTypes.length} win types, ${srvErrors.size} distinct error texts`);

if (sv && en) {
  for (const wt of winTypes) {
    const s = sv.winType?.[wt], e = en.winType?.[wt];
    if (typeof s !== "string" || !s.trim()) { fail("winType", `sv winType.${wt} missing`); continue; }
    if (typeof e !== "string" || !e.trim()) { fail("winType", `en winType.${wt} missing`); continue; }
    if (OFFICIAL_SV[wt] && s !== OFFICIAL_SV[wt]) fail("winType", `sv winType.${wt} is ${JSON.stringify(s)}, expected the official name ${JSON.stringify(OFFICIAL_SV[wt])}`);
    // English keeps the Swedish game term, e.g. "Single crown (enkelt kronspel)".
    if (OFFICIAL_SV[wt] && !e.toLowerCase().includes(OFFICIAL_SV[wt].toLowerCase())) {
      fail("winType", `en winType.${wt} ${JSON.stringify(e)} must contain the Swedish term ${JSON.stringify(OFFICIAL_SV[wt].toLowerCase())}`);
    }
    if (wt === "resign" && /^resign$/i.test(s)) fail("winType", `sv winType.resign is still English (${JSON.stringify(s)})`);
  }
  for (const lang of ["sv", "en"]) {
    const d = lang === "sv" ? sv : en;
    if (typeof d.error?.generic !== "string" || !d.error.generic.trim()) fail("required", `${lang} error.generic missing`);
    if (!isPlainObject(d.serverError)) { fail("serverError", `${lang} has no serverError object`); continue; }
    for (const [text, where] of srvErrors) {
      if (typeof d.serverError[text] !== "string" || !d.serverError[text].trim()) {
        fail("serverError", `${lang} serverError[${JSON.stringify(text)}] missing (sent at ${where})`);
      }
    }
  }
  const svErr = sv.serverError?.["Not your turn"];
  if (svErr && svErr === "Not your turn") fail("serverError", "sv serverError texts are not translated (\"Not your turn\" is unchanged)");
}

// ── 3. core.js behaviour ─────────────────────────────────────────────────────
const coreFile = path.join(I18N, "core.js");
const coreImp  = await importIfExists(coreFile);
if (coreImp.missing) fail("core", "src/i18n/core.js does not exist");
else if (coreImp.error) fail("core", `src/i18n/core.js failed to import (it must not import React or JSX): ${coreImp.error.message}`);
else {
  const c = coreImp.mod;
  const need = ["LANGUAGES", "STORAGE_KEY", "detectLanguage", "getInitialLanguage", "saveLanguage",
    "translate", "winTypeLabel", "translateServerError"];
  for (const n of need) if (!(n in c)) fail("core", `core.js must export ${n}`);
  const check = (label, fn) => {
    try {
      const r = fn();
      if (r !== true) fail("core", `${label}${r === false || r === undefined ? "" : `: ${r}`}`);
    } catch (err) {
      fail("core", `${label}: threw ${err?.message ?? err}`);
    }
  };
  const eq = (a, b) => (a === b ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

  if (need.every(n => n in c)) {
    check("LANGUAGES is [\"sv\", \"en\"]", () => eq(JSON.stringify([...c.LANGUAGES].sort()), JSON.stringify(["en", "sv"])));
    check("STORAGE_KEY is \"brade.lang\"", () => eq(c.STORAGE_KEY, "brade.lang"));

    for (const [nav, want] of [["sv", "sv"], ["sv-SE", "sv"], ["sv-FI", "sv"], ["SV-se", "sv"],
      ["en-US", "en"], ["en", "en"], ["de-DE", "en"], ["nb-NO", "en"], ["", "en"], [undefined, "en"], [null, "en"]]) {
      check(`detectLanguage(${JSON.stringify(nav)})`, () => eq(c.detectLanguage(nav), want));
    }

    const mem = (initial) => {
      const store = new Map(initial ? [[c.STORAGE_KEY, initial]] : []);
      return {
        store,
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: k => { store.delete(k); },
      };
    };
    const throwing = {
      getItem() { throw new Error("SecurityError"); },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() { throw new Error("SecurityError"); },
    };
    check("getInitialLanguage: stored \"en\" wins over a Swedish browser", () => eq(c.getInitialLanguage(mem("en"), "sv-SE"), "en"));
    check("getInitialLanguage: stored \"sv\" wins over an English browser", () => eq(c.getInitialLanguage(mem("sv"), "en-US"), "sv"));
    check("getInitialLanguage: nothing stored, Swedish browser -> sv", () => eq(c.getInitialLanguage(mem(), "sv-SE"), "sv"));
    check("getInitialLanguage: nothing stored, other browser -> en", () => eq(c.getInitialLanguage(mem(), "fr-FR"), "en"));
    check("getInitialLanguage: invalid stored value is ignored", () => eq(c.getInitialLanguage(mem("xx"), "sv-SE"), "sv"));
    check("getInitialLanguage: storage that throws falls back to the browser language", () => eq(c.getInitialLanguage(throwing, "sv-SE"), "sv"));
    check("getInitialLanguage: no storage at all falls back to the browser language", () => eq(c.getInitialLanguage(null, "en-GB"), "en"));
    check("saveLanguage stores the choice under STORAGE_KEY", () => {
      const s = mem(); c.saveLanguage("sv", s);
      return eq(s.store.get(c.STORAGE_KEY), "sv");
    });
    check("saveLanguage then getInitialLanguage round-trips", () => {
      const s = mem(); c.saveLanguage("en", s);
      return eq(c.getInitialLanguage(s, "sv-SE"), "en");
    });
    check("saveLanguage with storage that throws does not throw", () => { c.saveLanguage("en", throwing); return true; });
    check("saveLanguage with no storage does not throw", () => { c.saveLanguage("en", null); return true; });

    if (sv && en) {
      const flatSv = flatten(sv).filter(([p, v]) => typeof v === "string" && p[0] !== "serverError" && !/^\d+$/.test(p[p.length - 1]));
      const withPh = flatSv.find(([, v]) => placeholders(v).length > 0);
      const plain  = flatSv.find(([, v]) => placeholders(v).length === 0);
      if (plain) {
        const key = plain[0].join(".");
        check(`translate("sv", "${key}")`, () => eq(c.translate("sv", key), plain[1]));
        const enVal = plain[0].reduce((o, k) => o?.[k], en);
        check(`translate("en", "${key}")`, () => eq(c.translate("en", key), enVal));
        check(`translate with an unknown language falls back to en`, () => eq(c.translate("xx", key), enVal));
      }
      if (withPh) {
        const key = withPh[0].join(".");
        const params = Object.fromEntries(placeholders(withPh[1]).map((n, i) => [n, `§${i}§`]));
        check(`translate("sv", "${key}", params) substitutes every placeholder`, () => {
          const r = c.translate("sv", key, params);
          if (typeof r !== "string") return `returned ${typeof r}`;
          const left = placeholders(r).filter(n => n in params);
          if (left.length) return `left ${left.map(n => `{${n}}`).join(", ")} in ${JSON.stringify(r)}`;
          return Object.values(params).every(v => r.includes(v)) || `values missing in ${JSON.stringify(r)}`;
        });
        check(`translate substitutes numbers (0 included)`, () => {
          const zero = Object.fromEntries(placeholders(withPh[1]).map(n => [n, 0]));
          const r = c.translate("sv", key, zero);
          return (typeof r === "string" && !placeholders(r).some(n => n in zero)) || `got ${JSON.stringify(r)}`;
        });
      } else {
        fail("core", "no dictionary value has a {placeholder}; expected some (e.g. \"You won game {n}\")");
      }
      check("translate with a missing key returns the key and does not throw", () => eq(c.translate("en", "no.such.key.anywhere"), "no.such.key.anywhere"));

      check("winTypeLabel(\"sv\", \"sprangjan\")", () => eq(c.winTypeLabel("sv", "sprangjan"), sv.winType?.sprangjan));
      check("winTypeLabel(\"en\", \"hemspel_munk\")", () => eq(c.winTypeLabel("en", "hemspel_munk"), en.winType?.hemspel_munk));
      check("winTypeLabel with an unknown winType returns it unchanged", () => eq(c.winTypeLabel("en", "mystery_win"), "mystery_win"));

      const anyErr = [...srvErrors.keys()].find(t => t === "Not your turn") ?? [...srvErrors.keys()][0];
      if (anyErr) {
        check(`translateServerError("sv", ${JSON.stringify(anyErr)})`, () => eq(c.translateServerError("sv", anyErr), sv.serverError?.[anyErr]));
        check(`translateServerError("en", ${JSON.stringify(anyErr)})`, () => eq(c.translateServerError("en", anyErr), en.serverError?.[anyErr]));
      }
      check("translateServerError with unknown text returns the text unchanged", () => eq(c.translateServerError("sv", "Something brand new"), "Something brand new"));
      check("translateServerError(\"sv\", undefined) returns error.generic", () => eq(c.translateServerError("sv", undefined), sv.error?.generic));
      check("translateServerError(\"en\", \"\") returns error.generic", () => eq(c.translateServerError("en", ""), en.error?.generic));
    }
  }
}

// ── 4. Hard-coded strings in client/src ──────────────────────────────────────
// Attributes whose value a user sees or hears.
const VISIBLE_ATTRS = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-valuetext",
  "title", "placeholder", "alt", "label"]);
// Object properties that carry display text.
const VISIBLE_PROPS = new Set(["msg", "message", "title", "label", "text", "placeholder", "hint", "description", "heading"]);
// Calls whose string arguments reach the screen.
const SINK_CALL = /^(pushToast|alert|confirm|prompt|set\w*(Error|Err|Feedback|Msg|Message|Notice|Text|Label|Title))$/;
// Exact strings allowed as literals (brand names, notation).
const ALLOW = new Set(["Bräde", "Google", "GitHub", "Microsoft", "Discord", "ELO", "OK"]);

const hasLetter = s => /\p{L}/u.test(s);
const looksTechnical = s =>
  /^(https?:|mailto:|\/|\.\.?\/|#|Bearer\b)/.test(s) ||
  /\d(px|vh|vw|dvh|em|rem|%|ms|s|deg)\b|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|translate[XY]?\(/.test(s) ||
  // CSS keywords, but only in all-lowercase values ("1px solid", "none"),
  // so that labels such as "Rounds (blank = auto)" are still caught.
  (!/\p{Lu}/u.test(s) && /\b(solid|dashed|serif|sans-serif|monospace|ease|ease-in|ease-out|inherit|none)\b/.test(s)) ||
  /[[\]]|:not\(|^\(.*\)$/.test(s);
function looksLikeProse(s) {
  const t = s.trim();
  if (!hasLetter(t) || ALLOW.has(t) || looksTechnical(t)) return false;
  if (/^[\w.-]+$/.test(t) && !/^\p{Lu}\p{Ll}/u.test(t)) return false; // keys, identifiers, enums
  return /\s/.test(t) && /\p{L}{2,}/u.test(t) || /^\p{Lu}\p{Ll}/u.test(t) || /[åäöÅÄÖ]/.test(t);
}
const visibleLiteral = s => { const t = s.trim(); return hasLetter(t) && !ALLOW.has(t) && !looksTechnical(t); };

const TRANSPARENT = new Set(["ConditionalExpression", "LogicalExpression", "TemplateLiteral", "ArrayExpression",
  "ChainExpression", "SequenceExpression", "TSAsExpression", "SpreadElement"]);
const STYLE_VAR = /^(S|[A-Z_]*STYLES?[A-Z_]*|\w*Style|\w*Styles)$/;

function calleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed) return callee.property.name;
  return null;
}
function calleeObject(callee) {
  return callee?.type === "MemberExpression" && callee.object.type === "Identifier" ? callee.object.name : null;
}

const usedKeys = []; // [key, file, line]

const rule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const sc   = context.sourceCode;
    const file = context.filename;
    const lines = sc.lines;
    const ignored = node => {
      const ln = node.loc.start.line;
      return /i18n-ignore/.test(lines[ln - 1] ?? "") || /i18n-ignore/.test(lines[ln - 2] ?? "");
    };
    const report = (node, text, why) => {
      if (ignored(node)) return;
      context.report({ node, message: `${why}: ${JSON.stringify(text.trim().replace(/\s+/g, " ").slice(0, 80))}` });
    };

    // Is the node inside a style object, a style attribute, or another
    // non-visible JSX attribute?
    function inSkippedRegion(node) {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === "JSXAttribute") {
          const name = p.name.type === "JSXNamespacedName" ? `${p.name.namespace.name}:${p.name.name.name}` : p.name.name;
          return !VISIBLE_ATTRS.has(name);
        }
        if (p.type === "VariableDeclarator" && p.id.type === "Identifier" && STYLE_VAR.test(p.id.name)) return true;
        if (p.type === "Property" && !p.computed && (p.key.name ?? p.key.value) === "style") return true;
        if (p.type === "ImportDeclaration" || p.type === "ExportNamedDeclaration" || p.type === "ExportAllDeclaration") {
          if (p.source && (node === p.source || node.parent === p)) return true;
        }
      }
      return false;
    }

    function classify(node, text) {
      if (inSkippedRegion(node)) return;
      // Walk up through expressions that just pass the string along.
      let child = node, p = node.parent;
      while (p && (TRANSPARENT.has(p.type) || (p.type === "BinaryExpression" && p.operator === "+"))) {
        if (p.type === "ConditionalExpression" && p.test === child) return; // a condition, not a value
        if (p.type === "LogicalExpression" && p.left === child && p.operator !== "??" && p.operator !== "||") return;
        child = p; p = p.parent;
      }
      if (!p) return;
      switch (p.type) {
        case "BinaryExpression":   return; // ===, !==, in, ... : comparisons
        case "SwitchCase":         return;
        case "ImportExpression":   return;
        case "MemberExpression":   return; // obj["key"]
        case "Property":
          if (p.key === child && !p.computed) return;
          {
            const k = p.key.name ?? p.key.value;
            if (VISIBLE_PROPS.has(k)) { if (visibleLiteral(text)) report(node, text, `display text in property "${k}"`); return; }
          }
          if (looksLikeProse(text)) report(node, text, "hard-coded text");
          return;
        case "JSXExpressionContainer":
          if (p.parent.type === "JSXElement" || p.parent.type === "JSXFragment") {
            if (visibleLiteral(text)) report(node, text, "hard-coded JSX text");
          } else if (p.parent.type === "JSXAttribute") {
            if (visibleLiteral(text)) report(node, text, `hard-coded ${p.parent.name.name}`);
          }
          return;
        case "CallExpression":
        case "NewExpression": {
          if (p.callee === child) return;
          const name = calleeName(p.callee), obj = calleeObject(p.callee);
          if (obj === "console") return;
          if ((name === "t" || name === "translate") && p.arguments[0] === child) return; // key, handled below
          if (name && SINK_CALL.test(name)) { if (visibleLiteral(text)) report(node, text, `text passed to ${name}()`); return; }
          return; // other calls: storage keys, selectors, URLs, ...
        }
        case "TaggedTemplateExpression": return;
        default:
          if (looksLikeProse(text)) report(node, text, "hard-coded text");
      }
    }

    return {
      JSXText(node) {
        const text = node.value;
        if (!visibleLiteral(text)) return;
        if (inSkippedRegion(node)) return;
        report(node, text, "hard-coded JSX text");
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXNamespacedName" ? null : node.name.name;
        if (!name || !VISIBLE_ATTRS.has(name)) return;
        if (node.value?.type === "Literal" && typeof node.value.value === "string" && visibleLiteral(node.value.value)) {
          report(node.value, node.value.value, `hard-coded ${name}`);
        }
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (node.parent.type === "JSXAttribute") return; // handled above
        classify(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.parent.type === "TaggedTemplateExpression") return;
        const text = node.quasis.map(q => q.value.cooked ?? "").join(" ");
        if (!hasLetter(text)) return;
        classify(node, text);
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name !== "t") return;
        const a = node.arguments[0];
        if (a?.type === "Literal" && typeof a.value === "string") usedKeys.push([a.value, file, a.loc.start.line]);
      },
    };
  },
};

function listSources(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (full !== I18N) listSources(full, out); }
    else if (/\.(jsx?|mjs)$/.test(ent.name)) out.push(full);
  }
  return out;
}

const linter = new Linter({ configType: "flat" });
const config = [{
  files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { i18n: { rules: { "no-literal": rule } } },
  rules: { "i18n/no-literal": "error" },
}];

const perFile = new Map();
let literalCount = 0;
for (const file of listSources(SRC)) {
  const rel  = path.relative(CLIENT, file).split(path.sep).join("/");
  const code = fs.readFileSync(file, "utf8");
  const msgs = linter.verify(code, config, { filename: file });
  for (const m of msgs) {
    if (m.fatal) { fail("literals", `${rel}:${m.line} parse error: ${m.message}`); continue; }
    literalCount++;
    perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
    fail("literals", `${rel}:${m.line}:${m.column} ${m.message}`);
  }
}
console.log(`literals: ${literalCount} hard-coded user-visible strings in ${perFile.size} files` +
  (perFile.size ? ` (${[...perFile].map(([f, n]) => `${f.replace(/^src\//, "")} ${n}`).join(", ")})` : ""));

if (sv) {
  for (const [key, file, line] of usedKeys) {
    const v = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), sv);
    if (v === undefined) fail("t-keys", `${path.relative(CLIENT, file).split(path.sep).join("/")}:${line} t("${key}") is not in the dictionaries`);
  }
  console.log(`t() calls with literal keys: ${usedKeys.length}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
if (VERBOSE && warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ${w}`);
}
if (failures.length) {
  const bySection = failures.reduce((m, f) => { const s = f.match(/^\[([^\]]+)\]/)[1]; m[s] = (m[s] ?? 0) + 1; return m; }, {});
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  ${f}`);
  console.log(`\ncheck:i18n FAILED (${Object.entries(bySection).map(([s, n]) => `${s} ${n}`).join(", ")})`);
  process.exit(1);
}
console.log(`\ncheck:i18n passed${warnings.length ? ` with ${warnings.length} warning(s)${VERBOSE ? "" : " (--verbose to list)"}` : ""}`);
