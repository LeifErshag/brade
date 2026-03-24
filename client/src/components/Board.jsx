import { useState } from "react";

// ── SVG Layout Constants ─────────────────────────────────────────────────────
const W = 800, H = 500, MARGIN = 28, BAR_W = 40;
const BOARD_W = W - 2 * MARGIN, BOARD_H = H - 2 * MARGIN;
const HALF_W = (BOARD_W - BAR_W) / 2;
const PT_W = HALF_W / 6, PT_H = BOARD_H * 0.43;
const CR = Math.min(PT_W * 0.42, 17);

// ── Colors ───────────────────────────────────────────────────────────────────
const BG = "#c8934a", FRAME = "#6b3a10", INNER = "#8b4e18";
const TD = "#5c2e08", TL = "#e8b86d", BAR_C = "#7a4418", BAR_S = "#5c3010";
const LEGAL = "rgba(80,255,140,0.5)", SEL = "rgba(255,255,255,0.22)", HINT = "rgba(255,255,255,0.08)";

const WHITE_FILL = "#f5edd0", WHITE_STROKE = "#c8a050";
const BLACK_FILL = "#2a1800", BLACK_STROKE = "#6b3a10";

// ── Geometry Helpers (0-indexed: 0–23) ───────────────────────────────────────
function isTop(idx) { return idx >= 12; }

function colOf(idx) {
  return isTop(idx) ? idx - 12 : 11 - idx;
}

function ptCX(idx) {
  const col = colOf(idx);
  return MARGIN + (col >= 6 ? HALF_W + BAR_W : 0) + (col % 6) * PT_W + PT_W / 2;
}

function triPoints(idx) {
  const col = colOf(idx);
  const bx = MARGIN + (col >= 6 ? HALF_W + BAR_W : 0) + (col % 6) * PT_W;
  if (isTop(idx))
    return `${bx},${MARGIN} ${bx + PT_W},${MARGIN} ${bx + PT_W / 2},${MARGIN + PT_H}`;
  return `${bx},${MARGIN + BOARD_H} ${bx + PT_W},${MARGIN + BOARD_H} ${bx + PT_W / 2},${MARGIN + BOARD_H - PT_H}`;
}

function checkerY(idx, i, n) {
  const sp = Math.min(CR * 2.1, (PT_H - CR * 2.5) / Math.max(n - 1, 1));
  return isTop(idx) ? MARGIN + CR + 6 + i * sp : MARGIN + BOARD_H - CR - 6 - i * sp;
}

// ── Dice pip positions ───────────────────────────────────────────────────────
const DOT_MAP = {
  1: [[50, 50]],
  2: [[25, 25], [75, 75]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[25, 25], [75, 25], [25, 75], [75, 75]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[25, 22], [75, 22], [25, 50], [75, 50], [25, 78], [75, 78]],
};

function SvgDie({ value, color, used }) {
  const fill = color === "white" ? WHITE_FILL : BLACK_FILL;
  const stroke = color === "white" ? WHITE_STROKE : BLACK_STROKE;
  const dot = color === "white" ? "#2a1800" : "#e8b86d";
  const dots = DOT_MAP[value] || [];
  return (
    <svg width={44} height={44} style={{ opacity: used ? 0.3 : 1 }}>
      <rect x={2} y={2} width={40} height={40} rx={7} fill={fill} stroke={stroke} strokeWidth="2" />
      {dots.map(([dx, dy], i) => (
        <circle key={i} cx={dx * 0.4 + 2} cy={dy * 0.4 + 2} r={3.5} fill={dot} />
      ))}
    </svg>
  );
}

// ── Checker SVG element ──────────────────────────────────────────────────────
function CheckerCircle({ cx, cy, color, showCount, count }) {
  const fill = color === "white" ? WHITE_FILL : BLACK_FILL;
  const stroke = color === "white" ? WHITE_STROKE : BLACK_STROKE;
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={CR} fill={fill} stroke={stroke} strokeWidth="2" />
      <circle cx={cx} cy={cy} r={CR * 0.62} fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.4" />
      <ellipse cx={cx - CR * 0.27} cy={cy - CR * 0.27} rx={CR * 0.24} ry={CR * 0.17}
        fill={color === "white" ? "#ffffffcc" : "#ffffff33"} />
      {showCount && (
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          fontSize={CR * 0.9} fill={color === "white" ? "#6b3a10" : "#e8b86d"} fontWeight="bold">
          {count}
        </text>
      )}
    </g>
  );
}

