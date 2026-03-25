import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", fontFamily: "Georgia, serif",
    padding: "32px 16px",
  },
  inner:   { maxWidth: 760, margin: "0 auto" },
  header:  { display: "flex", alignItems: "center", gap: 16, marginBottom: 8, flexWrap: "wrap" },
  back:    { color: "#a07840", textDecoration: "none", fontSize: 13 },
  title:   { color: "#e8b86d", fontSize: 26, margin: 0, flex: 1 },
  meta:    { color: "#a07840", fontSize: 13, marginBottom: 24 },
  statusBadge: { padding: "3px 12px", borderRadius: 10, fontSize: 12, fontWeight: "bold" },

  section:      { marginBottom: 28 },
  sectionTitle: { color: "#a07840", fontSize: 13, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },

  // Standings
  table:     { width: "100%", borderCollapse: "collapse" },
  th: {
    color: "#6b3a10", fontSize: 11, textTransform: "uppercase", letterSpacing: 1,
    textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #4a2800",
  },
  tr:        { borderBottom: "1px solid #3a1a00" },
  td:        { color: "#e8b86d", fontSize: 14, padding: "9px 10px", verticalAlign: "middle" },
  tdMuted:   { color: "#a07840", fontSize: 13, padding: "9px 10px", verticalAlign: "middle" },
  rank:      { color: "#6b3a10", fontSize: 13, width: 32, textAlign: "center" },
  avatar: {
    width: 28, height: 28, borderRadius: "50%", border: "1px solid #6b3a10",
    verticalAlign: "middle", marginRight: 8,
  },
  avatarPh: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: "50%", border: "1px solid #6b3a10",
    background: "#6b3a10", color: "#e8b86d", fontSize: 13, marginRight: 8,
    verticalAlign: "middle",
  },

  // Matches
  matchCard: {
    background: "#3a1a00", borderRadius: 8, padding: "12px 16px",
    marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
  },
  matchPlayers: { flex: 1, color: "#e8b86d", fontSize: 14 },
  matchVs:      { color: "#6b3a10", fontSize: 12, margin: "0 6px" },
  matchStatus:  { fontSize: 12, padding: "2px 10px", borderRadius: 8 },
  roundLabel:   { color: "#a07840", fontSize: 12, marginBottom: 6, marginTop: 16 },

  // Actions
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 },
  btnPrimary: {
    background: "#6b3a10", color: "#e8b86d", border: "none",
    borderRadius: 8, padding: "9px 20px", fontSize: 13, cursor: "pointer",
  },
  btnDanger: {
    background: "#3a0000", color: "#c0392b", border: "1px solid #6b0000",
    borderRadius: 8, padding: "9px 20px", fontSize: 13, cursor: "pointer",
  },
  btnSecondary: {
    background: "#3a1a00", color: "#a07840", border: "1px solid #6b3a10",
    borderRadius: 8, padding: "9px 20px", fontSize: 13, cursor: "pointer",
    textDecoration: "none", display: "inline-block",
  },
  error:  { color: "#c0392b", fontSize: 12, marginTop: 8 },
  winner: {
    background: "#2a1400", borderRadius: 10, padding: "20px 24px",
    textAlign: "center", border: "1px solid #4a2800", marginBottom: 24,
  },
  winnerTitle:  { color: "#e8b86d", fontSize: 22, margin: "0 0 6px" },
  winnerName:   { color: "#a07840", fontSize: 15 },

  // Player list (registration)
  playerRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
    borderBottom: "1px solid #3a1a00",
  },
  playerName: { color: "#e8b86d", fontSize: 14, flex: 1 },
  playerElo:  { color: "#a07840", fontSize: 12 },
};

const STATUS_STYLE = {
  registration: { background: "#1a4a1a", color: "#7ddb7d" },
  active:       { background: "#4a3800", color: "#e8d06d" },
  finished:     { background: "#2a1400", color: "#6b3a10" },
  cancelled:    { background: "#3a0000", color: "#c0392b" },
};

const TYPE_LABELS = {
  round_robin:        "Round Robin",
  single_elimination: "Single Elimination",
  swiss:              "Swiss",
};

