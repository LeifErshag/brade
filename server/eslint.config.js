import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process:      "readonly",
        console:      "readonly",
        setTimeout:   "readonly",
        clearTimeout: "readonly",
        URL:          "readonly",
      },
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
