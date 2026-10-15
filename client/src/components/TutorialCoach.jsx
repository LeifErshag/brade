import { useEffect, useReducer, useRef } from "react";
import { OFFICIAL_RULES_URL } from "./RulesContent.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

// ── Tutorial coach ───────────────────────────────────────────────────────────
// Shown above the board in a tutorial game (room.isTutorial). It watches the
// room state and, the first time a situation comes up, queues a short
// explanation of the rule behind it, linked to the matching section of the
// in-game rules drawer. The learner is always white (the server seats them
// there), so point numbers below are white's: home = point 1, huk = point 12,
// fourth quarter = points 19–24.
//
// Rule text follows "Spelregler för bräde" (Vasamuseets Brädspelsvänner, 2003).
// All text lives in the i18n dictionaries under coach.*; this file keeps only
// structure (section links, list placement) so a language switch re-renders
// the current explanation in place without resetting the coach.

// ── Topics (core rules) ──────────────────────────────────────────────────────
// Order = checklist order and the order simultaneous triggers are queued in.
// Text: coach.topic.<name>.title / .text (paragraphs) / .list (bullets,
// rendered after paragraph `listAt`).
const TOPICS = {
  setup:         { section: "rules-setup" },
  direction:     { section: "rules-movement" },
  dice:          { section: "rules-movement" },
  doubles:       { section: "rules-dice" },
  fata:          { section: "rules-dice" },
  bandPlacement: { section: "rules-band-placement" },
  hitting:       { section: "rules-hitting" },
  reentry:       { section: "rules-reentry" },
  blocking:      { section: "rules-blocking" },
  bursting:      { section: "rules-bursting", listAt: 1 },
  jan:           { section: "rules-jan" },
  vackertSpel:   { section: "rules-vackert-spel", listAt: 1 },
  bearOff:       { section: "rules-bearing-off" },
  munk:          { section: "rules-munk" },
  winning:       { section: "rules-winning" },
};
const TOPIC_ORDER = Object.keys(TOPICS);

// Points per win type, for the end-of-game result line.
const WIN_POINTS = {
  hemspel: 1, hemspel_munk: 2,
  kronspel_enkelt: 2, kronspel_enkelt_munk: 3,
  kronspel_dubbelt: 2, kronspel_dubbelt_munk: 3,
  trappspel: 2, trappspel_munk: 3,
  uppspel: 2, uppspel_munk: 3,
  jan: 4, sprangjan: 6,
};

// ── Board helpers (path space, same convention as the server engine) ─────────
const pathOf = (color, idx) => (color === "white" ? idx : (idx - 12 + 24) % 24);
const idxOf  = (color, pos) => (color === "white" ? pos : (pos + 12) % 24);
const opp    = (color) => (color === "white" ? "black" : "white");

// >0 own checkers, <0 opponent checkers, 0 empty — at path pos `pos`.
function ownAt(gs, color, pos) {
  const v = gs.board[idxOf(color, pos)];
  return color === "white" ? v : -v;
}

function countInQ4(gs, color) {
  let n = 0;
  for (let pos = 18; pos <= 23; pos++) n += Math.max(0, ownAt(gs, color, pos));
  return n;
}

function allInQ4(gs, color) {
  return gs.bar[color] === 0 && countInQ4(gs, color) + gs.off[color] === 15;
}

// ── Event detection ──────────────────────────────────────────────────────────
// Returns the topics the current state calls for. Already-seen topics are
// filtered out by the reducer, so this can simply report everything relevant.
function detectTopics(room, me, prev, noMovesColor) {
  const gs = room.gameState;
  if (!gs || room.status !== "playing") return [];

  const them   = opp(me);
  const topics = new Set(["setup", "direction"]);
  const myMove = gs.turn === me && gs.phase === "moving";

  if (myMove && gs.rolledDice.length === 2) topics.add("dice");
  if (myMove && gs.rolledDice.length === 4) topics.add("doubles");
  if (noMovesColor === me) topics.add("fata");

  // A checker of mine on points 2–11, where bands aren't allowed.
  for (let pos = 1; pos <= 10; pos++) if (ownAt(gs, me, pos) > 0) topics.add("bandPlacement");

  if (prev) {
    if (gs.bar[them] > prev.bar[them]) topics.add("hitting");
    if (gs.bar[me]   > prev.bar[me])   { topics.add("hitting"); topics.add("reentry"); }
  }
  if (myMove && gs.bar[me] > 0) topics.add("reentry");

  // An opponent band anywhere but its starting stack.
  for (let pos = 1; pos <= 23; pos++) {
    if (ownAt(gs, them, pos) >= 2) { topics.add("blocking"); break; }
  }

  // A legal move that lands on an opponent band is a burst.
  if (myMove && gs.legalMoves.some(m => m.to !== "off" && ownAt(gs, me, pathOf(me, m.to)) <= -2)) {
    topics.add("bursting");
  }

  if (gs.bar[me] >= 2 || gs.bar[them] >= 2) topics.add("jan");
  if (gs.off[me] === 0 && countInQ4(gs, me) >= 8) topics.add("vackertSpel");
  if (allInQ4(gs, me)) topics.add("bearOff");
  if (gs.off[me] > 0 && gs.bar[them] > 0) topics.add("munk");

  return TOPIC_ORDER.filter(t => topics.has(t));
}

