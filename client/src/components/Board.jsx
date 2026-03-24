import { useState } from "react";

// ── Styles ────────────────────────────────────────────────────────────────────
const C = {
  wrap:    { fontFamily: "Georgia, serif" },
  score:   { display: "flex", gap: 24, justifyContent: "center", alignItems: "center", marginBottom: 12 },
  scoreItem: { textAlign: "center" },
  scoreName: { color: "#a07840", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  scoreVal:  { color: "#e8b86d", fontSize: 22, fontWeight: "bold" },
  turn:    { color: "#7ddb7d", fontSize: 12, textAlign: "center", marginBottom: 8 },

  board:   { background: "#1a0a00", borderRadius: 8, padding: 8, border: "2px solid #4a2800" },
  row:     { display: "flex", alignItems: "stretch", gap: 2, marginBottom: 2 },
  barCell: { width: 36, flexShrink: 0, background: "#0d0500", borderRadius: 4,
             display: "flex", flexDirection: "column", alignItems: "center",
             justifyContent: "center", gap: 4, padding: "4px 0" },
  barLabel:{ color: "#4a2800", fontSize: 9 },

  // Point column
  pt:       { width: 36, flexShrink: 0, borderRadius: 4, cursor: "pointer",
               display: "flex", flexDirection: "column", alignItems: "center",
               padding: "4px 2px", gap: 2, minHeight: 120, position: "relative",
               transition: "background 0.1s" },
  ptEven:   { background: "#3a1a00" },
  ptOdd:    { background: "#2a1000" },
  ptSel:    { background: "#5a6a00", outline: "2px solid #c8e020" },
  ptDest:   { background: "#0a3a0a", outline: "2px solid #40c040" },
  ptFrom:   { background: "#1a2a00", outline: "1px solid #80a020" },
  ptNum:    { color: "#4a2800", fontSize: 9, userSelect: "none" },

  // Checker
  checker:  { width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
               display: "flex", alignItems: "center", justifyContent: "center",
               fontSize: 10, fontWeight: "bold", boxSizing: "border-box" },
  cWhite:   { background: "#e8d0a0", border: "2px solid #c8a060", color: "#6b3a10" },
  cBlack:   { background: "#1a0a00", border: "2px solid #6b3a10", color: "#e8b86d" },
  cSel:     { outline: "2px solid #ffe040" },
  overflow: { color: "#a07840", fontSize: 10 },

  // Off area
  offArea: { display: "flex", justifyContent: "space-around", marginTop: 8, padding: "4px 8px",
             background: "#0d0500", borderRadius: 6 },
  offItem: { textAlign: "center" },
  offLbl:  { color: "#4a2800", fontSize: 10, textTransform: "uppercase" },
  offVal:  { color: "#e8b86d", fontSize: 16 },

  // Dice
  diceRow: { display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" },
  die:     { width: 40, height: 40, background: "#f0e0c0", borderRadius: 6,
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr 1fr",
              padding: 4, boxSizing: "border-box" },
  dieUsed: { opacity: 0.3 },
  pip:     { width: 8, height: 8, borderRadius: "50%", background: "#2a1400",
              margin: "auto" },

  // Actions
  actions: { display: "flex", gap: 10, justifyContent: "center", marginTop: 12, flexWrap: "wrap" },
  btnRoll:   { background: "#6b3a10", color: "#e8b86d", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 14, cursor: "pointer" },
  btnPass:   { background: "#4a2800", color: "#a07840", border: "1px solid #6b3a10", borderRadius: 8, padding: "9px 22px", fontSize: 14, cursor: "pointer" },
  btnResign: { background: "#2a1400", color: "#6b3a10", border: "1px solid #3a1a00", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" },
  waiting:   { color: "#6b3a10", fontSize: 13, textAlign: "center", marginTop: 10 },
};

// Pip positions for dice faces (grid cells: row*3+col, 0-indexed)
const PIP_POSITIONS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DieFace({ value, used }) {
  const cells = Array(9).fill(false);
  (PIP_POSITIONS[value] ?? []).forEach(i => { cells[i] = true; });
  return (
    <div style={{ ...C.die, ...(used ? C.dieUsed : {}) }}>
      {cells.map((hasPip, i) => (
        <div key={i}>{hasPip && <div style={C.pip} />}</div>
      ))}
    </div>
  );
}

function Checker({ color, selected, count }) {
  const style = {
    ...C.checker,
    ...(color === "white" ? C.cWhite : C.cBlack),
    ...(selected ? C.cSel : {}),
  };
  return <div style={style}>{count && count > 1 ? count : ""}</div>;
}

// top: checkers hang from top (row above bar); bottom: checkers rise from bottom
function PointCol({ idx, gs, selected, legalFroms, legalDests, onSelect, position }) {
  const raw   = gs.board[idx];
  const color = raw > 0 ? "white" : raw < 0 ? "black" : null;
  const total = Math.abs(raw);
  const isSel = selected === idx;
  const isFrom = legalFroms.has(idx);
  const isDest = legalDests.has(idx);

  const ptStyle = {
    ...C.pt,
    ...(idx % 2 === 0 ? C.ptEven : C.ptOdd),
    ...(isSel  ? C.ptSel  : isDest ? C.ptDest : isFrom ? C.ptFrom : {}),
  };

  const MAX = 5;
  const visible = Math.min(total, MAX);
  const extra   = total - MAX;

  const checkers = [];
  for (let i = 0; i < visible; i++) {
    checkers.push(
      <Checker key={i} color={color} selected={isSel && i === 0} />
    );
  }
  if (extra > 0) checkers.push(<div key="x" style={C.overflow}>+{extra}</div>);

  const label = <div style={C.ptNum}>{idx + 1}</div>;

  return (
    <div style={ptStyle} onClick={() => onSelect(idx)}>
      {position === "top" ? (
        <>
          {label}
          {checkers}
        </>
      ) : (
        <>
          {[...checkers].reverse()}
          {label}
        </>
      )}
    </div>
  );
}

export default function Board({
  gameState: gs,
  score,
  matchLength,
  myColor,
  playerInfo,
  onRoll,
  onMove,
  onPass,
  onResign,
}) {
  const [selected, setSelected] = useState(null);

  const isMyTurn    = gs.turn === myColor;
  const canRoll     = isMyTurn && gs.phase === "rolling";
  const canMove     = isMyTurn && gs.phase === "moving";
  const noMoves     = canMove  && gs.legalMoves.length === 0;

  const legalFroms = canMove
    ? new Set(gs.legalMoves.map(m => m.from))
    : new Set();

  const legalDests = selected !== null
    ? new Set(gs.legalMoves.filter(m => m.from === selected).map(m => m.to))
    : new Set();

  function handleSelect(idx) {
    if (!canMove) return;
    if (selected !== null && legalDests.has(idx)) {
      const move = gs.legalMoves.find(m => m.from === selected && m.to === idx);
      if (move) { onMove(move.from, move.to, move.die); setSelected(null); return; }
    }
    setSelected(legalFroms.has(idx) ? (selected === idx ? null : idx) : null);
  }

  function handleBarClick() {
    if (!canMove) return;
    if (selected === "bar" && legalDests.has("off")) {
      const move = gs.legalMoves.find(m => m.from === "bar" && m.to === "off");
      if (move) { onMove(move.from, move.to, move.die); setSelected(null); return; }
    }
    if (selected !== null && legalDests.has("bar")) {
      // shouldn't happen (bar isn't a destination)
    }
    setSelected(legalFroms.has("bar") ? (selected === "bar" ? null : "bar") : null);
  }

  function handleOffClick() {
    if (!canMove || selected === null || !legalDests.has("off")) return;
    const move = gs.legalMoves.find(m => m.from === selected && m.to === "off");
    if (move) { onMove(move.from, move.to, move.die); setSelected(null); }
  }

  // Rows: top = indices 12–23 left→right; bottom = indices 11→0 left→right
  const topRow    = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const bottomRow = [11, 10,  9,  8,  7,  6,  5,  4,  3,  2,  1,  0];

  const barWhite = gs.bar.white;
  const barBlack = gs.bar.black;
  const barSel   = selected === "bar";
  const barDest  = legalDests.has("bar");

  const barStyle = {
    ...C.barCell,
    ...(barSel ? { background: "#5a6a00", outline: "2px solid #c8e020" } : {}),
    ...(legalFroms.has("bar") ? { cursor: "pointer" } : {}),
  };

  function BarContent() {
    return (
      <>
        <div style={C.barLabel}>BAR</div>
        {barWhite > 0 && (
          <Checker color="white" selected={barSel && gs.bar[myColor] > 0 && myColor === "white"} />
        )}
        {barWhite > 1 && <div style={C.overflow}>×{barWhite}</div>}
        {barBlack > 0 && (
          <Checker color="black" selected={barSel && myColor === "black"} />
        )}
        {barBlack > 1 && <div style={C.overflow}>×{barBlack}</div>}
      </>
    );
  }

  const neededToWin = Math.ceil(matchLength / 2);
  const turnLabel   = isMyTurn
    ? (canRoll ? "Your turn — roll the dice" : "Your turn — move a checker")
    : `${playerInfo?.[gs.turn]?.display_name ?? gs.turn}'s turn`;

  // Show original roll; dim dice already consumed
  const diceAll = gs.rolledDice.length > 0
    ? gs.rolledDice.map((d, i) => {
        const stillAvail = gs.dice.filter(x => x === d).length;
        const countBefore = gs.rolledDice.slice(0, i).filter(x => x === d).length;
        const used = countBefore >= stillAvail;
        return <DieFace key={i} value={d} used={used} />;
      })
    : null;

  return (
    <div style={C.wrap}>
      {/* Score */}
      <div style={C.score}>
        <div style={C.scoreItem}>
          <div style={C.scoreName}>{playerInfo?.white?.display_name ?? "White"}</div>
          <div style={C.scoreVal}>{score.white}</div>
        </div>
        <div style={{ color: "#4a2800", fontSize: 13 }}>of {neededToWin} needed</div>
        <div style={C.scoreItem}>
          <div style={C.scoreVal}>{score.black}</div>
          <div style={C.scoreName}>{playerInfo?.black?.display_name ?? "Black"}</div>
        </div>
      </div>

      <div style={C.turn}>{turnLabel}</div>

      {/* Board */}
      <div style={C.board}>
        {/* Top row */}
        <div style={C.row}>
          {topRow.slice(0, 6).map(idx => (
            <PointCol key={idx} idx={idx} gs={gs} selected={selected}
              legalFroms={legalFroms} legalDests={legalDests}
              onSelect={handleSelect} position="top" />
          ))}
          <div style={barStyle} onClick={handleBarClick}>
            <BarContent />
          </div>
          {topRow.slice(6).map(idx => (
            <PointCol key={idx} idx={idx} gs={gs} selected={selected}
              legalFroms={legalFroms} legalDests={legalDests}
              onSelect={handleSelect} position="top" />
          ))}
        </div>

        {/* Bottom row */}
        <div style={C.row}>
          {bottomRow.slice(0, 6).map(idx => (
            <PointCol key={idx} idx={idx} gs={gs} selected={selected}
              legalFroms={legalFroms} legalDests={legalDests}
              onSelect={handleSelect} position="bottom" />
          ))}
          <div style={barStyle} onClick={handleBarClick}>
            <BarContent />
          </div>
          {bottomRow.slice(6).map(idx => (
            <PointCol key={idx} idx={idx} gs={gs} selected={selected}
              legalFroms={legalFroms} legalDests={legalDests}
              onSelect={handleSelect} position="bottom" />
          ))}
        </div>

        {/* Borne-off */}
        <div
          style={{ ...C.offArea, cursor: legalDests.has("off") ? "pointer" : "default",
                   ...(legalDests.has("off") ? { outline: "1px solid #40c040" } : {}) }}
          onClick={handleOffClick}
        >
          <div style={C.offItem}>
            <div style={C.offLbl}>White off</div>
            <div style={C.offVal}>{gs.off.white}</div>
          </div>
          <div style={C.offItem}>
            <div style={C.offLbl}>Black off</div>
            <div style={C.offVal}>{gs.off.black}</div>
          </div>
        </div>
      </div>

      {/* Dice */}
      {diceAll && <div style={C.diceRow}>{diceAll}</div>}

      {/* Actions */}
      <div style={C.actions}>
        {canRoll && (
          <button style={C.btnRoll} onClick={onRoll}>Roll</button>
        )}
        {noMoves && (
          <button style={C.btnPass} onClick={onPass}>Pass (no moves)</button>
        )}
        <button style={C.btnResign} onClick={() => { if (window.confirm("Resign this game?")) onResign(); }}>
          Resign
        </button>
      </div>

      {!isMyTurn && (
        <div style={C.waiting}>Waiting for opponent…</div>
      )}
    </div>
  );
}
