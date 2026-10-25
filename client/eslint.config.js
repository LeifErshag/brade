import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";

// Browser globals that are easy to use by mistake, e.g. a misspelled or
// undeclared `name` or `event` would otherwise pass no-undef. Copied from
// confusing-browser-globals@1.0.11 (create-react-app). Use `window.<name>` when
// one is really meant.
const confusingBrowserGlobals = [
  "addEventListener", "blur", "close", "closed", "confirm", "defaultStatus",
  "defaultstatus", "event", "external", "find", "focus", "frameElement",
  "frames", "history", "innerHeight", "innerWidth", "length", "location",
  "locationbar", "menubar", "moveBy", "moveTo", "name", "onblur", "onerror",
  "onfocus", "onload", "onresize", "onunload", "open", "opener", "opera",
  "outerHeight", "outerWidth", "pageXOffset", "pageYOffset", "parent", "print",
  "removeEventListener", "resizeBy", "resizeTo", "screen", "screenLeft",
  "screenTop", "screenX", "screenY", "scroll", "scrollbars", "scrollBy",
  "scrollTo", "scrollX", "scrollY", "self", "status", "statusbar", "stop",
  "toolbar", "top",
];

export default [
  { ignores: ["dist/"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z]" }],
    },
  },
  {
    // *.cjs files are CommonJS. This must come after the block above, which
    // sets sourceType "module" for every file.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  {
    // The app itself runs in the browser.
    files: ["src/**"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-restricted-globals": ["error", ...confusingBrowserGlobals],
    },
  },
  {
    // Build tooling and scripts run in Node, not the browser.
    files: ["scripts/**", "*.config.{js,mjs}"],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
  {
    // CommonJS tooling and scripts, e.g. postcss.config.cjs. globals.node is
    // nodeBuiltin plus the module-wrapper names (__dirname, __filename).
    files: ["*.cjs", "scripts/**/*.cjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
