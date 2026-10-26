import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../AuthContext.jsx";
import { OFFICIAL_RULES_URL } from "../components/RulesContent.jsx";
import { LanguageBar } from "../components/LanguageToggle.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import { GUEST_NAME_MAX, loadGuestName, saveGuestName } from "../guestName.js";

const API = import.meta.env.VITE_API_URL ?? "";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex", flexDirection: "column",
    fontFamily: "Georgia, serif",
  },
  // Vertically centred in the space below the language toggle.
  main:   { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px 24px" },
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
  nameInput: {
    background: "#3a1a00", color: "#e8b86d", border: "1px solid #6b3a10",
    borderRadius: 6, padding: "8px 12px", fontSize: 13, width: 200, outline: "none",
  },
  error: { color: "#c0392b", fontSize: 12, marginTop: 6 },
  tutorial:     { marginTop: 20 },
  tutorialHint: { color: "#a07840", fontSize: 12, margin: "8px auto 0", maxWidth: 340, lineHeight: 1.5 },
  footer:     { marginTop: 40, paddingTop: 14, borderTop: "1px solid #4a2800", maxWidth: 420, marginLeft: "auto", marginRight: "auto" },
  footerText: { color: "#a07840", fontSize: 12, margin: 0, lineHeight: 1.5 },
  footerLink: { color: "#e8b86d" },
};

