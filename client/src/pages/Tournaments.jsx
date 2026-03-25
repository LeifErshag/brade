import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", fontFamily: "Georgia, serif",
    padding: "32px 16px",
  },
  inner:    { maxWidth: 700, margin: "0 auto" },
  header:   { display: "flex", alignItems: "center", gap: 16, marginBottom: 32 },
  back:     { color: "#a07840", textDecoration: "none", fontSize: 13 },
  title:    { color: "#e8b86d", fontSize: 28, margin: 0, flex: 1 },
  btnPrimary: {
    background: "#6b3a10", color: "#e8b86d", border: "none",
    borderRadius: 8, padding: "9px 20px", fontSize: 13, cursor: "pointer",
  },
  btnSecondary: {
    background: "#3a1a00", color: "#a07840", border: "1px solid #6b3a10",
    borderRadius: 8, padding: "9px 20px", fontSize: 13, cursor: "pointer",
  },
  card: {
    background: "#3a1a00", borderRadius: 10, padding: "18px 20px",
    marginBottom: 12, display: "flex", alignItems: "center", gap: 16,
  },
  cardInfo:    { flex: 1 },
  cardName:    { color: "#e8b86d", fontSize: 16, marginBottom: 4 },
  cardMeta:    { color: "#a07840", fontSize: 12 },
  statusBadge: { padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: "bold" },
  empty:   { color: "#6b3a10", textAlign: "center", marginTop: 48, fontSize: 14 },
  error:   { color: "#c0392b", fontSize: 12, marginTop: 6 },
  divider: { borderColor: "#4a2800", margin: "28px 0" },

  // Create form
  form:       { background: "#3a1a00", borderRadius: 10, padding: "24px 24px 20px" },
  formTitle:  { color: "#e8b86d", fontSize: 16, marginTop: 0, marginBottom: 16 },
  fieldGroup: { marginBottom: 14 },
  label:      { color: "#a07840", fontSize: 12, display: "block", marginBottom: 5 },
  input: {
    background: "#2a1400", color: "#e8b86d", border: "1px solid #6b3a10",
    borderRadius: 6, padding: "8px 12px", fontSize: 13, width: "100%",
    boxSizing: "border-box", outline: "none",
  },
  select: {
    background: "#2a1400", color: "#e8b86d", border: "1px solid #6b3a10",
    borderRadius: 6, padding: "8px 12px", fontSize: 13, width: "100%",
    cursor: "pointer",
  },
  formRow:   { display: "flex", gap: 12 },
  formActions: { display: "flex", gap: 10, marginTop: 18 },
};

const TYPE_LABELS = {
  round_robin:        "Round Robin",
  single_elimination: "Single Elimination",
  swiss:              "Swiss",
};

const STATUS_STYLE = {
  registration: { background: "#1a4a1a", color: "#7ddb7d" },
  active:       { background: "#4a3800", color: "#e8d06d" },
  finished:     { background: "#2a1400", color: "#6b3a10" },
  cancelled:    { background: "#3a0000", color: "#c0392b" },
};