// ── Off Tray ─────────────────────────────────────────────────────────────────
function OffTray({ color, n, glowing, onClick }) {
  const fill = color === "white" ? WHITE_FILL : BLACK_FILL;
  const stroke = color === "white" ? WHITE_STROKE : BLACK_STROKE;
  const x = W - MARGIN + 5, w = MARGIN - 9, isW = color === "white";
  const ty = isW ? MARGIN : MARGIN + BOARD_H / 2 + 5, th = BOARD_H / 2 - 5;
  const y0 = isW ? MARGIN + 4 : MARGIN + BOARD_H / 2 + 8, maxH = BOARD_H / 2 - 14;
  const sp = Math.min(CR * 1.5, maxH / Math.max(n, 1));
  const circles = [];
  for (let i = 0; i < Math.min(n, 15); i++) {
    const cy = isW ? y0 + i * sp + CR : y0 + maxH - i * sp - CR;
    circles.push(
      <circle key={i} cx={x + w / 2} cy={cy} r={Math.min(CR * 0.7, w / 2 - 1)}
        fill={fill} stroke={stroke} strokeWidth="1.5" style={{ pointerEvents: "none" }} />
    );
  }
  return (
    <g onClick={glowing ? onClick : undefined} style={{ cursor: glowing ? "pointer" : "default" }}>
      <rect x={W - MARGIN + 3} y={ty} width={MARGIN - 6} height={th} rx={3} fill={BAR_C}
        stroke={glowing ? "rgba(80,255,140,0.9)" : "none"} strokeWidth="2" />
      {circles}
      {n > 0 && (
        <text x={x + w / 2} y={isW ? y0 + maxH - 4 : y0 + 4} textAnchor="middle" fontSize="10"
          fill={isW ? "#e8b86d" : "#f5edd0"} fontWeight="bold"
          dominantBaseline={isW ? "auto" : "hanging"} style={{ pointerEvents: "none" }}>
          {n}
        </text>
      )}
      <rect x={W - MARGIN + 3} y={ty} width={MARGIN - 6} height={th} rx={3} fill="transparent" />
    </g>
  );
}