export default function Home() {
  const { user, loading, logout, authFetch } = useAuth();
  const navigate = useNavigate();
  const { t, msg } = useI18n();
  const isGuest = !loading && !user;

  const [matchLength, setMatchLength]   = useState(5);
  const [creating, setCreating]         = useState(false);
  const [creatingAi, setCreatingAi]     = useState(false);
  const [roomCode, setRoomCode]         = useState("");
  // Errors are kept as message descriptors ({ key } / { server }) and
  // translated at render time, so they follow a language switch.
  const [joinError, setJoinError]       = useState(null);
  const [joining, setJoining]           = useState(false);
  const [createError, setCreateError]   = useState(null);
  const [startingTutorial, setStartingTutorial] = useState(false);
  const [tutorialError, setTutorialError]       = useState(null);
  const [guestName, setGuestName]               = useState(loadGuestName);
  const trimmedGuestName = guestName.trim();

  // Matchmaking
  const [mmStatus, setMmStatus]       = useState("idle"); // "idle" | "waiting"
  const [mmQueueSize, setMmQueueSize] = useState(0);
  const [mmWaitSecs, setMmWaitSecs]   = useState(0);
  const pollRef = useRef(null);

  // Clean up polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      setMmWaitSecs(s => s + 1);
      const res = await authFetch("/api/matchmaking/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "matched") {
        stopPolling();
        setMmStatus("idle");
        navigate(`/game/${data.roomId}`);
      } else if (data.status === "waiting") {
        setMmQueueSize(data.queueSize ?? 0);
      } else {
        stopPolling();
        setMmStatus("idle");
      }
    }, 2500);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function handleFindMatch() {
    setMmStatus("waiting");
    setMmWaitSecs(0);
    const res = await authFetch("/api/matchmaking/join", {
      method: "POST",
      body: JSON.stringify({ matchLength }),
    });
    if (!res.ok) { setMmStatus("idle"); return; }
    const data = await res.json();
    if (data.status === "matched") {
      setMmStatus("idle");
      navigate(`/game/${data.roomId}`);
    } else {
      setMmQueueSize(data.queueSize ?? 0);
      startPolling();
    }
  }

  async function handleCancelMatch() {
    stopPolling();
    setMmStatus("idle");
    setMmWaitSecs(0);
    await authFetch("/api/matchmaking/leave", { method: "POST" });
  }

  async function handleCreateAi() {
    setCreatingAi(true);
    setCreateError(null);
    try {
      if (isGuest) {
        const res = await fetch(`${API}/api/games/ai-guest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchLength, displayName: trimmedGuestName }),
        });
        if (res.ok) {
          saveGuestName(trimmedGuestName);
          const data = await res.json();
          sessionStorage.setItem(`guest_token_${data.roomId}`, data.token);
          sessionStorage.setItem(`guest_id_${data.roomId}`,    data.guestId);
          navigate(`/game/${data.roomId}`);
        } else {
          setCreateError({ key: "error.couldNotStart" });
        }
      } else {
        const res = await authFetch("/api/games", {
          method: "POST",
          body: JSON.stringify({ matchLength, opponent: "ai" }),
        });
        if (res.ok) {
          const data = await res.json();
          navigate(`/game/${data.roomId}`);
        } else if (res.status === 401) {
          setCreateError({ key: "error.sessionExpired" });
        } else {
          setCreateError({ key: "error.couldNotStart" });
        }
      }
    } catch {
      setCreateError({ key: "error.network" });
    } finally {
      setCreatingAi(false);
    }
  }

  // Tutorial: an unrated game vs the easiest AI with rules explained as you
  // play. The server decides it's unrated; there's nothing to choose here.
  async function handleTutorial() {
    setStartingTutorial(true);
    setTutorialError(null);
    try {
      const res = user
        ? await authFetch("/api/games/tutorial", { method: "POST", body: "{}" })
        : await fetch(`${API}/api/games/tutorial`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          sessionStorage.setItem(`guest_token_${data.roomId}`, data.token);
          sessionStorage.setItem(`guest_id_${data.roomId}`,    data.guestId);
        }
        navigate(`/game/${data.roomId}`);
      } else if (res.status === 401) {
        setTutorialError({ key: "error.sessionExpired" });
      } else {
        setTutorialError({ key: "home.tutorialFailed" });
      }
    } catch {
      setTutorialError({ key: "error.network" });
    } finally {
      setStartingTutorial(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      // A signed-out player hosts as a guest: the server issues a guest token
      // with the room, and the match is unrated.
      const res = isGuest
        ? await fetch(`${API}/api/games/guest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchLength, displayName: trimmedGuestName }),
          })
        : await authFetch("/api/games", {
            method: "POST",
            body: JSON.stringify({ matchLength }),
          });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          saveGuestName(trimmedGuestName);
          sessionStorage.setItem(`guest_token_${data.roomId}`, data.token);
          sessionStorage.setItem(`guest_id_${data.roomId}`,    data.guestId);
        }
        navigate(`/game/${data.roomId}`);
      } else if (res.status === 401) {
        setCreateError({ key: "error.sessionExpired" });
      } else {
        setCreateError({ key: "error.couldNotStart" });
      }
    } catch {
      setCreateError({ key: "error.network" });
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin() {
    const code = roomCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      setJoinError({ key: "home.roomCodeFormat" });
      return;
    }
    setJoinError(null);
    // Signed out: the game page asks for a name and joins as a guest. (The room
    // lookup below needs a signed-in user.)
    if (isGuest) { navigate(`/game/${code}`); return; }
    setJoining(true);
    try {
      const res = await authFetch(`/api/games/${code}`);
      if (res.ok) {
        navigate(`/game/${code}`);
      } else {
        const body = await res.json().catch(() => ({}));
        setJoinError(body.error ? { server: body.error } : { key: "home.roomNotFound" });
      }
    } catch {
      setJoinError({ key: "error.network" });
    } finally {
      setJoining(false);
    }
  }

  const matchLengthOptions = [1, 3, 5, 7].map(n => (
    <option key={n} value={n}>{n === 1 ? t("matchLength.one") : t("matchLength.bestOf", { n })}</option>
  ));

  if (loading) {
    return (
      <div style={S.page}>
        <LanguageBar />
        <div style={S.main}><p style={{ color: "#a07840" }}>…</p></div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <LanguageBar />
      <main style={S.main}>
        <div style={S.center}>
          <h1 style={S.title}>Bräde</h1>
          <p style={S.subtitle}>{t("home.subtitle")}</p>

          <div style={S.tutorial}>
            <button onClick={handleTutorial} disabled={startingTutorial} style={S.btnPrimary}>
              {startingTutorial ? t("common.starting") : t("home.learn")}
            </button>
            <p style={S.tutorialHint}>
              {t("home.learnHint")}
            </p>
            {tutorialError && <p style={S.error}>{msg(tutorialError)}</p>}
          </div>

          {user ? (
            <>
              <div style={{ marginTop: 28 }}>
                {user.avatar_url
                  ? <img src={user.avatar_url} alt="" style={S.avatar} />
                  : <span style={S.avatarPlaceholder}>{user.display_name[0].toUpperCase()}</span>
                }
                <p style={S.name}>{user.display_name}</p>
                <p style={S.elo}>{t("home.stats", { elo: user.elo, wins: user.wins, losses: user.losses })}</p>
              </div>

              <div style={S.row}>
                <Link to="/profile"      style={S.btnSecondary}>{t("common.profile")}</Link>
                <Link to="/leaderboard"  style={S.btnSecondary}>{t("common.leaderboard")}</Link>
                <Link to="/tournaments"  style={S.btnSecondary}>{t("common.tournaments")}</Link>
                <Link to="/rules"        style={S.btnSecondary}>{t("common.rules")}</Link>
                <button style={S.btnSecondary} onClick={logout}>{t("common.signOut")}</button>
              </div>

              <hr style={S.divider} />

              {/* ── Play ── */}
              <div style={S.playSection}>
                <p style={S.sectionLabel}>{t("home.createGame")}</p>
                <div style={S.playRow}>
                  <select
                    value={matchLength}
                    onChange={e => setMatchLength(Number(e.target.value))}
                    style={S.select}
                    aria-label={t("matchLength.label")}
                  >
                    {matchLengthOptions}
                  </select>
                  <button onClick={handleCreate} disabled={creating} style={S.btnPrimary}>
                    {creating ? t("common.creating") : t("home.createButton")}
                  </button>
                </div>

                <p style={{ ...S.sectionLabel, marginTop: 20 }}>{t("home.playAi")}</p>
                <div style={S.playRow}>
                  <button onClick={handleCreateAi} disabled={creatingAi} style={S.btnPrimary}>
                    {creatingAi ? t("common.starting") : t("home.playAi")}
                  </button>
                </div>
                {createError && <p style={S.error}>{msg(createError)}</p>}

                <p style={{ ...S.sectionLabel, marginTop: 20 }}>{t("home.findMatch")}</p>
                {mmStatus === "waiting" ? (
                  <div style={S.playRow}>
                    <span style={{ color: "#a07840", fontSize: 13 }}>
                      {t("home.searching")} {mmQueueSize > 1 ? t("home.inQueue", { n: mmQueueSize }) : ""}
                      {mmWaitSecs > 0 && t("home.waited", { n: mmWaitSecs })}
                    </span>
                    <button onClick={handleCancelMatch} style={S.btnSecondary}>{t("common.cancel")}</button>
                  </div>
                ) : (
                  <div style={S.playRow}>
                    <button onClick={handleFindMatch} style={S.btnPrimary}>{t("home.findMatchButton")}</button>
                  </div>
                )}

                <p style={{ ...S.sectionLabel, marginTop: 20 }}>{t("home.joinWithCode")}</p>
                <div style={S.playRow}>
                  <input
                    style={S.input}
                    placeholder={t("home.roomCodePlaceholder")}
                    maxLength={8}
                    value={roomCode}
                    onChange={e => {
                      setJoinError(null);
                      setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                    }}
                    onKeyDown={e => e.key === "Enter" && handleJoin()}
                  />
                  <button onClick={handleJoin} disabled={joining} style={S.btnPrimary}>
                    {joining ? t("common.joining") : t("common.join")}
                  </button>
                </div>
                {joinError && <p style={S.error}>{msg(joinError)}</p>}
              </div>
            </>
          ) : (
            <>
              <div style={S.row}>
                <a href={`${API}/auth/google`} style={S.btnPrimary}>{t("common.signInWith", { provider: "Google" })}</a>
                <a href={`${API}/auth/github`} style={S.btnSecondary}>{t("common.signInWith", { provider: "GitHub" })}</a>
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
                <Link to="/leaderboard" style={{ ...S.btnSecondary, fontSize: 12 }}>{t("common.leaderboard")}</Link>
                <Link to="/rules"       style={{ ...S.btnSecondary, fontSize: 12 }}>{t("common.rules")}</Link>
              </div>

              <hr style={S.divider} />

              <div style={S.playSection}>
                <p style={S.sectionLabel}>{t("home.playAsGuest")}</p>
                <div style={S.playRow}>
                  <input
                    style={S.nameInput}
                    placeholder={t("home.guestNamePlaceholder")}
                    aria-label={t("home.guestNameLabel")}
                    maxLength={GUEST_NAME_MAX}
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                  />
                  <select
                    value={matchLength}
                    onChange={e => setMatchLength(Number(e.target.value))}
                    style={S.select}
                    aria-label={t("matchLength.label")}
                  >
                    {matchLengthOptions}
                  </select>
                </div>
                <div style={{ ...S.playRow, marginTop: 12 }}>
                  <button onClick={handleCreate} disabled={creating || !trimmedGuestName} style={S.btnPrimary}>
                    {creating ? t("common.creating") : t("home.createButton")}
                  </button>
                  <button onClick={handleCreateAi} disabled={creatingAi || !trimmedGuestName} style={S.btnPrimary}>
                    {creatingAi ? t("common.starting") : t("home.playAi")}
                  </button>
                </div>
                {createError && <p style={S.error}>{msg(createError)}</p>}

                <p style={{ ...S.sectionLabel, marginTop: 20 }}>{t("home.joinWithCode")}</p>
                <div style={S.playRow}>
                  <input
                    style={S.input}
                    placeholder={t("home.roomCodePlaceholder")}
                    maxLength={8}
                    value={roomCode}
                    onChange={e => {
                      setJoinError(null);
                      setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                    }}
                    onKeyDown={e => e.key === "Enter" && handleJoin()}
                  />
                  <button onClick={handleJoin} style={S.btnPrimary}>{t("common.join")}</button>
                </div>
                {joinError && <p style={S.error}>{msg(joinError)}</p>}

                <p style={{ ...S.subtitle, fontSize: 12, marginTop: 16 }}>
                  {t("home.guestHint")}
                </p>
              </div>
            </>
          )}

          <footer style={S.footer}>
            <p style={S.footerText}>
              {t("home.footer", { org: t("source.org") })}{" "}
              <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={S.footerLink}>
                {t("home.footerLink")}
              </a>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
