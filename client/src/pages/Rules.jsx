import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import RulesContent from "../components/RulesContent.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex", justifyContent: "center",
    fontFamily: "Georgia, serif", padding: 16, boxSizing: "border-box",
  },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: "24px clamp(14px, 4vw, 28px)",
    maxWidth: 760, width: "100%", boxSizing: "border-box", alignSelf: "flex-start",
  },
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  back:   { color: "#a07840", textDecoration: "none", fontSize: 13 },
  title:  { color: "#e8b86d", fontSize: 26, margin: 0, flex: 1, fontWeight: "normal" },
};

export default function Rules() {
  const { hash } = useLocation();

  // Deep links like /rules#rules-bearing-off: React renders after the browser's
  // own hash scroll attempt, so scroll once the content exists.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) el.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.header}>
          <Link to="/" style={S.back}>← Home</Link>
          <h1 style={S.title}>Spelregler för bräde</h1>
        </div>
        <RulesContent />
      </div>
    </div>
  );
}
