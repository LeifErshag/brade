import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  { ignores: ["dist/"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
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
    // The app itself runs in the browser.
    files: ["src/**"],
    languageOptions: {
      globals: {
        window:          "readonly",
        document:        "readonly",
        navigator:       "readonly",
        console:         "readonly",
        setTimeout:      "readonly",
        clearTimeout:    "readonly",
        setInterval:     "readonly",
        clearInterval:   "readonly",
        URL:             "readonly",
        WebSocket:       "readonly",
        fetch:           "readonly",
        sessionStorage:  "readonly",
        localStorage:    "readonly",
        URLSearchParams: "readonly",
        TextEncoder:     "readonly",
      },
    },
  },
  {
    // Build tooling and scripts run in Node, not the browser.
    files: ["scripts/**", "vite.config.js", "eslint.config.js"],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
];
