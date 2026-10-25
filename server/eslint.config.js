import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["coverage/", "dist/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.nodeBuiltin,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: globals.jest,
    },
  },
];