// ── Styles for HTML elements ─────────────────────────────────────────────────
const S = {
  wrap: { fontFamily: "Georgia, serif" },
  score: { display: "flex", gap: 24, justifyContent: "center", alignItems: "center", marginBottom: 8 },
  scoreItem: { textAlign: "center" },
  scoreName: { color: "#a07840", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  scoreVal: { color: "#e8b86d", fontSize: 22, fontWeight: "bold" },
  turn: { color: "#7ddb7d", fontSize: 12, textAlign: "center", marginBottom: 6 },
  diceRow: { display: "flex", gap: 8, justifyContent: "center", marginTop: 8, flexWrap: "wrap", alignItems: "center" },
  actions: { display: "flex", gap: 10, justifyContent: "center", marginTop: 10, flexWrap: "wrap" },
  btnRoll: {
    background: "#6b3a10", color: "#e8b86d", border: "1px solid #a06030",
    borderRadius: 8, padding: "9px 22px", fontSize: 14, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  btnPass: {
    background: "#3a1a00", color: "#a07840", border: "1px solid #5a3010",
    borderRadius: 8, padding: "9px 22px", fontSize: 14, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  btnResign: {
    background: "#2a1400", color: "#6b3a10", border: "1px solid #3a1a00",
    borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  waiting: { color: "#6b3a10", fontSize: 13, textAlign: "center", marginTop: 8 },
};

// ── Main Board Component ─────────────────────────────────────────────────────
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

  const isMyTurn = gs.turn === myColor;
  const canRoll = isMyTurn && gs.phase === "rolling";
  const canMove = isMyTurn && gs.phase === "moving";
  const noMoves = canMove && gs.legalMoves.length === 0;

  const legalFroms = canMove ? new Set(gs.legalMoves.map(m => m.from)) : new Set();
  const legalDests = selected !== null
    ? new Set(gs.legalMoves.filter(m => m.from === selected).map(m => m.to))
    : new Set();

  // Any move that goes to "off"
  const canBearOff = canMove && gs.legalMoves.some(m => m.to === "off");

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
    if (selected === "bar") {
      // If bar is selected and a legal dest was clicked, that's handled by handleSelect
      setSelected(null);
      return;
    }
    setSelected(legalFroms.has("bar") ? "bar" : null);
  }

  function handleOffClick() {
    if (!canMove || selected === null || !legalDests.has("off")) return;
    const move = gs.legalMoves.find(m => m.from === selected && m.to === "off");
    if (move) { onMove(move.from, move.to, move.die); setSelected(null); }
  }

  // ── Build SVG elements ───────────────────────────────────────────────────
  const elems = [];

  // Triangular points (base layer)
  for (let idx = 0; idx < 24; idx++) {
    const col = colOf(idx);
    const dark = isTop(idx) ? (col % 2 === 0) : (col % 2 === 1);
    elems.push(
      <polygon key={`tri${idx}`} points={triPoints(idx)} fill={dark ? TD : TL} opacity="0.88" />
    );
  }

  // Highlight overlays
  for (let idx = 0; idx < 24; idx++) {
    const isLegal = legalDests.has(idx);
    const isSel = selected === idx;
    const isHint = legalFroms.has(idx) && !isSel && canMove;

    if (isLegal || isSel || isHint) {
      elems.push(
        <polygon key={`ov${idx}`} points={triPoints(idx)}
          fill={isLegal ? LEGAL : isSel ? SEL : HINT}
          stroke={isSel ? "rgba(255,255,255,0.7)" : isLegal ? "rgba(80,255,140,0.8)" : "none"}
          strokeWidth="1.5" style={{ pointerEvents: "none" }} />
      );
    }
  }

  // Point number labels
  for (let idx = 0; idx < 24; idx++) {
    const cx = ptCX(idx);
    const y = isTop(idx) ? MARGIN - 4 : MARGIN + BOARD_H + 12;
    elems.push(
      <text key={`lbl${idx}`} x={cx} y={y} textAnchor="middle" fontSize="8"
        fill="#7a5a30" style={{ pointerEvents: "none", userSelect: "none" }}>
        {idx + 1}
      </text>
    );
  }

  // Checkers on points
  for (let idx = 0; idx < 24; idx++) {
    const raw = gs.board[idx];
    if (raw === 0) continue;
    const color = raw > 0 ? "white" : "black";
    const n = Math.abs(raw);
    for (let i = 0; i < n; i++) {
      const cx = ptCX(idx);
      const cy = checkerY(idx, i, n);
      elems.push(
        <CheckerCircle key={`ck${idx}_${i}`} cx={cx} cy={cy} color={color}
          showCount={n > 5 && i === n - 1} count={n} />
      );
    }
  }

  // Click areas for points (transparent polygons on top)
  for (let idx = 0; idx < 24; idx++) {
    elems.push(
      <polygon key={`ca${idx}`} points={triPoints(idx)} fill="transparent"
        style={{ cursor: canMove ? "pointer" : "default" }}
        onClick={() => handleSelect(idx)} />
    );
  }

  // Bar checkers and click areas
  ["white", "black"].forEach(c => {
    const n = gs.bar[c];
    const onTop = c === "white";
    const bySec = onTop ? MARGIN + 2 : MARGIN + BOARD_H / 2 + 8;
    const bhSec = BOARD_H / 2 - 10;
    const isBarSel = selected === "bar" && myColor === c;
    const canSel = canMove && c === myColor && legalFroms.has("bar");

    // Bar highlight
    if (isBarSel) {
      elems.push(
        <rect key={`bsel${c}`} x={MARGIN + HALF_W} y={bySec} width={BAR_W} height={bhSec}
          rx={4} fill={SEL} stroke="rgba(255,255,255,0.7)" strokeWidth="1.5"
          style={{ pointerEvents: "none" }} />
      );
    } else if (canSel) {
      elems.push(
        <rect key={`bsh${c}`} x={MARGIN + HALF_W} y={bySec} width={BAR_W} height={bhSec}
          rx={4} fill={HINT} stroke="rgba(255,255,255,0.3)" strokeWidth="1"
          style={{ pointerEvents: "none" }} />
      );
    }

    // Bar checkers
    if (n > 0) {
      for (let i = 0; i < Math.min(n, 4); i++) {
        const bcy = onTop
          ? MARGIN + CR + 6 + i * CR * 2.2
          : MARGIN + BOARD_H - CR - 6 - i * CR * 2.2;
        elems.push(
          <CheckerCircle key={`bck${c}${i}`}
            cx={MARGIN + HALF_W + BAR_W / 2} cy={bcy} color={c}
            showCount={false} count={0} />
        );
      }
      if (n > 4) {
        elems.push(
          <text key={`bcnt${c}`} x={MARGIN + HALF_W + BAR_W / 2}
            y={onTop ? MARGIN + BOARD_H / 2 - 14 : MARGIN + BOARD_H / 2 + 18}
            textAnchor="middle" fontSize="12"
            fill={c === "white" ? WHITE_FILL : BLACK_FILL}
            fontWeight="bold" style={{ pointerEvents: "none" }}>
            {n}
          </text>
        );
      }
    }

    // Bar click area
    elems.push(
      <rect key={`bca${c}`} x={MARGIN + HALF_W} y={bySec} width={BAR_W} height={bhSec}
        fill="transparent" style={{ cursor: canSel ? "pointer" : "default" }}
        onClick={() => c === myColor && handleBarClick()} />
    );
  });

  // ── Dice rendering ─────────────────────────────────────────────────────
  const diceAll = gs.rolledDice.length > 0
    ? gs.rolledDice.map((d, i) => {
      const stillAvail = gs.dice.filter(x => x === d).length;
      const countBefore = gs.rolledDice.slice(0, i).filter(x => x === d).length;
      const used = countBefore >= stillAvail;
      return <SvgDie key={i} value={d} color={gs.turn} used={used} />;
    })
    : null;

  const neededToWin = Math.ceil(matchLength / 2);
  const turnLabel = isMyTurn
    ? (canRoll ? "Your turn \u2014 roll the dice" : "Your turn \u2014 move a checker")
    : `${playerInfo?.[gs.turn]?.display_name ?? gs.turn}'s turn`;

  return (
    <div style={S.wrap}>
      {/* Score */}
      <div style={S.score}>
        <div style={S.scoreItem}>
          <div style={S.scoreName}>{playerInfo?.white?.display_name ?? "White"}</div>
          <div style={S.scoreVal}>{score.white}</div>
        </div>
        <div style={{ color: "#4a2800", fontSize: 13 }}>of {neededToWin} needed</div>
        <div style={S.scoreItem}>
          <div style={S.scoreVal}>{score.black}</div>
          <div style={S.scoreName}>{playerInfo?.black?.display_name ?? "Black"}</div>
        </div>
      </div>

      <div style={S.turn}>{turnLabel}</div>

      {/* SVG Board */}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: "100%", display: "block", borderRadius: 10,
          boxShadow: "0 8px 40px #00000099" }}>
        {/* Frame & background */}
        <rect x={0} y={0} width={W} height={H} rx={12} fill={FRAME} />
        <rect x={8} y={8} width={W - 16} height={H - 16} rx={8} fill={INNER} />
        <rect x={MARGIN} y={MARGIN} width={BOARD_W} height={BOARD_H} fill={BG} />

        {/* Wood grain lines */}
        {[0.15, 0.35, 0.55, 0.75, 0.9].map((t, i) => (
          <line key={i} x1={MARGIN} y1={MARGIN + BOARD_H * t} x2={MARGIN + BOARD_W}
            y2={MARGIN + BOARD_H * t} stroke="#b07830" strokeWidth="0.5" opacity="0.25" />
        ))}

        {/* Center divider */}
        <rect x={MARGIN} y={MARGIN + BOARD_H / 2 - 4} width={BOARD_W} height={8}
          fill={BAR_S} opacity="0.5" />

        {/* Bar column (top half) */}
        <rect x={MARGIN + HALF_W} y={MARGIN + 2} width={BAR_W}
          height={BOARD_H / 2 - 10} rx={4} fill={BAR_C} />
        <rect x={MARGIN + HALF_W + 3} y={MARGIN + 4} width={BAR_W - 6}
          height={BOARD_H / 2 - 14} rx={3} fill={INNER} opacity="0.6" />

        {/* Bar column (bottom half) */}
        <rect x={MARGIN + HALF_W} y={MARGIN + BOARD_H / 2 + 8} width={BAR_W}
          height={BOARD_H / 2 - 10} rx={4} fill={BAR_C} />
        <rect x={MARGIN + HALF_W + 3} y={MARGIN + BOARD_H / 2 + 10} width={BAR_W - 6}
          height={BOARD_H / 2 - 14} rx={3} fill={INNER} opacity="0.6" />

        {/* All dynamic elements (triangles, checkers, highlights, click areas) */}
        {elems}

        {/* Off trays */}
        <OffTray color="white" n={gs.off.white || 0}
          glowing={canBearOff && selected !== null && legalDests.has("off") && myColor === "white"}
          onClick={handleOffClick} />
        <OffTray color="black" n={gs.off.black || 0}
          glowing={canBearOff && selected !== null && legalDests.has("off") && myColor === "black"}
          onClick={handleOffClick} />

        {/* Board border */}
        <rect x={MARGIN} y={MARGIN} width={BOARD_W} height={BOARD_H}
          fill="none" stroke={FRAME} strokeWidth="2.5" />
      </svg>

      {/* Dice */}
      {diceAll && <div style={S.diceRow}>{diceAll}</div>}

      {/* Actions */}
      <div style={S.actions}>
        {canRoll && (
          <button style={S.btnRoll} onClick={onRoll}>Roll</button>
        )}
        {noMoves && (
          <button style={S.btnPass} onClick={onPass}>Pass (no moves)</button>
        )}
        <button style={S.btnResign}
          onClick={() => { if (window.confirm("Resign this game?")) onResign(); }}>
          Resign
        </button>
      </div>

      {!isMyTurn && (
        <div style={S.waiting}>Waiting for opponent\u2026</div>
      )}
    </div>
  );
}