// ── Why was that move not allowed? ───────────────────────────────────────────
// Text: coach.illegal.<id>.title / .text.
const ILLEGAL = {
  barFirst:     { section: "rules-reentry",        topic: "reentry" },
  blocked:      { section: "rules-blocking",       topic: "blocking" },
  band:         { section: "rules-band-placement", topic: "bandPlacement" },
  bearOffEarly: { section: "rules-bearing-off",    topic: "bearOff" },
  bearOffRear:  { section: "rules-bearing-off",    topic: "bearOff" },
  backwards:    { section: "rules-movement",       topic: "direction" },
  notADie:      { section: "rules-movement",       topic: "dice" },
  reentryOwn:   { section: "rules-reentry",        topic: "reentry" },
  dice:         { section: "rules-dice",           topic: "fata" },
};
for (const [id, info] of Object.entries(ILLEGAL)) info.id = id;

function landingReason(gs, color, dest) {
  if (dest > 23) return allInQ4(gs, color) ? "bearOffRear" : "bearOffEarly";
  const here = ownAt(gs, color, dest);
  if (here <= -2) return "blocked";
  if (dest >= 1 && dest <= 10 && here >= 1) return "band";
  return null;
}

export function explainIllegal(gs, color, from, to) {
  if (from !== "bar" && gs.bar[color] > 0) return ILLEGAL.barFirst;
  const dice = [...new Set(gs.dice)];

  if (to === null) {
    // Clicked a checker that has no legal move.
    const fromPos = pathOf(color, from);
    for (const d of dice) {
      const r = landingReason(gs, color, fromPos + d);
      if (r) return ILLEGAL[r];
    }
    return ILLEGAL.dice;
  }

  const fromPos = from === "bar" ? -1 : pathOf(color, from);
  const toPos   = pathOf(color, to);
  if (toPos <= fromPos) return ILLEGAL.backwards;
  if (!dice.includes(toPos - fromPos)) return ILLEGAL.notADie;
  if (from === "bar") {
    const here = ownAt(gs, color, toPos);
    if (here > 0)   return ILLEGAL.reentryOwn;
    if (here <= -2) return ILLEGAL.blocked;
    return ILLEGAL.dice;
  }
  return ILLEGAL[landingReason(gs, color, toPos) ?? "dice"];
}

// ── State ────────────────────────────────────────────────────────────────────
// history: every explanation shown so far (and those queued after `pos`).
// pos:     index being viewed, or null when the panel is collapsed.
const initialState = { history: [], pos: null, seen: [], skipped: false, ended: false };

