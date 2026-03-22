import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Handles the redirect back from OAuth — extracts token from URL fragment
export default function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const hash  = window.location.hash;
    const token = new URLSearchParams(hash.slice(1)).get("token");
    if (token) {
      // Store access token in memory (never localStorage)
      sessionStorage.setItem("access_token", token);
      window.history.replaceState(null, "", "/"); // clear token from URL
    }
    navigate("/");
  }, []);
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e8b86d",
      fontFamily: "Georgia, serif" }}>
      <p>Signing in...</p>
    </div>
  );
}
