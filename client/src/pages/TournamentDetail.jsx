import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useAuth } from "../AuthContext.jsx";
import { LanguageBar } from "../components/LanguageToggle.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", fontFamily: "Georgia, serif",
    padding: "0 16px 32px",
  },
  langBar: { padding: "10px 0 16px" },
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

const MATCH_STATUS_STYLE = {
  playing:   { background: "#1a4a1a", color: "#7ddb7d" },
  completed: { background: "#2a1400", color: "#6b3a10" },
  bye:       { background: "#3a1a00", color: "#6b3a10" },
  pending:   { background: "#4a2800", color: "#a07840" },
};

// A failed action's message: the server's text when it sent one.
function failure(body, fallbackKey) {
  return body.error ? { server: body.error } : { key: fallbackKey };
}

// Translated tournament status; an unknown status is shown as sent.
function statusLabel(status, t) {
  const key = `tournament.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

export default function TournamentDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user, authFetch } = useAuth();
  const { t, msg } = useI18n();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  // Message descriptors ({ key } / { server }), translated at render time.
  const [error, setError]     = useState(null);
  const [actionErr, setActionErr] = useState(null);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/tournaments/${id}`);
    if (res.ok) {
      setData(await res.json());
    } else {
      setError({ key: "tournamentDetail.notFound" });
    }
    setLoading(false);
  }, [id, authFetch]);

  useEffect(() => { load(); }, [load]);

  // Poll while not finished so the non-creator sees the tournament start
  // and both players see when subsequent rounds open.
  useEffect(() => {
    const status = data?.status;
    if (!status || status === "finished" || status === "cancelled") return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [data?.status, load]);

  // Auto-navigate to game room whenever there is an active match for this user.
  // redirectedRef tracks the last room_id we sent the user to so we don't
  // redirect in a loop if they intentionally navigate back to the standings.
  const redirectedRef = useRef(null);
  useEffect(() => {
    if (!data || !user) return;
    const { matches: mx = [], ...t } = data;
    if (t.status !== "active") return;
    const myMatch = mx.find(m =>
      m.round === t.current_round &&
      m.status === "playing" &&
      m.room_id &&
      (m.white_id === user.id || m.black_id === user.id)
    );
    if (myMatch && redirectedRef.current !== myMatch.room_id) {
      redirectedRef.current = myMatch.room_id;
      navigate(`/game/${myMatch.room_id}`);
    }
  }, [data, user, navigate]);

  async function handleJoin() {
    const res = await authFetch(`/api/tournaments/${id}/join`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); } else { setActionErr(failure(body, "tournamentDetail.failed")); }
  }

  async function handleLeave() {
    const res = await authFetch(`/api/tournaments/${id}/leave`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { navigate("/tournaments"); } else { setActionErr(failure(body, "tournamentDetail.failed")); }
  }

  async function handleStart() {
    const res = await authFetch(`/api/tournaments/${id}/start`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); } else { setActionErr(failure(body, "tournamentDetail.startFailed")); }
  }

  async function handleCancel() {
    if (!window.confirm(t("tournamentDetail.cancelConfirm"))) return;
    const res = await authFetch(`/api/tournaments/${id}/cancel`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); } else { setActionErr(failure(body, "tournamentDetail.failed")); }
  }

  if (loading || error) {
    return (
      <div style={S.page}>
        <div style={S.inner}>
          <LanguageBar style={S.langBar} />
          {loading
            ? <p style={{ color: "#a07840", textAlign: "center", paddingTop: 44 }}>{t("common.loading")}</p>
            : <p style={{ color: "#c0392b", textAlign: "center", paddingTop: 44 }}>{msg(error)}</p>}
        </div>
      </div>
    );
  }

  const { players = [], matches = [], ...tm } = data;
  const isCreator = user?.id === tm.creator_id;
  const isPlayer  = players.some(p => p.player_id === user?.id);

  // Group matches by round
  const rounds = {};
  for (const m of matches) {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  }

  // My active match in current round
  const myActiveMatch = matches.find(m =>
    m.round === tm.current_round &&
    m.status === "playing" &&
    (m.white_id === user?.id || m.black_id === user?.id)
  );

  return (
    <div style={S.page}>
      <div style={S.inner}>
        <LanguageBar style={S.langBar} />

        {/* ── Header ── */}
        <div style={S.header}>
          <Link to="/tournaments" style={S.back}>{t("tournamentDetail.back")}</Link>
          <h1 style={S.title}>{tm.name}</h1>
          <span style={{ ...S.statusBadge, ...(STATUS_STYLE[tm.status] ?? {}) }}>
            {tm.status === "active"
              ? t("tournamentDetail.roundOf", { n: tm.current_round, total: tm.total_rounds })
              : statusLabel(tm.status, t)}
          </span>
        </div>
        <p style={S.meta}>
          {t("tournamentDetail.meta", {
            type:  t(`tournament.type.${tm.tournament_type}`),
            n:     tm.match_length,
            count: players.length,
            max:   tm.max_players,
          })}
          {tm.creator_name && t("tournamentDetail.createdBy", { name: tm.creator_name })}
        </p>

        {/* ── Winner banner ── */}
        {tm.status === "finished" && tm.winner_name && (
          <div style={S.winner}>
            <p style={S.winnerTitle}>{t("tournamentDetail.complete")}</p>
            <p style={S.winnerName}>{t("tournamentDetail.winner", { name: tm.winner_name })}</p>
          </div>
        )}

        {/* ── Actions ── */}
        <div style={S.actions}>
          {tm.status === "registration" && user && !isPlayer && (
            <button style={S.btnPrimary} onClick={handleJoin}>{t("tournamentDetail.join")}</button>
          )}
          {tm.status === "registration" && isPlayer && !isCreator && (
            <button style={S.btnSecondary} onClick={handleLeave}>{t("tournamentDetail.leave")}</button>
          )}
          {tm.status === "registration" && isCreator && (
            <>
              <button style={S.btnPrimary} onClick={handleStart}
                disabled={players.length < 2}
                title={players.length < 2 ? t("tournamentDetail.needTwo") : ""}>
                {t("tournamentDetail.start")}
              </button>
              <button style={S.btnDanger} onClick={handleCancel}>{t("common.cancel")}</button>
            </>
          )}
          {tm.status === "active" && myActiveMatch?.room_id && (
            <Link to={`/game/${myActiveMatch.room_id}`} style={S.btnPrimary}>
              {t("tournamentDetail.playMyMatch")}
            </Link>
          )}
        </div>
        {actionErr && <p style={S.error}>{msg(actionErr)}</p>}

        {/* ── Standings / Player list ── */}
        <div style={S.section}>
          <p style={S.sectionTitle}>
            {tm.status === "registration" ? t("tournamentDetail.registeredPlayers") : t("tournamentDetail.standings")}
          </p>

          {tm.status === "registration" ? (
            <div>
              {players.length === 0 && <p style={{ color: "#6b3a10", fontSize: 13 }}>{t("tournamentDetail.noPlayers")}</p>}
              {players.map(p => (
                <div key={p.player_id} style={S.playerRow}>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" style={S.avatar} />
                    : <span style={S.avatarPh}>{p.display_name[0].toUpperCase()}</span>
                  }
                  <span style={S.playerName}>{p.display_name}</span>
                  <span style={S.playerElo}>ELO {p.seed_elo}</span>
                  {p.player_id === tm.creator_id && (
                    <span style={{ color: "#6b3a10", fontSize: 11 }}>{t("tournamentDetail.organiser")}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>#</th>
                  <th style={S.th}>{t("tournamentDetail.colPlayer")}</th>
                  <th style={{ ...S.th, textAlign: "center" }}>{t("tournamentDetail.colWins")}</th>
                  <th style={{ ...S.th, textAlign: "center" }}>{t("tournamentDetail.colLosses")}</th>
                  {tm.tournament_type !== "single_elimination" && (
                    <th style={{ ...S.th, textAlign: "center" }}>{t("tournamentDetail.colByes")}</th>
                  )}
                  <th style={{ ...S.th, textAlign: "right" }}>{t("tournamentDetail.colSeed")}</th>
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
                      {p.player_id === user?.id && <span style={{ color: "#6b3a10", fontSize: 11, marginLeft: 6 }}>{t("tournamentDetail.you")}</span>}
                    </td>
                    <td style={{ ...S.td, textAlign: "center", color: "#7ddb7d" }}>{p.wins}</td>
                    <td style={{ ...S.td, textAlign: "center", color: "#c0392b" }}>{p.losses}</td>
                    {tm.tournament_type !== "single_elimination" && (
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
            <p style={S.sectionTitle}>{t("tournamentDetail.matches")}</p>
            {Object.entries(rounds)
              .sort(([a], [b]) => Number(b) - Number(a)) // newest round first
              .map(([round, rMatches]) => (
                <div key={round}>
                  <p style={S.roundLabel}>{t("tournamentDetail.round", { n: round })}</p>
                  {rMatches.map(m => (
                    <div key={m.id} style={S.matchCard}>
                      <div style={S.matchPlayers}>
                        <span>{m.white_name ?? t("tournamentDetail.tbd")}</span>
                        <span style={S.matchVs}>{t("common.vs")}</span>
                        <span>{m.black_name ?? t("tournamentDetail.byePlayer")}</span>
                        {m.status === "completed" && m.winner_name && (
                          <span style={{ color: "#a07840", fontSize: 12, marginLeft: 10 }}>
                            {t("tournamentDetail.wins", { name: m.winner_name })}
                          </span>
                        )}
                      </div>
                      <span style={{ ...S.matchStatus, ...(MATCH_STATUS_STYLE[m.status] ?? {}) }}>
                        {t(`tournament.matchStatus.${MATCH_STATUS_STYLE[m.status] ? m.status : "pending"}`)}
                      </span>
                      {m.room_id && m.status === "playing" &&
                        (m.white_id === user?.id || m.black_id === user?.id) && (
                        <Link to={`/game/${m.room_id}`} style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 12 }}>
                          {t("tournamentDetail.play")}
                        </Link>
                      )}
                      {m.room_id && m.status !== "playing" && (
                        <Link to={`/game/${m.room_id}`} style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 12, opacity: 0.6 }}>
                          {t("common.view")}
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
