import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex",
    alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif",
    padding: 24,
  },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: 36, maxWidth: 420,
    width: "100%", textAlign: "center",
  },
  avatar: { width: 80, height: 80, borderRadius: "50%", border: "2px solid #6b3a10" },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: "50%", border: "2px solid #6b3a10",
    background: "#6b3a10", display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: "#e8b86d", fontSize: 30, fontFamily: "Georgia, serif",
  },
  name: { color: "#e8b86d", fontSize: 22, marginTop: 14, marginBottom: 2 },
  stat: { color: "#a07840", fontSize: 14, marginTop: 4 },
  divider: { borderColor: "#6b3a10", margin: "24px 0" },
  label: { color: "#a07840", fontSize: 12, textAlign: "left", marginBottom: 4, display: "block" },
  input: {
    width: "100%", boxSizing: "border-box", padding: "8px 12px",
    background: "#2a1400", border: "1px solid #6b3a10", borderRadius: 6,
    color: "#e8b86d", fontSize: 14, fontFamily: "Georgia, serif",
  },
  inputError: { borderColor: "#c0392b" },
  error: { color: "#c0392b", fontSize: 12, marginTop: 4, textAlign: "left" },
  success: { color: "#27ae60", fontSize: 12, marginTop: 4, textAlign: "left" },
  row: { marginTop: 20, display: "flex", gap: 12, justifyContent: "center" },
  btnPrimary: {
    background: "#6b3a10", color: "#e8b86d", padding: "9px 22px",
    borderRadius: 8, fontSize: 14, border: "none", cursor: "pointer",
  },
  btnSecondary: {
    background: "transparent", color: "#a07840", padding: "9px 22px",
    borderRadius: 8, fontSize: 14, border: "1px solid #6b3a10", cursor: "pointer",
    textDecoration: "none",
  },
  btnDanger: {
    background: "transparent", color: "#a07840", padding: "9px 22px",
    borderRadius: 8, fontSize: 14, border: "none", cursor: "pointer",
  },
};

export default function Profile() {
  const { user, loading, logout, updateProfile } = useAuth();
  const navigate = useNavigate();

  const [name, setName]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: "error"|"success", msg }

  // Redirect to home if not authenticated after loading
  useEffect(() => {
    if (!loading && !user) navigate("/");
  }, [loading, user, navigate]);

  // Populate input once user loads
  useEffect(() => {
    if (user) setName(user.display_name);
  }, [user]);

  async function handleSave(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setFeedback({ type: "error", msg: "Name cannot be empty." });
    if (trimmed.length > 50) return setFeedback({ type: "error", msg: "Name is too long (max 50 chars)." });
    if (trimmed === user.display_name) return setFeedback({ type: "success", msg: "No changes to save." });

    setSaving(true);
    setFeedback(null);
    const result = await updateProfile({ display_name: trimmed });
    setSaving(false);
    if (result.ok) {
      setFeedback({ type: "success", msg: "Name updated." });
    } else {
      const issues = result.error?.issues;
      const msg = issues?.[0]?.message ?? "Failed to save — please try again.";
      setFeedback({ type: "error", msg });
    }
  }

  if (loading || !user) {
    return (
      <div style={S.page}>
        <p style={{ color: "#a07840" }}>…</p>
      </div>
    );
  }

  const winRate = user.wins + user.losses > 0
    ? Math.round((user.wins / (user.wins + user.losses)) * 100)
    : null;

  return (
    <div style={S.page}>
      <div style={S.card}>
        {user.avatar_url
          ? <img src={user.avatar_url} alt="" style={S.avatar} />
          : <span style={S.avatarPlaceholder}>{user.display_name[0].toUpperCase()}</span>
        }
        <p style={S.name}>{user.display_name}</p>
        <p style={S.stat}>ELO {user.elo}</p>
        <p style={S.stat}>
          {user.wins}W · {user.losses}L
          {winRate !== null && ` · ${winRate}% win rate`}
        </p>

        <hr style={S.divider} />

        <form onSubmit={handleSave}>
          <label style={S.label} htmlFor="display_name">Display name</label>
          <input
            id="display_name"
            style={{ ...S.input, ...(feedback?.type === "error" ? S.inputError : {}) }}
            value={name}
            onChange={e => { setName(e.target.value); setFeedback(null); }}
            maxLength={50}
            disabled={saving}
          />
          {feedback && (
            <p style={feedback.type === "error" ? S.error : S.success}>{feedback.msg}</p>
          )}
          <div style={S.row}>
            <button type="submit" style={S.btnPrimary} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <Link to="/" style={S.btnSecondary}>Home</Link>
          </div>
        </form>

        <hr style={S.divider} />

        <button style={S.btnDanger} onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
