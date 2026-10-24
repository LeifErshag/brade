import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link } from "react-router";
import { useAuth } from "../AuthContext.jsx";
import { useSocket } from "../hooks/useSocket.js";
import Board from "../components/Board.jsx";
import RulesDrawer from "../components/RulesDrawer.jsx";
import TutorialCoach from "../components/TutorialCoach.jsx";
import { OFFICIAL_RULES_URL } from "../components/RulesContent.jsx";
import LanguageToggle, { LanguageBar } from "../components/LanguageToggle.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import { setLogContext } from "../remoteLog.js";
import ReportProblem from "../components/ReportProblem.jsx";

const API = import.meta.env.VITE_API_URL ?? "";

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  // Top-aligned (not vertically centred) so the board doesn't move when the
  // content above/below it changes height. Gutters shrink on narrow screens.
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex",
    alignItems: "flex-start", justifyContent: "center", fontFamily: "Georgia, serif",
    padding: "clamp(6px, 2vw, 16px)", boxSizing: "border-box",
  },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: "clamp(10px, 2.5vw, 20px) clamp(8px, 3vw, 32px)",
    maxWidth: 860, width: "100%", boxSizing: "border-box",
  },
  header:   { display: "flex", alignItems: "center", gap: "4px 12px", marginBottom: 12, flexWrap: "wrap" },
  back:     { color: "#a07840", textDecoration: "none", fontSize: 13 },
  title:    { color: "#e8b86d", fontSize: "clamp(16px, 4.5vw, 22px)", margin: 0, flex: 1, whiteSpace: "nowrap" },
  matchLen: { color: "#a07840", fontSize: 13 },
  disconnected: { color: "#c0392b", fontSize: 11 },
  reconnecting: { color: "#d68910", fontSize: 11 },
  btnRules: {
    background: "#2a1400", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 6,
    padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
  },

  players: { display: "flex", gap: 16, alignItems: "stretch", marginBottom: 16 },
  vsLabel: { color: "#6b3a10", fontSize: 20, display: "flex", alignItems: "center", flexShrink: 0 },
  pCard: {
    flex: 1, background: "#2a1400", borderRadius: 8, padding: "16px 12px",
    textAlign: "center", minHeight: 130,
  },
  pLabel:   { color: "#a07840", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  avatar:   { width: 48, height: 48, borderRadius: "50%", border: "2px solid #6b3a10" },
  avatarPh: {
    width: 48, height: 48, borderRadius: "50%", border: "2px solid #6b3a10",
    background: "#6b3a10", display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: "#e8b86d", fontSize: 20, margin: "0 auto",
  },
  pName:         { color: "#e8b86d", fontSize: 14, marginTop: 8 },
  you:           { color: "#a07840", fontSize: 11 },
  waiting:       { color: "#6b3a10", fontSize: 13, marginTop: 24 },
  readyBadge:    { display: "inline-block", marginTop: 6, padding: "2px 8px", borderRadius: 10, background: "#1a5c1a", color: "#7ddb7d", fontSize: 11 },
  notReadyBadge: { display: "inline-block", marginTop: 6, padding: "2px 8px", borderRadius: 10, background: "#4a2800", color: "#a07840", fontSize: 11 },

  spectators: { color: "#6b3a10", fontSize: 12, textAlign: "center", margin: "0 0 12px" },
  // Under the board during play: one compact line that fits inside the
  // board height budget in Board.jsx (100vh - 300px), so it never scrolls.
  spectatorsPlaying: {
    color: "#6b3a10", fontSize: 12, lineHeight: "16px", height: 16, textAlign: "center",
    margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  coachWrap:  { marginTop: 12 },

  actions:        { display: "flex", gap: 10, justifyContent: "center", marginBottom: 20, flexWrap: "wrap" },
  btnReady:       { background: "#1a5c1a", color: "#7ddb7d", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, cursor: "pointer" },
  btnUnready:     { background: "#4a2800", color: "#a07840", border: "1px solid #6b3a10", borderRadius: 8, padding: "10px 24px", fontSize: 14, cursor: "pointer" },
  btnStart:       { background: "#6b3a10", color: "#e8b86d", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, cursor: "pointer" },
  btnStartDis:    { background: "#2a1400", color: "#4a2800", border: "1px solid #3a1a00", borderRadius: 8, padding: "10px 24px", fontSize: 14, cursor: "not-allowed" },

  inviteSection: { borderTop: "1px solid #4a2800", paddingTop: 18, marginTop: 4 },
  sectionTitle:  { color: "#a07840", fontSize: 13, margin: "0 0 10px" },
  inviteRow:     { display: "flex", gap: 8, marginBottom: 12 },
  inviteInput:   { flex: 1, background: "#2a1400", color: "#a07840", border: "1px solid #4a2800", borderRadius: 6, padding: "7px 10px", fontSize: 12, outline: "none" },
  btnCopy:       { background: "#3a1a00", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  searchInput:   { width: "100%", boxSizing: "border-box", background: "#2a1400", color: "#e8b86d", border: "1px solid #4a2800", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" },
  searchResults: { listStyle: "none", padding: 0, margin: "8px 0 0" },
  searchResult:  { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, background: "#2a1400", marginBottom: 4 },
  miniAvatar:    { width: 28, height: 28, borderRadius: "50%", flexShrink: 0 },
  resultName:    { flex: 1, color: "#e8b86d", fontSize: 13 },
  btnInvite:     { background: "#6b3a10", color: "#e8b86d", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  btnInvited:    { background: "#1a5c1a", color: "#7ddb7d", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "default" },

  resultBanner: {
    background: "#2a1400", borderRadius: 10, padding: "20px 24px",
    marginBottom: 24, textAlign: "center", border: "1px solid #4a2800",
  },
  resultTitle: { color: "#e8b86d", fontSize: 24, margin: "0 0 6px" },
  resultWinType: { color: "#a07840", fontSize: 14, marginBottom: 10 },
  resultScore: { color: "#a07840", fontSize: 15, marginBottom: 8 },
  resultElo:   { color: "#6b3a10", fontSize: 12, marginBottom: 16 },

  muted:    { color: "#6b3a10", textAlign: "center" },
  errorMsg: { color: "#c0392b", textAlign: "center" },

  // Guest join page
  guestBox:    { textAlign: "center", maxWidth: 340, margin: "0 auto" },
  guestTitle:  { color: "#e8b86d", fontSize: 20, marginBottom: 8 },
  guestSub:    { color: "#a07840", fontSize: 13, marginBottom: 24 },
  btnGuest:    { background: "#6b3a10", color: "#e8b86d", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 15, cursor: "pointer", width: "100%", marginBottom: 16 },
  orDivider:   { color: "#4a2800", fontSize: 12, margin: "0 0 16px" },
  loginRow:    { display: "flex", gap: 10, justifyContent: "center" },
  btnLogin:    { background: "#3a1a00", color: "#a07840", border: "1px solid #6b3a10", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer", textDecoration: "none" },

  // Toasts (fixed, bottom-center)
  toastWrap:  { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 8, zIndex: 1000, alignItems: "center", pointerEvents: "none" },
  toast:      { pointerEvents: "auto", cursor: "pointer", background: "#3a1a00", color: "#e8b86d", borderRadius: 8, padding: "10px 18px", fontSize: 13, boxShadow: "0 4px 20px #00000099", maxWidth: 340, textAlign: "center" },
  toastError: { border: "1px solid #c0392b" },
  toastInfo:  { border: "1px solid #6b3a10" },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function Game() {
  const { roomId } = useParams();
  const { user, loading, token, authFetch } = useAuth();
  const { t, winType } = useI18n();

  // Guest session — persisted in sessionStorage so refresh doesn't kick them out
  const [guestToken, setGuestToken] = useState(
    () => sessionStorage.getItem(`guest_token_${roomId}`) ?? null
  );
  const [guestId, setGuestId] = useState(
    () => sessionStorage.getItem(`guest_id_${roomId}`) ?? null
  );
  const [guestJoining, setGuestJoining] = useState(false);

  const [room, setRoom]                     = useState(null);
  const [junkerNotice, setJunkerNotice]     = useState(null);
  // Result of the game that just ended within a match: { winner, winType }.
  const [gameResult, setGameResult]         = useState(null);
  const gameResultTimer                     = useRef(null);
  const junkerTimer                         = useRef(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [wsStatus, setWsStatus]             = useState("connecting");
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState([]);
  const [copyFeedback, setCopyFeedback]     = useState(false);
  const [invitedIds, setInvitedIds]         = useState(new Set());
  const [toasts, setToasts]                 = useState([]);
  const [rulesOpen, setRulesOpen]           = useState(false);
  const [rulesSection, setRulesSection]     = useState(undefined);
  const closeRules = useCallback(() => setRulesOpen(false), []);
  // Tutorial: explanations open the drawer scrolled to their rules section.
  const openRulesAt = useCallback((section) => {
    setRulesSection(section);
    setRulesOpen(true);
  }, []);
  const [illegalAttempt, setIllegalAttempt] = useState(null);
  const handleIllegalAttempt = useCallback(({ from, to }) => {
    setIllegalAttempt({ from, to, n: Date.now() });
  }, []);

  // Use whichever token is available (real auth takes precedence over guest)
  const wsToken = token || guestToken;
  const myId    = user?.id || guestId;

  // `message` is a descriptor ({ key } or { server }), translated when shown.
  const pushToast = useCallback((message, kind = "error") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "ROOM_STATE":
        setRoom(msg.room);
        setSpectatorCount(msg.spectatorCount ?? 0);
        // Deliberately keeps the game-result notice: in AI rooms the AI may
        // open the next game within a second, which would otherwise hide it.
        break;
      case "GAME_OVER":
        // A game within the match ended; the next game has already started.
        setGameResult({ winner: msg.winner, winType: msg.winType });
        clearTimeout(gameResultTimer.current);
        gameResultTimer.current = setTimeout(() => setGameResult(null), 4000);
        break;
      case "NO_MOVES":
        setJunkerNotice(msg.color);
        clearTimeout(junkerTimer.current);
        junkerTimer.current = setTimeout(() => setJunkerNotice(null), 2500);
        break;
      case "ERROR":
        pushToast({ server: msg.message });
        break;
    }
  }, [pushToast]);

  // Neither notice timer may fire after leaving the page.
  useEffect(() => () => {
    clearTimeout(gameResultTimer.current);
    clearTimeout(junkerTimer.current);
  }, []);

  // Tag client log lines sent to the server with this room and token. Not
  // cleared on unmount: a report from the crash screen still needs them, and
  // remoteLog only uses them while the address is this room's page. Declared
  // before useSocket so that it runs first and lines from the very first
  // connect attempt are tagged too.
  useEffect(() => {
    setLogContext({ roomId, token: wsToken ?? null });
  }, [roomId, wsToken]);

  const { send } = useSocket({
    roomId: (wsToken && !loading) ? roomId : null,
    token:  wsToken,
    onMessage: handleMessage,
    onOpen:  () => setWsStatus("connected"),
    onClose: () => setWsStatus("disconnected"),
    onReconnecting: () => setWsStatus("reconnecting"),
  });

  // Debounced user search
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await authFetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
      // A rejected query (e.g. under 2 characters after trimming) clears stale results.
      setSearchResults(res.ok ? await res.json() : []);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function handleJoinAsGuest() {
    setGuestJoining(true);
    try {
      const res = await fetch(`${API}/api/guest`, { method: "POST" });
      if (res.ok) {
        const { token: gt, guestId: gid } = await res.json();
        sessionStorage.setItem(`guest_token_${roomId}`, gt);
        sessionStorage.setItem(`guest_id_${roomId}`,    gid);
        setGuestToken(gt);
        setGuestId(gid);
      }
    } finally {
      setGuestJoining(false);
    }
  }

  // Derived state
  const myColor   = !room ? null
    : room.players.white === myId ? "white"
    : room.players.black === myId ? "black"
    : null;
  const isPlayer  = myColor !== null;
  const isHost    = room?.createdBy === myId;
  const bothIn    = !!(room?.players.white && room?.players.black);
  const bothReady = !!(room?.ready?.white && room?.ready?.black);
  const inviteUrl = `${window.location.origin}/game/${roomId}`;
  const isTutorial = !!room?.isTutorial;
  const coach = isTutorial && isPlayer && (
    <TutorialCoach
      room={room}
      myColor={myColor}
      noMovesColor={junkerNotice}
      illegalAttempt={illegalAttempt}
      onOpenRules={openRulesAt}
    />
  );

  // ── Debug console hooks: window.__brade ─────────────────────────────────────
  // state()  → client's view of the current room (turn/phase/canRoll/wsStatus)
  // server() → fetch authoritative server state for this room
  // dump()   → both side by side, for spotting client/server divergence
  const debugRef = useRef(null);
  debugRef.current = { room, roomId, myId, myColor, wsToken, wsStatus, spectatorCount };

  useEffect(() => {
    const summarize = () => {
      const d  = debugRef.current;
      const gs = d.room?.gameState ?? null;
      const isMyTurn = gs ? gs.turn === d.myColor : null;
      return {
        roomId:     d.roomId,
        wsStatus:   d.wsStatus,
        myId:       d.myId,
        myColor:    d.myColor,
        status:     d.room?.status ?? null,
        gameNum:    d.room?.gameNum ?? null,
        score:      d.room?.score ?? null,
        spectators: d.spectatorCount,
        turn:       gs?.turn ?? null,
        phase:      gs?.phase ?? null,
        isMyTurn,
        canRoll:    isMyTurn === true && gs?.phase === "rolling",
        dice:       gs?.dice ?? null,
        rolledDice: gs?.rolledDice ?? null,
        legalMoves: gs?.legalMoves?.length ?? null,
      };
    };
    const serverUrl = () => `${API}/api/games/${debugRef.current.roomId}/debug`;
    // Problem reports attach the same summary (issue #141).
    setLogContext({ state: summarize });

    window.__brade = {
      state() {
        const snap = summarize();
        console.log("[brade] client state", snap);
        console.log("[brade] full room", debugRef.current.room);
        return snap;
      },
      async server() {
        const d   = debugRef.current;
        const url = serverUrl();
        if (!d.wsToken) {
          console.warn(`[brade] no token available — open manually: ${url}`);
          return null;
        }
        try {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${d.wsToken}` } });
          if (!res.ok) {
            console.error(`[brade] server dump failed (${res.status}). URL: ${url}`);
            return null;
          }
          const data = await res.json();
          console.log("[brade] server state", data);
          return data;
        } catch (err) {
          console.error(`[brade] server dump error: ${err?.message ?? err}. URL: ${url}`);
          return null;
        }
      },
      async dump() {
        const client = window.__brade.state();
        const server = await window.__brade.server();
        return { client, server };
      },
      help() {
        console.log(
          "[brade] debug helpers (current room only):\n" +
          "  __brade.state()  → client's view (turn/phase/canRoll/wsStatus)\n" +
          "  __brade.server() → authoritative server state\n" +
          "  __brade.dump()   → both, for spotting divergence"
        );
      },
    };
    console.info("[brade] debug hooks ready — run __brade.help()");

    return () => {
      delete window.__brade;
    };
  }, []);

  async function handleCopyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }

  function handleInvite(targetUser) {
    send({ type: "INVITE_PLAYER", targetUserId: targetUser.id });
    setInvitedIds(prev => new Set([...prev, targetUser.id]));
    handleCopyInvite();
  }

  // ── Game actions ──────────────────────────────────────────────────────────
  // send() returns false when the socket isn't open, so the action never left
  // the browser — surface that instead of letting it silently disappear.
  function gameSend(msg) {
    if (!send(msg)) { pushToast({ key: "game.notConnected" }); return; }
    // The viewer's own action ends the game-result notice early.
    clearTimeout(gameResultTimer.current);
    setGameResult(null);
  }
  function handleRoll()   { gameSend({ type: "ROLL" }); }
  function handlePass()   { gameSend({ type: "PASS" }); }
  function handleResign() { gameSend({ type: "RESIGN" }); }
  function handleMove(from, to, die) { gameSend({ type: "MOVE", from, to, die }); }

  // ── Render ───────────────────────────────────────────────────────────────

  // Right after the title, so on narrow screens it stays on the first header
  // line instead of wrapping below the match info and Rules button.
  const langToggle = <LanguageToggle />;

  if (loading && !guestToken) return <FullPage><p style={S.muted}>…</p></FullPage>;

  // Not authenticated and no guest token yet — offer choices
  if (!wsToken) return (
    <FullPage>
      <div style={S.guestBox}>
        <h2 style={S.guestTitle}>{t("game.invitedTitle")}</h2>
        <p style={S.guestSub}>{t("game.invitedSub")}</p>
        <button
          style={S.btnGuest}
          onClick={handleJoinAsGuest}
          disabled={guestJoining}
        >
          {guestJoining ? t("common.joining") : t("game.playAsGuest")}
        </button>
        <p style={S.orDivider}>{t("game.orSignIn")}</p>
        <div style={S.loginRow}>
          <a href={`${API}/auth/google`} style={S.btnLogin}>Google</a>
          <a href={`${API}/auth/github`} style={S.btnLogin}>GitHub</a>
        </div>
        <Link to="/" style={{ display: "block", marginTop: 20, color: "#6b3a10", fontSize: 12 }}>{t("common.backToHome")}</Link>
      </div>
    </FullPage>
  );

  if (wsStatus === "disconnected" && !room) return (
    <FullPage>
      <div style={{ textAlign: "center" }}>
        <p style={S.errorMsg}>{t("game.couldNotConnect")}</p>
        <Link to="/" style={{ color: "#a07840", fontSize: 13 }}>{t("common.backHome")}</Link>
      </div>
    </FullPage>
  );

  return (
    <div style={S.page}>
      <div style={S.card}>

        {/* Header */}
        <div style={S.header}>
          {room?.tournamentId
            ? <Link to={`/tournaments/${room.tournamentId}`} style={S.back}>{t("game.backTournament")}</Link>
            : <Link to="/" style={S.back}>{t("common.backHome")}</Link>
          }
          {isTutorial ? (
            <>
              <h2 style={S.title}>{t("game.tutorialTitle")}</h2>
              {langToggle}
              <span style={S.matchLen}>{t("game.notRated")}</span>
            </>
          ) : (
            <>
              <h2 style={S.title}>{t("game.roomTitle", { id: roomId })}</h2>
              {langToggle}
              {room && (
                <span style={S.matchLen}>
                  {room.matchLength === 1 ? t("game.matchLengthOne") : t("game.matchLength", { n: room.matchLength })}
                </span>
              )}
            </>
          )}
          {wsStatus === "disconnected" && <span style={S.disconnected}>{t("game.disconnected")}</span>}
          {wsStatus === "reconnecting" && <span style={S.reconnecting}>{t("game.reconnecting")}</span>}
          <button
            type="button"
            style={S.btnRules}
            onClick={() => openRulesAt(undefined)}
            aria-haspopup="dialog"
            aria-expanded={rulesOpen}
          >
            {t("game.rules")}
          </button>
          <ReportProblem />
        </div>

        {!room ? (
          <p style={S.muted}>{t("game.connecting")}</p>
        ) : room.status === "finished" ? (
          <>
            <MatchResult room={room} myColor={myColor} />
            {room.gameState && (
              <Board
                gameState={room.gameState}
                score={room.score}
                matchLength={room.matchLength}
                gameNum={room.gameNum}
                myColor={myColor}
                playerInfo={room.playerInfo}
                readOnly
                gameOver
              />
            )}
          </>
        ) : room.status === "playing" && room.gameState ? (
          <>
            <Board
              gameState={room.gameState}
              score={room.score}
              matchLength={room.matchLength}
              gameNum={room.gameNum}
              myColor={myColor}
              playerInfo={room.playerInfo}
              onRoll={handleRoll}
              onMove={handleMove}
              onPass={handlePass}
              onResign={handleResign}
              // Spectators watch: no Roll / Pass / Resign and no "Waiting for
              // opponent…" (the server ignores their actions anyway).
              readOnly={!isPlayer}
              junkerNotice={junkerNotice}
              gameNotice={gameResult && gameResultText(gameResult, room, myColor, t, winType)}
              highlightLegal={isTutorial}
              onIllegalAttempt={isTutorial ? handleIllegalAttempt : undefined}
            />
            {/* Below the board so it appearing doesn't push the board down. */}
            {spectatorCount > 0 && (
              <p style={S.spectatorsPlaying}>{spectatorText(spectatorCount, t)}</p>
            )}
          </>
        ) : (
          <>
            {/* Players */}
            <div style={S.players}>
              <PlayerCard
                label={t("common.white")}
                info={room.playerInfo?.white}
                ready={room.ready?.white}
                isYou={myColor === "white"}
              />
              <div style={S.vsLabel}>{t("common.vs")}</div>
              <PlayerCard
                label={t("common.black")}
                info={room.playerInfo?.black}
                ready={room.ready?.black}
                isYou={myColor === "black"}
              />
            </div>

            {spectatorCount > 0 && (
              <p style={S.spectators}>
                {spectatorText(spectatorCount, t)}
              </p>
            )}

            {/* Actions — players only, lobby only */}
            {isPlayer && room.status !== "playing" && (
              <div style={S.actions}>
                <button
                  onClick={() => send({ type: "PLAYER_READY" })}
                  style={room.ready[myColor] ? S.btnUnready : S.btnReady}
                >
                  {room.ready[myColor] ? t("game.unready") : t("game.ready")}
                </button>
                {isHost && (
                  <button
                    onClick={() => send({ type: "START_GAME" })}
                    disabled={!bothIn || !bothReady}
                    style={bothIn && bothReady ? S.btnStart : S.btnStartDis}
                  >
                    {t("game.startGame")}
                  </button>
                )}
              </div>
            )}

            {/* Invite — only show to the host, and only if no guest has joined yet */}
            {isHost && !room.hasGuest && (
              <div style={S.inviteSection}>
                <h3 style={S.sectionTitle}>{t("game.inviteTitle")}</h3>
                <div style={S.inviteRow}>
                  <input value={inviteUrl} readOnly style={S.inviteInput} />
                  <button onClick={handleCopyInvite} style={S.btnCopy}>
                    {copyFeedback ? t("game.copied") : t("game.copyLink")}
                  </button>
                </div>
                <input
                  style={S.searchInput}
                  placeholder={t("game.searchPlaceholder")}
                  maxLength={50}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchResults.length > 0 && (
                  <ul style={S.searchResults}>
                    {searchResults.map(u => (
                      <li key={u.id} style={S.searchResult}>
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt="" style={S.miniAvatar} />
                          : <div style={{ ...S.miniAvatar, background: "#6b3a10", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#e8b86d", fontSize: 13, flexShrink: 0 }}>
                              {u.display_name?.[0]?.toUpperCase()}
                            </div>
                        }
                        <span style={S.resultName}>{u.display_name}</span>
                        <button
                          onClick={() => handleInvite(u)}
                          disabled={invitedIds.has(u.id)}
                          style={invitedIds.has(u.id) ? S.btnInvited : S.btnInvite}
                        >
                          {invitedIds.has(u.id) ? t("game.invited") : t("game.invite")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {/* Rendered once, outside the playing/finished branches, so the coach
            keeps its history when the game ends. It sits below the board and
            controls so its changing height never moves the play area. */}
        {coach && <div style={S.coachWrap}>{coach}</div>}
      </div>

      {/* Rules drawer: fixed overlay sibling of the card. Opening/closing only
          toggles local state — the board and the socket are never re-mounted. */}
      <RulesDrawer open={rulesOpen} onClose={closeRules} section={rulesSection} />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toasts({ toasts, onDismiss }) {
  const { t, msg } = useI18n();
  if (toasts.length === 0) return null;
  return (
    <div style={S.toastWrap}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{ ...S.toast, ...(toast.kind === "error" ? S.toastError : S.toastInfo) }}
          onClick={() => onDismiss(toast.id)}
          title={t("game.dismiss")}
        >
          {msg(toast.message)}
        </div>
      ))}
    </div>
  );
}

function FullPage({ children }) {
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      flexDirection: "column", fontFamily: "Georgia, serif" }}>
      <LanguageBar />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px 48px" }}>
        {children}
      </div>
    </div>
  );
}

function PlayerCard({ label, info, ready, isYou }) {
  const { t } = useI18n();
  return (
    <div style={S.pCard}>
      <div style={S.pLabel}>{label}</div>
      {info ? (
        <>
          {info.avatar_url
            ? <img src={info.avatar_url} alt="" style={S.avatar} />
            : <div style={S.avatarPh}>{info.display_name?.[0]?.toUpperCase()}</div>
          }
          <div style={S.pName}>{info.display_name}</div>
          {isYou && <div style={S.you}>{t("game.you")}</div>}
          <div style={ready ? S.readyBadge : S.notReadyBadge}>
            {ready ? t("game.ready") : t("game.notReady")}
          </div>
        </>
      ) : (
        <div style={S.waiting}>{t("game.waitingForOpponent")}</div>
      )}
    </div>
  );
}

function spectatorText(n, t) {
  return n === 1 ? t("game.spectatorsOne") : t("game.spectators", { n });
}

// A player's display name, or the translated colour when there is none.
function playerName(room, color, t) {
  const name = room.playerInfo?.[color]?.display_name;
  if (name) return name;
  return color === "white" || color === "black" ? t(`common.${color}`) : color;
}

// Status-line notice for a game that ended within a match. room.gameNum is
// already the next game's number when GAME_OVER arrives.
function gameResultText({ winner, winType: type }, room, myColor, t, winType) {
  const n     = room.gameNum - 1;
  const label = type ? winType(type) : "";
  const who   = winner === myColor
    ? t("game.noticeYouWon", { n })
    : t("game.noticeOtherWon", { name: playerName(room, winner, t), n });
  return label ? t("game.noticeWithType", { who, label }) : who;
}

function MatchResult({ room, myColor }) {
  const { t, winType } = useI18n();
  const r = room.matchResult;
  if (!r) return null;
  const iWon       = r.winner === myColor;
  const winnerName = playerName(room, r.winner, t);
  const winLabel   = r.winType ? winType(r.winType) : "";

  const myEloAfter = myColor === "white" ? r.whiteEloAfter : r.blackEloAfter;

  if (room.isTutorial) {
    // A spectator sees who actually won; black is always the computer.
    const title = iWon ? t("result.tutorialWon")
      : myColor || r.winner !== "white" ? t("result.tutorialLost")
      : t("result.otherWon", { name: winnerName });
    return (
      <div style={S.resultBanner}>
        <div style={{ ...S.resultTitle, color: iWon ? "#7ddb7d" : "#c0392b" }}>
          {title}
        </div>
        {winLabel && <div style={S.resultWinType}>{winLabel}</div>}
        <div style={S.resultElo}>{t("result.tutorialNotRated")}</div>
        <p style={{ margin: "0 0 12px" }}>
          <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#e8b86d", fontSize: 14 }}>
            {t("result.officialRules")}
          </a>
        </p>
        <Link to="/" style={{ color: "#a07840", fontSize: 14 }}>{t("common.backToHome")}</Link>
      </div>
    );
  }

  return (
    <div style={S.resultBanner}>
      <div style={{ ...S.resultTitle, color: iWon ? "#7ddb7d" : "#c0392b" }}>
        {iWon ? t("result.youWon") : t("result.otherWon", { name: winnerName })}
      </div>
      {winLabel && <div style={S.resultWinType}>{winLabel}</div>}
      <div style={S.resultScore}>
        {room.playerInfo?.white?.display_name} {r.score.white} – {r.score.black} {room.playerInfo?.black?.display_name}
      </div>
      {myEloAfter && (
        <div style={S.resultElo}>{t("result.yourElo", { elo: myEloAfter })}</div>
      )}
      <Link to="/" style={{ color: "#a07840", fontSize: 14 }}>{t("common.backToHome")}</Link>
    </div>
  );
}