function reducer(state, action) {
  const { history, pos } = state;
  switch (action.type) {
    case "finish": {
      // The end-of-game card (result + scoring + official rules link). Shown
      // once, jumped to directly, even if "winning" was read earlier.
      if (state.ended || state.skipped) return state;
      return {
        ...state,
        ended:   true,
        history: [...history, { topic: "winning", end: true }],
        pos:     history.length,
        seen:    state.seen.includes("winning") ? state.seen : [...state.seen, "winning"],
      };
    }
    case "trigger": {
      if (state.skipped) return state;
      const fresh = action.topics.filter(t => !state.seen.includes(t));
      if (fresh.length === 0) return state;
      return {
        ...state,
        history: [...history, ...fresh.map(topic => ({ topic }))],
        pos:     pos ?? history.length,
        seen:    [...state.seen, ...fresh],
      };
    }
    case "show": {
      const { entry } = action;
      const current = pos !== null ? history[pos] : null;
      const same = current && current.topic === entry.topic && current.illegal === entry.illegal;
      if (same) return state;
      // Insert right after the entry being viewed, so explanations queued
      // after `pos` (already marked seen) stay reachable with "Next".
      const at = pos !== null && pos < history.length - 1 ? pos + 1 : history.length;
      return {
        ...state,
        history: [...history.slice(0, at), entry, ...history.slice(at)],
        pos:     at,
        // Illegal-move notes are short and situational: they must not count as
        // having explained the topic, or they'd suppress the full explanation.
        seen:    !entry.illegal && entry.topic && !state.seen.includes(entry.topic)
          ? [...state.seen, entry.topic] : state.seen,
      };
    }
    case "next":   return { ...state, pos: pos !== null && pos < history.length - 1 ? pos + 1 : null };
    case "prev":   return { ...state, pos: pos === null ? history.length - 1 : Math.max(0, pos - 1) };
    case "close":  return { ...state, pos: null };
    case "reopen": return { ...state, pos: history.length ? history.length - 1 : null };
    case "skip":   return { ...state, skipped: true, pos: null };
    case "resume": {
      const resumed = { ...state, skipped: false };
      // Re-enabled after the game ended: show the end card it missed.
      return action.finished ? reducer(resumed, { type: "finish" }) : resumed;
    }
    default:       return state;
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────
const S = {
  panel: {
    background: "#2a1400", border: "1px solid #6b3a10", borderRadius: 10,
    padding: "14px 18px", marginBottom: 16, color: "#e8d5b0", fontSize: 14, lineHeight: 1.55,
  },
  bar: {
    display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
    marginBottom: 12, color: "#a07840", fontSize: 12,
  },
  kicker: { color: "#a07840", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  title:  { color: "#e8b86d", fontSize: 18, margin: "0 0 8px", fontWeight: "normal" },
  p:      { marginTop: 0, marginRight: 0, marginBottom: 8, marginLeft: 0 },
  ul:     { margin: "0 0 8px", paddingLeft: 20 },
  row:    { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 },
  spacer: { flex: 1 },
  btn: {
    background: "#3a1a00", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 6,
    padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  btnPrimary: {
    background: "#6b3a10", color: "#e8b86d", border: "1px solid #a06030", borderRadius: 6,
    padding: "5px 14px", fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  btnDis: { opacity: 0.4, cursor: "default" },
  btnLink: {
    background: "none", border: "none", padding: 0, color: "#e8b86d", textDecoration: "underline",
    cursor: "pointer", fontSize: 13, fontFamily: "Georgia, serif",
  },
  checklist: { listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 6 },
  check: {
    background: "#3a1a00", color: "#a07840",
    borderWidth: 1, borderStyle: "solid", borderColor: "#4a2800", borderRadius: 6,
    padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  checkDone: { color: "#7ddb7d", borderColor: "#1a5c1a" },
  official:  { color: "#e8b86d" },
  muted:     { color: "#a07840", fontSize: 12 },
};

function Paragraphs({ text, list, listAt }) {
  const items = list ? [...text.slice(0, listAt), list, ...text.slice(listAt)] : text;
  return items.map((item, i) => Array.isArray(item)
    ? <ul key={i} style={S.ul}>{item.map(li => <li key={li}>{li}</li>)}</ul>
    : <p key={i} style={S.p}>{item}</p>);
}

function resultLine(room, me, t, winType) {
  const r = room.matchResult;
  if (!r) return null;
  if (r.winType === "resign") {
    return r.winner === me ? t("coach.resultAiResigned") : t("coach.resultYouResigned");
  }
  const params = { label: winType(r.winType), pts: WIN_POINTS[r.winType] ?? r.score?.[r.winner] };
  return r.winner === me ? t("coach.resultYouWon", params) : t("coach.resultAiWon", params);
}

// ── Component ────────────────────────────────────────────────────────────────
/**
 * Props:
 *   room           – current room state (room.isTutorial is true)
 *   myColor        – the learner's color
 *   noMovesColor   – color that just had no legal moves (from NO_MOVES), or null
 *   illegalAttempt – { from, to, n } from Board's onIllegalAttempt; `n` changes
 *                    on every attempt
 *   onOpenRules    – (sectionId) => void, opens the rules drawer at a section
 */
export default function TutorialCoach({ room, myColor, noMovesColor, illegalAttempt, onOpenRules }) {
  const { t, winType } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);
  const prevRef = useRef(null);
  const roomRef = useRef(room);
  roomRef.current = room;

  // Event-triggered explanations.
  useEffect(() => {
    if (!room || !myColor) return;
    if (room.status === "finished") { dispatch({ type: "finish" }); return; }
    const topics = detectTopics(room, myColor, prevRef.current, noMovesColor);
    if (room.gameState) prevRef.current = { bar: { ...room.gameState.bar } };
    if (topics.length) dispatch({ type: "trigger", topics });
  }, [room, myColor, noMovesColor]);

  // Explain a move the learner tried that isn't allowed.
  useEffect(() => {
    const gs = roomRef.current?.gameState;
    if (!illegalAttempt || !gs || state.skipped) return;
    const info = explainIllegal(gs, myColor, illegalAttempt.from, illegalAttempt.to);
    dispatch({ type: "show", entry: { illegal: info.id, topic: info.topic } });
  }, [illegalAttempt]); // only react to new attempts, not every room update

  const [showChecklist, toggleChecklist] = useReducer(v => !v, false);

  const { history, pos, seen, skipped } = state;
  const finished = room?.status === "finished";
  const unseen   = TOPIC_ORDER.filter(topic => !seen.includes(topic));
  const topicTitle   = (topic) => t(`coach.topic.${topic}.title`);
  const sectionLabel = (id) => t(`rules.section.${id}`);

  const checklist = showChecklist && (
    <div>
      <div style={S.muted}>
        {t("coach.checklistIntro", { seen: TOPIC_ORDER.length - unseen.length, total: TOPIC_ORDER.length })}
      </div>
      <ul style={S.checklist}>
        {TOPIC_ORDER.map(topic => {
          const done = seen.includes(topic);
          return (
            <li key={topic}>
              <button
                type="button"
                style={{ ...S.check, ...(done ? S.checkDone : null) }}
                onClick={() => dispatch({ type: "show", entry: { topic } })}
              >
                {done ? "✓" : "○"} {topicTitle(topic)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  if (skipped) {
    return (
      <div style={S.bar}>
        <span>{t("coach.off")}</span>
        <button type="button" style={S.btn} onClick={() => dispatch({ type: "resume", finished })}>{t("coach.resume")}</button>
      </div>
    );
  }

  if (pos === null) {
    return (
      <div style={S.panel}>
        <div style={S.bar}>
          <span>{t("coach.idle")}</span>
          <span style={S.spacer} />
          {history.length > 0 && (
            <button type="button" style={S.btn} onClick={() => dispatch({ type: "reopen" })}>{t("coach.showLatest")}</button>
          )}
          <button type="button" style={S.btn} onClick={toggleChecklist} aria-expanded={showChecklist}>
            {t("coach.checklist")}
          </button>
        </div>
        {checklist}
      </div>
    );
  }

  const entry   = history[pos];
  // Resolved at render time from ids, so a language switch re-translates it.
  const content = entry.illegal
    ? {
        section: ILLEGAL[entry.illegal].section,
        title:   t(`coach.illegal.${entry.illegal}.title`),
        text:    [t(`coach.illegal.${entry.illegal}.text`)],
      }
    : {
        section: TOPICS[entry.topic].section,
        title:   topicTitle(entry.topic),
        text:    t(`coach.topic.${entry.topic}.text`),
        list:    TOPICS[entry.topic].listAt != null ? t(`coach.topic.${entry.topic}.list`) : null,
        listAt:  TOPICS[entry.topic].listAt,
      };
  const isEnd   = entry.end === true;
  const queued  = history.length - 1 - pos;

  return (
    <section style={S.panel} aria-live="polite" aria-label={t("coach.label")}>
      <div style={S.kicker}>
        {entry.illegal ? t("coach.kickerIllegal") : isEnd ? t("coach.kickerEnd") : t("coach.kickerGuide")} · {pos + 1}/{history.length}
      </div>
      <h3 style={S.title}>{content.title}</h3>
      {isEnd && <p style={{ ...S.p, color: "#e8b86d" }}>{resultLine(room, myColor, t, winType)}</p>}
      <Paragraphs text={content.text} list={content.list} listAt={content.listAt} />
      <button type="button" style={S.btnLink} onClick={() => onOpenRules(content.section)}>
        {t("coach.readMore", { section: sectionLabel(content.section) })}
      </button>

      {isEnd && (
        <>
          {unseen.length > 0 && (
            <p style={{ ...S.p, marginTop: 10 }}>
              {t("coach.unseen")}{" "}
              {unseen.map((topic, i) => (
                <span key={topic}>
                  {i > 0 && ", "}
                  <button type="button" style={S.btnLink} onClick={() => dispatch({ type: "show", entry: { topic } })}>
                    {topicTitle(topic)}
                  </button>
                </span>
              ))}
            </p>
          )}
          <p style={{ ...S.p, marginTop: 10 }}>
            <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={S.official}>
              {t("coach.officialRules")}
            </a>
          </p>
        </>
      )}

      <div style={S.row}>
        <button
          type="button"
          style={{ ...S.btn, ...(pos === 0 ? S.btnDis : null) }}
          onClick={() => dispatch({ type: "prev" })}
          disabled={pos === 0}
        >
          {t("coach.prev")}
        </button>
        <button type="button" style={S.btnPrimary} onClick={() => dispatch({ type: "next" })}>
          {queued > 0 ? t("coach.next", { n: queued }) : t("coach.gotIt")}
        </button>
        <span style={S.spacer} />
        <button type="button" style={S.btn} onClick={toggleChecklist} aria-expanded={showChecklist}>
          {t("coach.checklist")}
        </button>
        {!finished && (
          <button type="button" style={S.btn} onClick={() => dispatch({ type: "skip" })}>
            {t("coach.skip")}
          </button>
        )}
      </div>
      {checklist}
    </section>
  );
}
