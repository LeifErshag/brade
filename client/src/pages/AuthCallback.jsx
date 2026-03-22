import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

// Handles the redirect back from OAuth — extracts token from URL fragment
export default function AuthCallback() {
  const navigate = useNavigate();
  const { setToken } = useAuth();
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
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e8b86d",
      fontFamily: "Georgia, serif" }}>
      <p>Signing in...</p>
    </div>
  );
}
