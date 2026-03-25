import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", fontFamily: "Georgia, serif",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "40px 16px",
  },
  title:    { color: "#e8b86d", fontSize: 32, letterSpacing: 3, margin: 0 },
  subtitle: { color: "#a07840", fontSize: 14, marginTop: 6, marginBottom: 32 },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: "0 0 24px 0",
    width: "100%", maxWidth: 640, overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  thead: { background: "#4a2800" },
  th: {
    color: "#a07840", fontSize: 12, fontWeight: "normal", letterSpacing: 1,
    padding: "12px 16px", textAlign: "left",
  },
  thRight: {
    color: "#a07840", fontSize: 12, fontWeight: "normal", letterSpacing: 1,
    padding: "12px 16px", textAlign: "right",
  },
  tr: { borderBottom: "1px solid #4a2800" },
  trLast: {},
  td: { color: "#e8b86d", fontSize: 14, padding: "12px 16px" },
  tdRight: { color: "#e8b86d", fontSize: 14, padding: "12px 16px", textAlign: "right" },
  tdMuted: { color: "#a07840", fontSize: 14, padding: "12px 16px", textAlign: "right" },
  rank: { color: "#6b3a10", fontSize: 13, width: 40 },
  rankTop: { color: "#e8b86d", fontSize: 13, fontWeight: "bold", width: 40 },
  avatar: { width: 28, height: 28, borderRadius: "50%", verticalAlign: "middle", marginRight: 10 },
  avatarPlaceholder: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: "50%", background: "#6b3a10",
    color: "#e8b86d", fontSize: 13, marginRight: 10, verticalAlign: "middle",
  },
  backRow: { marginTop: 24 },
  btnBack: {
    background: "transparent", color: "#a07840", padding: "8px 20px",
    borderRadius: 8, fontSize: 13, border: "1px solid #6b3a10",
    textDecoration: "none",
  },
  empty: { color: "#a07840", textAlign: "center", padding: 32 },
};

export default function Leaderboard() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users/leaderboard")
      .then(r => r.json())
      .then(data => { setPlayers(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={S.page}>
      <h1 style={S.title}>Leaderboard</h1>
      <p style={S.subtitle}>Top players by ELO rating</p>

      <div style={S.card}>
        {loading ? (
          <p style={S.empty}>…</p>
        ) : players.length === 0 ? (
          <p style={S.empty}>No games played yet.</p>
        ) : (
          <table style={S.table}>
            <thead style={S.thead}>
              <tr>
                <th style={S.th}>#</th>
                <th style={S.th}>Player</th>
                <th style={S.thRight}>ELO</th>
                <th style={S.thRight}>W / L</th>
                <th style={S.thRight}>Win %</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => {
                const total = p.wins + p.losses;
                const pct   = total > 0 ? Math.round((p.wins / total) * 100) : null;
                const isLast = i === players.length - 1;
                return (
                  <tr key={p.id} style={isLast ? S.trLast : S.tr}>
                    <td style={i < 3 ? S.rankTop : S.rank}>{i + 1}</td>
                    <td style={S.td}>
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" style={S.avatar} />
                        : <span style={S.avatarPlaceholder}>{p.display_name[0].toUpperCase()}</span>
                      }
                      {p.display_name}
                    </td>
                    <td style={S.tdRight}>{p.elo}</td>
                    <td style={S.tdMuted}>{p.wins} / {p.losses}</td>
                    <td style={S.tdMuted}>{pct !== null ? `${pct}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={S.backRow}>
        <Link to="/" style={S.btnBack}>← Home</Link>
      </div>
    </div>
  );
}
