import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { useSocket } from "../hooks/useSocket.js";
import Board from "../components/Board.jsx";

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex",
    alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif",
    padding: 16,
  },
  card: {
    background: "#3a1a00", borderRadius: 12, padding: "28px 32px",
    maxWidth: 640, width: "100%", boxSizing: "border-box",
  },
  header:   { display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" },
  back:     { color: "#a07840", textDecoration: "none", fontSize: 13 },
  title:    { color: "#e8b86d", fontSize: 22, margin: 0, flex: 1 },
  matchLen: { color: "#a07840", fontSize: 13 },
  disconnected: { color: "#c0392b", fontSize: 11 },

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

  spectators: { color: "#6b3a10", fontSize: 12, textAlign: "center", marginBottom: 12 },

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

  matchResult: { textAlign: "center", padding: "24px 0" },
  resultTitle: { color: "#e8b86d", fontSize: 24, marginBottom: 8 },
  resultScore: { color: "#a07840", fontSize: 16, marginBottom: 20 },

  muted:    { color: "#6b3a10", textAlign: "center" },
  errorMsg: { color: "#c0392b", textAlign: "center" },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function Game() {
  const { roomId } = useParams();
  const { user, loading, token, authFetch } = useAuth();

  const [room, setRoom]                     = useState(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [wsStatus, setWsStatus]             = useState("connecting");
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState([]);
  const [copyFeedback, setCopyFeedback]     = useState(false);
  const [invitedIds, setInvitedIds]         = useState(new Set());

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "ROOM_STATE":
        setRoom(msg.room);
        setSpectatorCount(msg.spectatorCount ?? 0);
        break;
    }
  }, []);

  const { send } = useSocket({
    roomId: (!loading && user && token) ? roomId : null,
    token,
    onMessage: handleMessage,
    onOpen:  () => setWsStatus("connected"),
    onClose: () => setWsStatus("disconnected"),
  });

  // Debounced user search
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await authFetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) setSearchResults(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived state
  const myColor   = !room ? null
    : room.players.white === user?.id ? "white"
    : room.players.black === user?.id ? "black"
    : null;
  const isPlayer  = myColor !== null;
  const isHost    = room?.createdBy === user?.id;
  const bothIn    = !!(room?.players.white && room?.players.black);
  const bothReady = !!(room?.ready?.white && room?.ready?.black);
  const inviteUrl = `${window.location.origin}/game/${roomId}`;

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
  function handleRoll()   { send({ type: "ROLL" }); }
  function handlePass()   { send({ type: "PASS" }); }
  function handleResign() { send({ type: "RESIGN" }); }
  function handleMove(from, to, die) { send({ type: "MOVE", from, to, die }); }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <FullPage><p style={S.muted}>…</p></FullPage>;

  if (!user) return (
    <FullPage>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "#a07840", marginBottom: 16 }}>Log in to join this game.</p>
        <Link to="/" style={{ color: "#e8b86d" }}>← Home</Link>
      </div>
    </FullPage>
  );

  if (wsStatus === "disconnected" && !room) return (
    <FullPage>
      <div style={{ textAlign: "center" }}>
        <p style={S.errorMsg}>Could not connect — room may not exist.</p>
        <Link to="/" style={{ color: "#a07840", fontSize: 13 }}>← Home</Link>
      </div>
    </FullPage>
  );

  return (
    <div style={S.page}>
      <div style={S.card}>

        {/* Header */}
        <div style={S.header}>
          <Link to="/" style={S.back}>← Home</Link>
          <h2 style={S.title}>Room {roomId}</h2>
          {room && <span style={S.matchLen}>Best of {room.matchLength}</span>}
          {wsStatus === "disconnected" && <span style={S.disconnected}>Disconnected</span>}
        </div>

        {!room ? (
          <p style={S.muted}>Connecting…</p>
        ) : room.status === "finished" ? (
          <MatchResult room={room} myColor={myColor} />
        ) : room.status === "playing" && room.gameState ? (
          <>
            {spectatorCount > 0 && (
              <p style={S.spectators}>{spectatorCount} spectator{spectatorCount !== 1 ? "s" : ""} watching</p>
            )}
            <Board
              gameState={room.gameState}
              score={room.score}
              matchLength={room.matchLength}
              myColor={myColor}
              playerInfo={room.playerInfo}
              onRoll={handleRoll}
              onMove={handleMove}
              onPass={handlePass}
              onResign={handleResign}
            />
          </>
        ) : (
          <>
            {/* Players */}
            <div style={S.players}>
              <PlayerCard
                label="White"
                info={room.playerInfo?.white}
                ready={room.ready?.white}
                isYou={myColor === "white"}
              />
              <div style={S.vsLabel}>vs</div>
              <PlayerCard
                label="Black"
                info={room.playerInfo?.black}
                ready={room.ready?.black}
                isYou={myColor === "black"}
              />
            </div>

            {spectatorCount > 0 && (
              <p style={S.spectators}>
                {spectatorCount} spectator{spectatorCount !== 1 ? "s" : ""} watching
              </p>
            )}

            {/* Actions — players only, lobby only */}
            {isPlayer && room.status !== "playing" && (
              <div style={S.actions}>
                <button
                  onClick={() => send({ type: "PLAYER_READY" })}
                  style={room.ready[myColor] ? S.btnUnready : S.btnReady}
                >
                  {room.ready[myColor] ? "Unready" : "Ready"}
                </button>
                {isHost && (
                  <button
                    onClick={() => send({ type: "START_GAME" })}
                    disabled={!bothIn || !bothReady}
                    style={bothIn && bothReady ? S.btnStart : S.btnStartDis}
                  >
                    Start Game
                  </button>
                )}
              </div>
            )}

            {/* Invite */}
            <div style={S.inviteSection}>
              <h3 style={S.sectionTitle}>Invite a player</h3>
              <div style={S.inviteRow}>
                <input value={inviteUrl} readOnly style={S.inviteInput} />
                <button onClick={handleCopyInvite} style={S.btnCopy}>
                  {copyFeedback ? "Copied!" : "Copy link"}
                </button>
              </div>
              <input
                style={S.searchInput}
                placeholder="Search player by name…"
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
                        {invitedIds.has(u.id) ? "Invited ✓" : "Invite"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FullPage({ children }) {
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif" }}>
      {children}
    </div>
  );
}

function PlayerCard({ label, info, ready, isYou }) {
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
          {isYou && <div style={S.you}>(you)</div>}
          <div style={ready ? S.readyBadge : S.notReadyBadge}>
            {ready ? "Ready" : "Not ready"}
          </div>
        </>
      ) : (
        <div style={S.waiting}>Waiting for opponent…</div>
      )}
    </div>
  );
}

function MatchResult({ room, myColor }) {
  const r = room.matchResult;
  if (!r) return null;
  const iWon = r.winner === myColor;
  const winnerName = room.playerInfo?.[r.winner]?.display_name ?? r.winner;
  return (
    <div style={S.matchResult}>
      <div style={{ ...S.resultTitle, color: iWon ? "#7ddb7d" : "#c0392b" }}>
        {iWon ? "You won the match!" : `${winnerName} wins the match`}
      </div>
      <div style={S.resultScore}>
        {room.playerInfo?.white?.display_name} {r.score.white} – {r.score.black} {room.playerInfo?.black?.display_name}
      </div>
      {r.whiteEloAfter && (
        <div style={{ color: "#6b3a10", fontSize: 12, marginBottom: 20 }}>
          ELO: {room.playerInfo?.white?.display_name} → {r.whiteEloAfter} &nbsp;|&nbsp;
          {room.playerInfo?.black?.display_name} → {r.blackEloAfter}
        </div>
      )}
      <Link to="/" style={{ color: "#a07840", fontSize: 14 }}>← Back to Home</Link>
    </div>
  );
}
