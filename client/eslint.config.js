import js from "@eslint/js";
import react from "eslint-plugin-react";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
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
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z]" }],
    },
  },
];
