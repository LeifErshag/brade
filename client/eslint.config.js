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
      globals: globals.browser,
    },
  },
  {
    // Build tooling and scripts run in Node, not the browser.
    files: ["scripts/**", "*.config.{js,mjs}"],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
];