const MATCH_STATUS_STYLE = {
  playing:   { background: "#1a4a1a", color: "#7ddb7d" },
  completed: { background: "#2a1400", color: "#6b3a10" },
  bye:       { background: "#3a1a00", color: "#6b3a10" },
  pending:   { background: "#4a2800", color: "#a07840" },
};

export default function TournamentDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user, authFetch } = useAuth();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [actionErr, setActionErr] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tournaments/${id}`);
    if (res.ok) {
      setData(await res.json());
    } else {
      setError("Tournament not found");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll while active so standings update as matches complete
  useEffect(() => {
    if (!data || data.status !== "active") return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [data, load]);

  async function handleJoin() {
    const res = await authFetch(`/api/tournaments/${id}/join`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); } else { setActionErr(body.error ?? "Failed"); }
  }

  async function handleLeave() {
    const res = await authFetch(`/api/tournaments/${id}/leave`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { navigate("/tournaments"); } else { setActionErr(body.error ?? "Failed"); }
  }

  async function handleStart() {
    const res = await authFetch(`/api/tournaments/${id}/start`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); } else { setActionErr(body.error ?? "Failed to start"); }
  }

  async function handleCancel() {
    if (!window.confirm("Cancel this tournament?")) return;
    const res = await authFetch(`/api/tournaments/${id}/cancel`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); } else { setActionErr(body.error ?? "Failed"); }
  }

  if (loading) return <div style={S.page}><p style={{ color: "#a07840", textAlign: "center", paddingTop: 60 }}>Loading…</p></div>;
  if (error)   return <div style={S.page}><p style={{ color: "#c0392b", textAlign: "center", paddingTop: 60 }}>{error}</p></div>;

  const { players = [], matches = [], ...t } = data;
  const isCreator = user?.id === t.creator_id;
  const isPlayer  = players.some(p => p.player_id === user?.id);

  // Group matches by round
  const rounds = {};
  for (const m of matches) {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  }

  // My active match in current round
  const myActiveMatch = matches.find(m =>
    m.round === t.current_round &&
    m.status === "playing" &&
    (m.white_id === user?.id || m.black_id === user?.id)
  );

  return (
    <div style={S.page}>
      <div style={S.inner}>

        {/* ── Header ── */}
        <div style={S.header}>
          <Link to="/tournaments" style={S.back}>← Tournaments</Link>
          <h1 style={S.title}>{t.name}</h1>
          <span style={{ ...S.statusBadge, ...(STATUS_STYLE[t.status] ?? {}) }}>
            {t.status === "active" ? `Round ${t.current_round}/${t.total_rounds}` : t.status}
          </span>
        </div>
        <p style={S.meta}>
          {TYPE_LABELS[t.tournament_type]} · Best of {t.match_length} · {players.length}/{t.max_players} players
          {t.creator_name && ` · Created by ${t.creator_name}`}
        </p>

        {/* ── Winner banner ── */}
        {t.status === "finished" && t.winner_name && (
          <div style={S.winner}>
            <p style={S.winnerTitle}>Tournament Complete</p>
            <p style={S.winnerName}>Winner: {t.winner_name}</p>
          </div>
        )}

        {/* ── Actions ── */}
        <div style={S.actions}>
          {t.status === "registration" && user && !isPlayer && (
            <button style={S.btnPrimary} onClick={handleJoin}>Join Tournament</button>
          )}
          {t.status === "registration" && isPlayer && !isCreator && (
            <button style={S.btnSecondary} onClick={handleLeave}>Leave</button>
          )}
          {t.status === "registration" && isCreator && (
            <>
              <button style={S.btnPrimary} onClick={handleStart}
                disabled={players.length < 2}
                title={players.length < 2 ? "Need at least 2 players" : ""}>
                Start Tournament
              </button>
              <button style={S.btnDanger} onClick={handleCancel}>Cancel</button>
            </>
          )}
          {t.status === "active" && myActiveMatch?.room_id && (
            <Link to={`/game/${myActiveMatch.room_id}`} style={S.btnPrimary}>
              Play My Match →
            </Link>
          )}
        </div>
        {actionErr && <p style={S.error}>{actionErr}</p>}

        {/* ── Standings / Player list ── */}
        <div style={S.section}>
          <p style={S.sectionTitle}>
            {t.status === "registration" ? "Registered Players" : "Standings"}
          </p>

          {t.status === "registration" ? (
            <div>
              {players.length === 0 && <p style={{ color: "#6b3a10", fontSize: 13 }}>No players yet.</p>}
              {players.map(p => (
                <div key={p.player_id} style={S.playerRow}>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" style={S.avatar} />
                    : <span style={S.avatarPh}>{p.display_name[0].toUpperCase()}</span>
                  }
                  <span style={S.playerName}>{p.display_name}</span>
                  <span style={S.playerElo}>ELO {p.seed_elo}</span>
                  {p.player_id === t.creator_id && (
                    <span style={{ color: "#6b3a10", fontSize: 11 }}>organiser</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>#</th>
                  <th style={S.th}>Player</th>
                  <th style={{ ...S.th, textAlign: "center" }}>W</th>
                  <th style={{ ...S.th, textAlign: "center" }}>L</th>
                  {t.tournament_type !== "single_elimination" && (
                    <th style={{ ...S.th, textAlign: "center" }}>Bye</th>
                  )}
                  <th style={{ ...S.th, textAlign: "right" }}>ELO seed</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.player_id} style={{
                    ...S.tr,
                    opacity: p.status === "eliminated" ? 0.45 : 1,
                  }}>
                    <td style={{ ...S.rank, ...S.td }}>{p.final_rank ?? i + 1}</td>
                    <td style={S.td}>
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" style={S.avatar} />
                        : <span style={S.avatarPh}>{p.display_name[0].toUpperCase()}</span>
                      }
                      {p.display_name}
                      {p.player_id === user?.id && <span style={{ color: "#6b3a10", fontSize: 11, marginLeft: 6 }}>you</span>}
                    </td>
                    <td style={{ ...S.td, textAlign: "center", color: "#7ddb7d" }}>{p.wins}</td>
                    <td style={{ ...S.td, textAlign: "center", color: "#c0392b" }}>{p.losses}</td>
                    {t.tournament_type !== "single_elimination" && (
                      <td style={{ ...S.tdMuted, textAlign: "center" }}>{p.byes}</td>
                    )}
                    <td style={{ ...S.tdMuted, textAlign: "right" }}>{p.seed_elo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Matches ── */}
        {Object.keys(rounds).length > 0 && (
          <div style={S.section}>
            <p style={S.sectionTitle}>Matches</p>
            {Object.entries(rounds)
              .sort(([a], [b]) => Number(b) - Number(a)) // newest round first
              .map(([round, rMatches]) => (
                <div key={round}>
                  <p style={S.roundLabel}>Round {round}</p>
                  {rMatches.map(m => (
                    <div key={m.id} style={S.matchCard}>
                      <div style={S.matchPlayers}>
                        <span>{m.white_name ?? "TBD"}</span>
                        <span style={S.matchVs}>vs</span>
                        <span>{m.black_name ?? "BYE"}</span>
                        {m.status === "completed" && m.winner_name && (
                          <span style={{ color: "#a07840", fontSize: 12, marginLeft: 10 }}>
                            → {m.winner_name} wins
                          </span>
                        )}
                      </div>
                      <span style={{ ...S.matchStatus, ...(MATCH_STATUS_STYLE[m.status] ?? {}) }}>
                        {m.status === "playing" ? "In Progress" :
                         m.status === "completed" ? "Done" :
                         m.status === "bye" ? "Bye" : "Pending"}
                      </span>
                      {m.room_id && m.status === "playing" &&
                        (m.white_id === user?.id || m.black_id === user?.id) && (
                        <Link to={`/game/${m.room_id}`} style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 12 }}>
                          Play →
                        </Link>
                      )}
                      {m.room_id && m.status !== "playing" && (
                        <Link to={`/game/${m.room_id}`} style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 12, opacity: 0.6 }}>
                          View
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
