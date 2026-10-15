import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import RulesContent from "../components/RulesContent.jsx";
import { LanguageBar } from "../components/LanguageToggle.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", fontFamily: "Georgia, serif", padding: "0 16px 16px", boxSizing: "border-box",
  },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: "24px clamp(14px, 4vw, 28px)",
    maxWidth: 760, width: "100%", boxSizing: "border-box",
  },
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  back:   { color: "#a07840", textDecoration: "none", fontSize: 13 },
  langBar: { padding: "10px 0", maxWidth: 760 },
  title:  { color: "#e8b86d", fontSize: 26, margin: 0, flex: 1, fontWeight: "normal" },
};

export default function Rules() {
  const { hash } = useLocation();
  const { t } = useI18n();

  // Deep links like /rules#rules-bearing-off: React renders after the browser's
  // own hash scroll attempt, so scroll once the content exists.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) el.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div style={S.page}>
      <LanguageBar style={S.langBar} />
      <div style={S.card}>
        <div style={S.header}>
          <Link to="/" style={S.back}>{t("common.backHome")}</Link>
          <h1 style={S.title}>{t("rulesPage.title")}</h1>
        </div>
        <RulesContent />
      </div>
    </div>
  );
}
