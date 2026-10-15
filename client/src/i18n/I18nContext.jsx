import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import {
  LANGUAGES, browserStorage, getInitialLanguage, saveLanguage,
  translate, translateServerError, winTypeLabel,
} from "./core.js";

const I18nContext = createContext(null);

/**
 * Holds the current UI language. Components translate at render time, so a
 * switch re-renders text in place without remounting anything (the game
 * board, socket, rules drawer and tutorial coach keep their state).
 */
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(
    () => getInitialLanguage(browserStorage(), typeof navigator !== "undefined" ? navigator.language : undefined)
  );

  useLayoutEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!LANGUAGES.includes(next)) return;
    setLangState(next);
    saveLanguage(next, browserStorage());
  }, []);

  const value = useMemo(() => ({
    lang,
    setLang,
    t:           (key, params) => translate(lang, key, params),
    winType:     (type) => winTypeLabel(lang, type),
    serverError: (text) => translateServerError(lang, text),
    // Renders a message kept in state as a code, not as translated text, so
    // it follows a language switch: { key, params } or { server: "<text>" }.
    msg: (m) => !m ? "" : m.key ? translate(lang, m.key, m.params) : translateServerError(lang, m.server),
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** { lang, setLang, t, winType, serverError, msg } */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>"); // i18n-ignore
  return ctx;
}
