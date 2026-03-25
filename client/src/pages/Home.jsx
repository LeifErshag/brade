import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

const API = import.meta.env.VITE_API_URL ?? "";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex",
    alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif",
  },
  center: { textAlign: "center" },
  title:    { color: "#e8b86d", fontSize: 48, letterSpacing: 4, margin: 0 },
  subtitle: { color: "#a07840", fontSize: 16, marginTop: 8 },
  row:      { marginTop: 32, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" },
  btnPrimary: {
    background: "#6b3a10", color: "#e8b86d", padding: "10px 24px",
    borderRadius: 8, textDecoration: "none", fontSize: 14, border: "none", cursor: "pointer",
  },
  btnSecondary: {
    background: "#3a1a00", color: "#a07840", padding: "10px 24px",
    borderRadius: 8, textDecoration: "none", fontSize: 14, border: "none", cursor: "pointer",
  },
  avatar: { width: 56, height: 56, borderRadius: "50%", border: "2px solid #6b3a10" },
  avatarPlaceholder: {
    width: 56, height: 56, borderRadius: "50%", border: "2px solid #6b3a10",
    background: "#6b3a10", display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: "#e8b86d", fontSize: 22, fontFamily: "Georgia, serif",
  },
  name: { color: "#e8b86d", fontSize: 18, marginTop: 12 },
  elo:  { color: "#a07840", fontSize: 13, marginTop: 4 },
  divider: { borderColor: "#4a2800", margin: "28px auto", width: "60%" },
  playSection: { marginTop: 8 },
  sectionLabel: { color: "#a07840", fontSize: 13, marginBottom: 10 },
  playRow: { display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" },
  select: {
    background: "#3a1a00", color: "#e8b86d", border: "1px solid #6b3a10",
    borderRadius: 6, padding: "8px 12px", fontSize: 13, cursor: "pointer",
  },
  input: {
    background: "#3a1a00", color: "#e8b86d", border: "1px solid #6b3a10",
    borderRadius: 6, padding: "8px 12px", fontSize: 13, width: 130, textTransform: "uppercase",
    outline: "none",
  },
  error: { color: "#c0392b", fontSize: 12, marginTop: 6 },
};

export default function Home() {
  const { user, loading, logout, authFetch } = useAuth();
  const navigate = useNavigate();

  const [matchLength, setMatchLength]   = useState(5);
  const [creating, setCreating]         = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState("journeyman");
  const [creatingAi, setCreatingAi]     = useState(false);
  const [roomCode, setRoomCode]         = useState("");
  const [joinError, setJoinError]       = useState(null);
  const [joining, setJoining]           = useState(false);

  async function handleCreateAi() {
    setCreatingAi(true);
    try {
      const res = await authFetch("/api/games", {
        method: "POST",
        body: JSON.stringify({ matchLength, opponent: "ai", aiDifficulty }),
      });
      const data = await res.json();
      if (res.ok) navigate(`/game/${data.roomId}`);
    } finally {
      setCreatingAi(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await authFetch("/api/games", {
        method: "POST",
        body: JSON.stringify({ matchLength }),
      });
      const data = await res.json();
      if (res.ok) navigate(`/game/${data.roomId}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin() {
    const code = roomCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      setJoinError("Room codes are 8 characters (A–Z, 0–9)");
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const res = await authFetch(`/api/games/${code}`);
      if (res.ok) {
        navigate(`/game/${code}`);
      } else {
        const body = await res.json().catch(() => ({}));
        setJoinError(body.error ?? "Room not found");
      }
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div style={S.page}>
        <p style={{ color: "#a07840" }}>…</p>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.center}>
        <h1 style={S.title}>Bräde</h1>
        <p style={S.subtitle}>Svenskt Brädspel</p>

        {user ? (
          <>
            <div style={{ marginTop: 28 }}>
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" style={S.avatar} />
                : <span style={S.avatarPlaceholder}>{user.display_name[0].toUpperCase()}</span>
              }
              <p style={S.name}>{user.display_name}</p>
              <p style={S.elo}>ELO {user.elo} · {user.wins}W {user.losses}L</p>
            </div>

            <div style={S.row}>
              <Link to="/profile"     style={S.btnSecondary}>Profile</Link>
              <Link to="/leaderboard" style={S.btnSecondary}>Leaderboard</Link>
              <button style={S.btnSecondary} onClick={logout}>Sign out</button>
            </div>

            <hr style={S.divider} />

            {/* ── Play ── */}
            <div style={S.playSection}>
              <p style={S.sectionLabel}>Create a game</p>
              <div style={S.playRow}>
                <select
                  value={matchLength}
                  onChange={e => setMatchLength(Number(e.target.value))}
                  style={S.select}
                  aria-label="Match length"
                >
                  <option value={1}>1 game</option>
                  <option value={3}>Best of 3</option>
                  <option value={5}>Best of 5</option>
                  <option value={7}>Best of 7</option>
                </select>
                <button onClick={handleCreate} disabled={creating} style={S.btnPrimary}>
                  {creating ? "Creating…" : "Create Game"}
                </button>
              </div>

              <p style={{ ...S.sectionLabel, marginTop: 20 }}>Play vs AI</p>
              <div style={S.playRow}>
                <select
                  value={aiDifficulty}
                  onChange={e => setAiDifficulty(e.target.value)}
                  style={S.select}
                  aria-label="AI difficulty"
                >
                  <option value="beginner">Beginner</option>
                  <option value="journeyman">Journeyman</option>
                  <option value="master">Master</option>
                </select>
                <button onClick={handleCreateAi} disabled={creatingAi} style={S.btnPrimary}>
                  {creatingAi ? "Starting…" : "Play vs AI"}
                </button>
              </div>

              <p style={{ ...S.sectionLabel, marginTop: 20 }}>Join with code</p>
              <div style={S.playRow}>
                <input
                  style={S.input}
                  placeholder="ROOM CODE"
                  maxLength={8}
                  value={roomCode}
                  onChange={e => {
                    setJoinError(null);
                    setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                  }}
                  onKeyDown={e => e.key === "Enter" && handleJoin()}
                />
                <button onClick={handleJoin} disabled={joining} style={S.btnPrimary}>
                  {joining ? "Joining…" : "Join"}
                </button>
              </div>
              {joinError && <p style={S.error}>{joinError}</p>}
            </div>
          </>
        ) : (
          <>
            <div style={S.row}>
              <a href={`${API}/auth/google`} style={S.btnPrimary}>Sign in with Google</a>
              <a href={`${API}/auth/github`} style={S.btnSecondary}>Sign in with GitHub</a>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link to="/leaderboard" style={{ ...S.btnSecondary, fontSize: 12 }}>Leaderboard</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