export default function Tournaments() {
  const { user, authFetch } = useAuth();
  const navigate = useNavigate();

  const [tournaments, setTournaments] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState(null);

  const [form, setForm] = useState({
    name:            "",
    tournament_type: "round_robin",
    match_length:    3,
    max_players:     8,
    total_rounds:    "",
  });

  useEffect(() => {
    loadTournaments();
  }, []);

  async function loadTournaments() {
    setLoadingList(true);
    try {
      const res = await fetch("/api/tournaments");
      if (res.ok) setTournaments(await res.json());
    } finally {
      setLoadingList(false);
    }
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) { setCreateError("Name is required"); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const body = {
        name:            form.name.trim(),
        tournament_type: form.tournament_type,
        match_length:    Number(form.match_length),
        max_players:     Number(form.max_players),
      };
      if (form.tournament_type === "swiss" && form.total_rounds) {
        body.total_rounds = Number(form.total_rounds);
      }
      const res = await authFetch("/api/tournaments", {
        method: "POST",
        body:   JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        navigate(`/tournaments/${data.id}`);
      } else {
        setCreateError(data.error ?? "Failed to create tournament");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(id) {
    const res = await authFetch(`/api/tournaments/${id}/join`, { method: "POST" });
    if (res.ok) {
      navigate(`/tournaments/${id}`);
    } else {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error ?? "Could not join");
    }
  }

  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.header}>
          <Link to="/" style={S.back}>← Home</Link>
          <h1 style={S.title}>Tournaments</h1>
          {user && !showCreate && (
            <button style={S.btnPrimary} onClick={() => setShowCreate(true)}>
              Create
            </button>
          )}
        </div>

        {/* ── Create form ── */}
        {showCreate && user && (
          <>
            <form style={S.form} onSubmit={handleCreate}>
              <p style={S.formTitle}>New Tournament</p>

              <div style={S.fieldGroup}>
                <label style={S.label}>Name</label>
                <input
                  style={S.input}
                  value={form.name}
                  onChange={e => setField("name", e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Midvinterlaget 2026"
                />
              </div>

              <div style={{ ...S.formRow }}>
                <div style={{ ...S.fieldGroup, flex: 1 }}>
                  <label style={S.label}>Format</label>
                  <select style={S.select} value={form.tournament_type}
                    onChange={e => setField("tournament_type", e.target.value)}>
                    <option value="round_robin">Round Robin</option>
                    <option value="single_elimination">Single Elimination</option>
                    <option value="swiss">Swiss</option>
                  </select>
                </div>
                <div style={{ ...S.fieldGroup, flex: 1 }}>
                  <label style={S.label}>Match length</label>
                  <select style={S.select} value={form.match_length}
                    onChange={e => setField("match_length", Number(e.target.value))}>
                    <option value={1}>1 game</option>
                    <option value={3}>Best of 3</option>
                    <option value={5}>Best of 5</option>
                    <option value={7}>Best of 7</option>
                  </select>
                </div>
              </div>

              <div style={{ ...S.formRow }}>
                <div style={{ ...S.fieldGroup, flex: 1 }}>
                  <label style={S.label}>Max players</label>
                  <select style={S.select} value={form.max_players}
                    onChange={e => setField("max_players", Number(e.target.value))}>
                    {[2,4,6,8,12,16,24,32].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                {form.tournament_type === "swiss" && (
                  <div style={{ ...S.fieldGroup, flex: 1 }}>
                    <label style={S.label}>Rounds (blank = auto)</label>
                    <input
                      style={S.input}
                      type="number"
                      min={1} max={20}
                      value={form.total_rounds}
                      onChange={e => setField("total_rounds", e.target.value)}
                      placeholder="auto"
                    />
                  </div>
                )}
              </div>

              {createError && <p style={S.error}>{createError}</p>}

              <div style={S.formActions}>
                <button type="submit" style={S.btnPrimary} disabled={creating}>
                  {creating ? "Creating…" : "Create Tournament"}
                </button>
                <button type="button" style={S.btnSecondary} onClick={() => { setShowCreate(false); setCreateError(null); }}>
                  Cancel
                </button>
              </div>
            </form>
            <hr style={S.divider} />
          </>
        )}

        {/* ── Tournament list ── */}
        {loadingList ? (
          <p style={S.empty}>Loading…</p>
        ) : tournaments.length === 0 ? (
          <p style={S.empty}>No tournaments yet. Create one to get started!</p>
        ) : (
          tournaments.map(t => (
            <div key={t.id} style={S.card}>
              <div style={S.cardInfo}>
                <div style={S.cardName}>{t.name}</div>
                <div style={S.cardMeta}>
                  {TYPE_LABELS[t.tournament_type]} · {t.player_count}/{t.max_players} players
                  · Best of {t.match_length} · by {t.creator_name}
                </div>
              </div>
              <span style={{ ...S.statusBadge, ...(STATUS_STYLE[t.status] ?? {}) }}>
                {t.status === "registration" ? "Open" :
                 t.status === "active"       ? `Round ${t.current_round}` :
                 t.status}
              </span>
              {t.status === "registration" && user ? (
                <button style={S.btnPrimary} onClick={() => handleJoin(t.id)}>
                  Join
                </button>
              ) : (
                <Link to={`/tournaments/${t.id}`} style={S.btnSecondary}>
                  View
                </Link>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
