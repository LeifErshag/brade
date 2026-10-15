import { LANGUAGES } from "../i18n/core.js";
import { useI18n } from "../i18n/I18nContext.jsx";

// Inline SVG flags: Windows renders flag emoji as plain letters ("SE", "GB").
function FlagSE() {
  return (
    <svg viewBox="0 0 16 10" width="24" height="15" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <rect width="16" height="10" fill="#006AA7" />
      <rect x="5" width="2" height="10" fill="#FECC00" />
      <rect y="4" width="16" height="2" fill="#FECC00" />
    </svg>
  );
}

function FlagGB() {
  return (
    <svg viewBox="0 0 60 30" width="24" height="15" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <clipPath id="brade-flag-gb-clip">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#brade-flag-gb-clip)" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

const FLAGS = { sv: FlagSE, en: FlagGB };

const S = {
  group: {
    display: "inline-flex", gap: 4, padding: 3, borderRadius: 8,
    background: "#3a1a00", border: "1px solid #4a2800", flexShrink: 0,
  },
  btn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "4px 6px", borderRadius: 5, cursor: "pointer", lineHeight: 0,
    // Longhands, so the active style can override borderColor alone.
    background: "transparent", borderWidth: 1, borderStyle: "solid", borderColor: "transparent", opacity: 0.55,
  },
  active: { background: "#6b3a10", borderColor: "#a06030", opacity: 1 },
  row: {
    display: "flex", justifyContent: "flex-end", width: "100%",
    boxSizing: "border-box", padding: "10px 12px 0",
  },
};

/** Two flag buttons that switch the UI language. Render exactly one per page. */
export default function LanguageToggle({ style }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t("language.label")} data-testid="lang-toggle" style={{ ...S.group, ...style }}>
      {LANGUAGES.map(code => {
        const Flag    = FLAGS[code];
        const name    = t(`language.${code}`);
        const pressed = lang === code;
        return (
          <button
            key={code}
            type="button"
            data-lang={code}
            lang={code}
            aria-pressed={pressed}
            aria-label={name}
            title={name}
            onClick={() => setLang(code)}
            style={{ ...S.btn, ...(pressed ? S.active : null) }}
          >
            <Flag />
          </button>
        );
      })}
    </div>
  );
}

/** The toggle in its own right-aligned row, for the top of a page. */
export function LanguageBar({ style }) {
  return (
    <div style={{ ...S.row, ...style }}>
      <LanguageToggle />
    </div>
  );
}
