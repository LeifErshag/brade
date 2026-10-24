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
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: {
        test:       "readonly",
        expect:     "readonly",
        describe:   "readonly",
        it:         "readonly",
        beforeEach: "readonly",
        afterEach:  "readonly",
        beforeAll:  "readonly",
        afterAll:   "readonly",
        jest:       "readonly",
      },
    },
  },
];
