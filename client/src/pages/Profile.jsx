import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

const WIN_LABELS = {
  normal:      "Bearing off",
  gammon:      "Gammon",
  monk:        "Monk",
  jan:         "Jan",
  forced_jan:  "Forced Jan",
  resign:      "Resign",
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", fontFamily: "Georgia, serif",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "40px 16px",
  },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: 36, width: "100%",
    maxWidth: 460, textAlign: "center",
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
  error:   { color: "#c0392b", fontSize: 12, marginTop: 4, textAlign: "left" },
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
  // Games section
  histCard: {
    background: "#3a1a00", borderRadius: 12, padding: "0 0 16px 0",
    width: "100%", maxWidth: 640, marginTop: 24, overflow: "hidden",
  },
  histTitle: {
    color: "#e8b86d", fontSize: 16, letterSpacing: 1, margin: "0",
    padding: "20px 20px 14px 20px",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  thead: { background: "#4a2800" },
  th: {
    color: "#a07840", fontSize: 11, fontWeight: "normal", letterSpacing: 1,
    padding: "10px 14px", textAlign: "left",
  },
  thRight: {
    color: "#a07840", fontSize: 11, fontWeight: "normal", letterSpacing: 1,
    padding: "10px 14px", textAlign: "right",
  },
  tr: { borderBottom: "1px solid #4a2800" },
  td: { color: "#e8b86d", fontSize: 13, padding: "10px 14px" },
  tdRight: { color: "#a07840", fontSize: 13, padding: "10px 14px", textAlign: "right" },
  tdWin: { color: "#27ae60", fontSize: 13, padding: "10px 14px", fontWeight: "bold" },
  tdLoss: { color: "#c0392b", fontSize: 13, padding: "10px 14px", fontWeight: "bold" },
  tdEloPos: { color: "#27ae60", fontSize: 12, padding: "10px 14px", textAlign: "right" },
  tdEloNeg: { color: "#c0392b", fontSize: 12, padding: "10px 14px", textAlign: "right" },
  tdEloNone: { color: "#a07840", fontSize: 12, padding: "10px 14px", textAlign: "right" },
  noGames: { color: "#a07840", textAlign: "center", padding: "24px 16px", fontSize: 13 },
};

export default function Profile() {
  const { user, loading, logout, updateProfile, authFetch } = useAuth();
  const navigate = useNavigate();

  const [name, setName]           = useState("");
  const [saving, setSaving]       = useState(false);
  const [feedback, setFeedback]   = useState(null);
  const [games, setGames]         = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate("/");
  }, [loading, user, navigate]);

  useEffect(() => {
    if (user) setName(user.display_name);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    authFetch("/api/games")
      .then(r => r.ok ? r.json() : [])
      .then(data => setGames(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setGamesLoading(false));
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
      {/* ── Profile card ── */}
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

        <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
          <Link to="/leaderboard" style={S.btnSecondary}>Leaderboard</Link>
          <button style={S.btnDanger} onClick={logout}>Sign out</button>
        </div>
      </div>

      {/* ── Recent games ── */}
      <div style={S.histCard}>
        <p style={S.histTitle}>Recent Games</p>
        {gamesLoading ? (
          <p style={S.noGames}>…</p>
        ) : games.length === 0 ? (
          <p style={S.noGames}>No completed games yet.</p>
        ) : (
          <table style={S.table}>
            <thead style={S.thead}>
              <tr>
                <th style={S.th}>Opponent</th>
                <th style={S.th}>Result</th>
                <th style={S.th}>Type</th>
                <th style={S.thRight}>Score</th>
                <th style={S.thRight}>ELO</th>
                <th style={S.thRight}>Date</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g, i) => {
                const myColor    = g.white_id === user.id ? "white" : "black";
                const oppName    = myColor === "white" ? g.black_name : g.white_name;
                const won        = g.winner_id === user.id;
                const eloBefore  = myColor === "white" ? g.white_elo_before : g.black_elo_before;
                const eloAfter   = myColor === "white" ? g.white_elo_after  : g.black_elo_after;
                const eloDelta   = eloBefore != null && eloAfter != null ? eloAfter - eloBefore : null;
                const isLast     = i === games.length - 1;
                return (
                  <tr key={g.id} style={isLast ? {} : S.tr}>
                    <td style={S.td}>{oppName ?? "—"}</td>
                    <td style={won ? S.tdWin : S.tdLoss}>{won ? "Win" : "Loss"}</td>
                    <td style={S.tdRight}>{WIN_LABELS[g.win_type] ?? g.win_type ?? "—"}</td>
                    <td style={S.tdRight}>{g.white_score}–{g.black_score}</td>
                    <td style={
                      eloDelta == null ? S.tdEloNone
                      : eloDelta >= 0  ? S.tdEloPos
                      : S.tdEloNeg
                    }>
                      {eloDelta == null ? "—"
                        : eloDelta >= 0 ? `+${eloDelta}`
                        : `${eloDelta}`}
                    </td>
                    <td style={S.tdRight}>{fmtDate(g.ended_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
