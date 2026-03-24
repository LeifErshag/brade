import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window:       "readonly",
        document:     "readonly",
        navigator:    "readonly",
        console:      "readonly",
        setTimeout:   "readonly",
        clearTimeout: "readonly",
        URL:          "readonly",
        WebSocket:    "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
