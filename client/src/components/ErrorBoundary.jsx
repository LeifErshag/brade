import { Component } from "react";
import { useI18n } from "../i18n/I18nContext.jsx";
import { clientLog } from "../remoteLog.js";

// Catches a render crash anywhere below it, reports it to the server log
// (issue #140) and shows a reload prompt instead of a blank page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    // React already prints the error to the console.
    clientLog.error(`Render crash: ${error?.message ?? String(error)}`, {
      stack:          typeof error?.stack === "string" ? error.stack : undefined,
      componentStack: info?.componentStack,
    }, { echo: false });
  }

  render() {
    return this.state.crashed ? <CrashScreen /> : this.props.children;
  }
}

function CrashScreen() {
  const { t } = useI18n();
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: "0 16px", fontFamily: "Georgia, serif" }}>
      <div style={{ background: "#3a1a00", borderRadius: 12, padding: "24px 28px", maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ color: "#e8b86d", fontSize: 22, margin: "0 0 12px" }}>{t("crash.title")}</h1>
        <p style={{ color: "#a07840", margin: "0 0 20px" }}>{t("crash.body")}</p>
        <button
          onClick={() => window.location.reload()}
          style={{ background: "#2a1400", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 6,
            padding: "10px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}
        >
          {t("crash.reload")}
        </button>
      </div>
    </div>
  );
}
