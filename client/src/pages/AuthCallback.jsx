import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../AuthContext.jsx";
import { LanguageBar } from "../components/LanguageToggle.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

// Handles the redirect back from OAuth — extracts token from URL fragment
export default function AuthCallback() {
  const navigate = useNavigate();
  const { setToken } = useAuth();
  const { t } = useI18n();
  useEffect(() => {
    const hash  = window.location.hash;
    const token = new URLSearchParams(hash.slice(1)).get("token");
    if (token) {
      sessionStorage.setItem("access_token", token);
      window.history.replaceState(null, "", "/"); // clear token from URL
      setToken(token); // update AuthContext state so user is fetched immediately
    }
    navigate("/");
  }, []);
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex", flexDirection: "column",
      color: "#e8b86d", fontFamily: "Georgia, serif" }}>
      <LanguageBar />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p>{t("auth.signingIn")}</p>
      </div>
    </div>
  );
}
