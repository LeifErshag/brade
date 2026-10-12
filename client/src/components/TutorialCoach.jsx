import { useEffect, useReducer, useRef } from "react";
import { RULES_SECTIONS, OFFICIAL_RULES_URL } from "./RulesContent.jsx";

// ── Tutorial coach ───────────────────────────────────────────────────────────
// Shown above the board in a tutorial game (room.isTutorial). It watches the
// room state and, the first time a situation comes up, queues a short Swedish
// explanation of the rule behind it, linked to the matching section of the
// in-game rules drawer. The learner is always white (the server seats them
// there), so point numbers below are white's: home = point 1, huk = point 12,
// fourth quarter = points 19–24.
//
// Rule text follows "Spelregler för bräde" (Vasamuseets Brädspelsvänner, 2003).

// ── Topics (core rules) ──────────────────────────────────────────────────────
// Order = checklist order and the order simultaneous triggers are queued in.
// `text` items are paragraphs; an array item is rendered as a bullet list.
const TOPICS = {
  setup: {
    title: "Uppställning",
    section: "rules-setup",
    text: [
      "Välkommen till bräde! Du spelar med de ljusa brickorna och datorn med de mörka. Alla dina femton brickor står från början på tunga 1 – det är ditt hem. Datorns hem är tunga 13.",
      "Partiet är en kapplöpning: du ska föra alla brickor ett varv runt brädet och spela ut dem. Du kan också vinna genom att ställa upp brickorna i ett vackert mönster, eller genom att slå så många av motspelarens brickor att han inte kan spela in dem igen.",
      "I en riktig match tekar man först – båda slår en tärning och den som slår lägst börjar. I det här övningspartiet börjar du.",
    ],
  },
  direction: {
    title: "Färdriktning och kvarter",
    section: "rules-movement",
    text: [
      "Båda spelarna flyttar åt samma håll längs samma bana. Dina brickor går från tunga 1 (nere till höger) åt vänster till tunga 12, och sedan åt höger längs överkanten till tunga 24. Därefter spelas de ut.",
      "(Reglerna säger att brickorna går motsols. Det gäller på ett riktigt bräde, där ditt hem ligger på bortre sidan. Här på skärmen ligger ditt hem närmast dig, så samma väg ser ut som medsols.)",
      "Banan delas i fyra kvarter: tunga 1–6 är ditt första kvarter, 7–12 det andra, 13–18 det tredje och 19–24 det fjärde. Tunga 12 kallas din huk.",
    ],
  },
  dice: {
    title: "Två tärningar",
    section: "rules-movement",
    text: [
      "Klicka på en bricka och sedan på en grön tunga för att flytta. Varje tärning är ett eget flytt: brickan går exakt så många tungor framåt som tärningen visar.",
      "Du kan flytta två olika brickor, en för varje tärning, eller samma bricka för båda – att ta fullt med en. Då flyttar du den en tärning i taget: den mellanlandar på vägen, och mellanlandningen måste också vara ett tillåtet drag.",
    ],
  },
  doubles: {
    title: "Allor",
    section: "rules-dice",
    text: [
      "Båda tärningarna visar samma tal – en alla. Då räknas varje tärning två gånger: du flyttar fyra gånger för tärningens ögon, och kan välja att flytta en, två, tre eller fyra brickor.",
    ],
  },
  fata: {
    title: "Använd så mycket av slaget som möjligt",
    section: "rules-dice",
    text: [
      "Man måste flytta för båda tärningarna om det går, och använda så många av tärningarnas ögon som möjligt. Kan man flytta för vilken som helst av tärningarna men inte för båda, måste man ta den högre.",
      "Att ge upp en tärning kallas att fåta. Kan man inte flytta alls fåtar man hela slaget och står över till nästa kast.",
    ],
  },
  bandPlacement: {
    title: "Blottor, band och huken",
    section: "rules-band-placement",
    text: [
      "En ensam bricka på en tunga är en blotta; två eller fler bildar ett band. Ett band kan inte slås, men en blotta kan det.",
      "I ditt första och andra kvarter (tunga 2–11) får du inte lägga band – bara på din huk, tunga 12. Därför blir det många blottor i början av partiet. I tredje och fjärde kvarteret (tunga 13–24) får du lägga band var du vill.",
    ],
  },
  hitting: {
    title: "Slå en blotta",
    section: "rules-hitting",
    text: [
      "En blotta slås när en motståndarbricka landar eller mellanlandar på den. Den slagna brickan läggs på ribban i mitten av brädet.",
      "Den som har brickor på ribban får inte flytta någon annan bricka förrän de slagna brickorna har spelats in igen.",
    ],
  },
  reentry: {
    title: "Inspel från ribban",
    section: "rules-reentry",
    text: [
      "Slagna brickor spelas in i ditt första kvarter: en etta spelar in på tunga 1, en tvåa på tunga 2 och så vidare upp till en sexa på tunga 6. (En bricka som tas hemifrån för en trea hamnar däremot på tunga 4 – den inspelade brickan startar utanför brädet.)",
      "Du får bara spela in på tomma tungor eller på en blotta av motspelaren, som då blir slagen – inte på egna brickor och inte på motspelarens band. Träffar du ingen tillgänglig tunga måste du fåta.",
    ],
  },
  blocking: {
    title: "Spärrade tungor",
    section: "rules-blocking",
    text: [
      "Datorn har lagt ett band. Du får passera förbi motspelarens band, men du får varken landa eller mellanlanda på en tunga där han har ett band.",
      "Ett block med fem band i rad kan bara passeras med en sexa från tungan precis bakom. Ett helt ogenomträngligt hinder får sprängas (se Sprängning i checklistan).",
    ],
  },
  bursting: {
    title: "Sprängning",
    section: "rules-bursting",
    text: [
      "Om det är omöjligt att ta sig förbi motspelarens band får man spränga ett av dem genom att landa, mellanlanda eller spela in på det. Alla brickor i bandet räknas då som slagna.",
      [
        "när motspelaren har mer än fem band i rad i din färdväg – du får då spränga vilket som helst av dem, men du måste inte om du kan flytta på annat sätt, eller",
        "när du har fler slagna brickor än det finns tillgängliga tungor (tomma eller med motspelarens blotta) i ditt första kvarter.",
      ],
      "Undantag: har en spelare spelat hem fjorton brickor och bara en kvar får inga band sprängas. Kan den sista brickan inte flytta står han över – han är junker.",
    ],
  },
  jan: {
    title: "Jan",
    section: "rules-jan",
    text: [
      "Har en spelare fler brickor på ribban än det finns tungor att spela in på i hans första kvarter – tomma tungor eller tungor med motspelarens blottor eller band – har han blivit jan och förlorar partiet direkt. Jan ger 4 poäng.",
      "Gör man motspelaren jan genom att spränga ett av hans band i sitt första kvarter kallas det sprängjan. Det ger 6 poäng och är det finaste sättet att vinna.",
    ],
  },
  vackertSpel: {
    title: "Vackert spel",
    section: "rules-vackert-spel",
    text: [
      "Så länge du inte har spelat hem någon bricka kan du vinna på vackert spel genom att ställa upp alla femton brickor i ett av fyra mönster i fjärde kvarteret:",
      [
        "Enkelt kronspel: tre brickor på var och en av tungorna 20–24.",
        "Dubbelt kronspel: fem brickor på var och en av tungorna 22–24.",
        "Trappspel: sju brickor på 24, fem på 23 och tre på 22.",
        "Uppspel: alla femton brickor på tunga 24.",
      ],
      "Vackert spel ger 2 poäng. Så fort du har spelat hem en bricka är chansen borta.",
    ],
  },
  bearOff: {
    title: "Hemspel – spela ut brickorna",
    section: "rules-bearing-off",
    text: [
      "När alla dina brickor är i fjärde kvarteret (tunga 19–24) får du börja spela hem dem till en tänkt tunga 25 utanför brädet. Klicka på brickan och sedan på facket till höger.",
      "Enligt Vasamuseets regel får du bara spela hem den bricka som ligger sist (eller på delad sista plats). Visar tärningen exakt rätt går brickan jämnt hem; visar den mer får den sista brickan ändå spelas hem – slaget reduceras. Den sammanlagda reduktionen ska hållas så liten som möjligt.",
      "Blir en bricka slagen under hemspelet får inga fler spelas hem förrän den är tillbaka i fjärde kvarteret.",
    ],
  },
  munk: {
    title: "Munk",
    section: "rules-munk",
    text: [
      "Avslutar man ett hemspel eller ett vackert spel medan motspelaren har en eller flera brickor på ribban vinner man med munk, och vinsten värderas högre: hemspel med munk ger 2 poäng i stället för 1, vackert spel med munk 3 i stället för 2.",
    ],
  },
  winning: {
    title: "Vinst och poäng",
    section: "rules-winning",
    text: [
      "Ett parti kan vinnas på tre sätt: hemspel (alla brickor utspelade, 1 poäng), vackert spel (2 poäng) eller jan (4 poäng, sprängjan 6). Hemspel och vackert spel med munk ger en poäng extra.",
      "Partiet är slut så fort någon har vunnit – man får inte fortsätta flytta, även om en tärning återstår.",
      "En match spelas i ett udda antal partier, vanligen tre, fem eller sju. Flest poäng vinner; vid lika poäng vinner den som har det högst värderade spelet.",
    ],
  },
};
const TOPIC_ORDER = Object.keys(TOPICS);

// Sub-section anchors that aren't top-level entries in RULES_SECTIONS.
const SECTION_LABELS = {
  "rules-reentry":        "Inspel",
  "rules-band-placement": "Var band får läggas",
  "rules-bursting":       "Sprängning",
  "rules-jan":            "Jan",
  "rules-vackert-spel":   "Vackert spel",
  "rules-munk":           "Munk",
};
function sectionLabel(id) {
  return SECTION_LABELS[id] ?? RULES_SECTIONS.find(s => s.id === id)?.title ?? "Spelregler";
}

const WIN_LABELS = {
  hemspel:               ["hemspel", 1],
  hemspel_munk:          ["hemspel med munk", 2],
  kronspel_enkelt:       ["enkelt kronspel", 2],
  kronspel_enkelt_munk:  ["enkelt kronspel med munk", 3],
  kronspel_dubbelt:      ["dubbelt kronspel", 2],
  kronspel_dubbelt_munk: ["dubbelt kronspel med munk", 3],
  trappspel:             ["trappspel", 2],
  trappspel_munk:        ["trappspel med munk", 3],
  uppspel:               ["uppspel", 2],
  uppspel_munk:          ["uppspel med munk", 3],
  jan:                   ["jan", 4],
  sprangjan:             ["sprängjan", 6],
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
const ILLEGAL = {
  barFirst: {
    title: "Spela in först", section: "rules-reentry", topic: "reentry",
    text: ["Du har en bricka på ribban. Så länge du har slagna brickor får du inte flytta någon annan bricka – först måste de spelas in i ditt första kvarter (tunga 1–6)."],
  },
  blocked: {
    title: "Spärrad tunga", section: "rules-blocking", topic: "blocking",
    text: ["Motspelaren har ett band (två eller fler brickor) där. Du får passera band, men varken landa eller mellanlanda på dem."],
  },
  band: {
    title: "Inget band här", section: "rules-band-placement", topic: "bandPlacement",
    text: ["Du har redan en bricka på den tungan. På tunga 2–11 får du inte lägga band – bara på din huk, tunga 12, och i ditt tredje och fjärde kvarter."],
  },
  bearOffEarly: {
    title: "Inte dags att spela hem", section: "rules-bearing-off", topic: "bearOff",
    text: ["Brickorna får inte lämna fjärde kvarteret förrän hemspelet har börjat, och du får börja spela hem först när alla femton brickor är i fjärde kvarteret (tunga 19–24)."],
  },
  bearOffRear: {
    title: "Bara den sista brickan", section: "rules-bearing-off", topic: "bearOff",
    text: ["Enligt Vasamuseets regel får du bara spela hem den bricka som ligger sist (eller på delad sista plats) i fjärde kvarteret. Visar tärningen för lite för den måste du flytta fram en bricka i stället."],
  },
  backwards: {
    title: "Bara framåt", section: "rules-movement", topic: "direction",
    text: ["Brickorna flyttas bara framåt: från tunga 1 mot tunga 24."],
  },
  notADie: {
    title: "En tärning i taget", section: "rules-movement", topic: "dice",
    text: ["En bricka flyttas exakt så många tungor som en tärning visar. Vill du ta fullt med en bricka flyttar du den en tärning i taget – den mellanlandar, och mellanlandningen måste också vara tillåten."],
  },
  reentryOwn: {
    title: "Inte på egna brickor", section: "rules-reentry", topic: "reentry",
    text: ["Slagna brickor får bara spelas in på tomma tungor eller på en blotta av motspelaren – inte på egna brickor."],
  },
  dice: {
    title: "Tärningsreglerna", section: "rules-dice", topic: "fata",
    text: ["Det draget är inte tillåtet med det här slaget. Du måste använda så många av tärningarnas ögon som möjligt – ibland tvingar det fram ett visst drag – och kan du bara flytta för en tärning måste du ta den högre. De gröna markeringarna visar vad som går."],
  },
};

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
      // after `pos` (already marked seen) stay reachable with "Nästa".
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
  p:      { margin: "0 0 8px" },
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
    background: "#3a1a00", color: "#a07840", border: "1px solid #4a2800", borderRadius: 6,
    padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  checkDone: { color: "#7ddb7d", borderColor: "#1a5c1a" },
  official:  { color: "#e8b86d" },
  muted:     { color: "#a07840", fontSize: 12 },
};

function Paragraphs({ text }) {
  return text.map((item, i) => Array.isArray(item)
    ? <ul key={i} style={S.ul}>{item.map(li => <li key={li}>{li}</li>)}</ul>
    : <p key={i} style={S.p}>{item}</p>);
}

function resultLine(room, me) {
  const r = room.matchResult;
  if (!r) return null;
  if (r.winType === "resign") {
    return r.winner === me ? "Datorn gav upp partiet." : "Du gav upp övningspartiet.";
  }
  const [label, pts] = WIN_LABELS[r.winType] ?? [r.winType, r.score?.[r.winner]];
  const who = r.winner === me ? "Du vann" : "Datorn vann";
  return `${who} på ${label} – ${pts} poäng.`;
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
    dispatch({ type: "show", entry: { illegal: info, topic: info.topic } });
  }, [illegalAttempt]); // only react to new attempts, not every room update

  const [showChecklist, toggleChecklist] = useReducer(v => !v, false);

  const { history, pos, seen, skipped } = state;
  const finished = room?.status === "finished";
  const unseen   = TOPIC_ORDER.filter(t => !seen.includes(t));

  const checklist = showChecklist && (
    <div>
      <div style={S.muted}>Regler i guiden ({TOPIC_ORDER.length - unseen.length}/{TOPIC_ORDER.length} visade) – klicka för att läsa:</div>
      <ul style={S.checklist}>
        {TOPIC_ORDER.map(t => {
          const done = seen.includes(t);
          return (
            <li key={t}>
              <button
                type="button"
                style={{ ...S.check, ...(done ? S.checkDone : null) }}
                onClick={() => dispatch({ type: "show", entry: { topic: t } })}
              >
                {done ? "✓" : "○"} {TOPICS[t].title}
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
        <span>Guiden är avstängd.</span>
        <button type="button" style={S.btn} onClick={() => dispatch({ type: "resume", finished })}>Slå på guiden igen</button>
      </div>
    );
  }

  if (pos === null) {
    return (
      <div style={S.panel}>
        <div style={S.bar}>
          <span>Övningsparti – reglerna förklaras när de dyker upp.</span>
          <span style={S.spacer} />
          {history.length > 0 && (
            <button type="button" style={S.btn} onClick={() => dispatch({ type: "reopen" })}>Visa senaste förklaringen</button>
          )}
          <button type="button" style={S.btn} onClick={toggleChecklist} aria-expanded={showChecklist}>
            Regelchecklista
          </button>
        </div>
        {checklist}
      </div>
    );
  }

  const entry   = history[pos];
  const content = entry.illegal ?? TOPICS[entry.topic];
  const isEnd   = entry.end === true;
  const queued  = history.length - 1 - pos;

  return (
    <section style={S.panel} aria-live="polite" aria-label="Guide">
      <div style={S.kicker}>
        {entry.illegal ? "Inte tillåtet" : isEnd ? "Partiet är slut" : "Guide"} · {pos + 1}/{history.length}
      </div>
      <h3 style={S.title}>{content.title}</h3>
      {isEnd && <p style={{ ...S.p, color: "#e8b86d" }}>{resultLine(room, myColor)}</p>}
      <Paragraphs text={content.text} />
      <button type="button" style={S.btnLink} onClick={() => onOpenRules(content.section)}>
        Läs mer i reglerna: {sectionLabel(content.section)} →
      </button>

      {isEnd && (
        <>
          {unseen.length > 0 && (
            <p style={{ ...S.p, marginTop: 10 }}>
              Regler som inte dök upp i det här partiet:{" "}
              {unseen.map((t, i) => (
                <span key={t}>
                  {i > 0 && ", "}
                  <button type="button" style={S.btnLink} onClick={() => dispatch({ type: "show", entry: { topic: t } })}>
                    {TOPICS[t].title}
                  </button>
                </span>
              ))}
            </p>
          )}
          <p style={{ ...S.p, marginTop: 10 }}>
            <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={S.official}>
              Läs de fullständiga officiella reglerna ↗
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
          ← Föregående
        </button>
        <button type="button" style={S.btnPrimary} onClick={() => dispatch({ type: "next" })}>
          {queued > 0 ? `Nästa (${queued} till) →` : "Uppfattat"}
        </button>
        <span style={S.spacer} />
        <button type="button" style={S.btn} onClick={toggleChecklist} aria-expanded={showChecklist}>
          Regelchecklista
        </button>
        {!finished && (
          <button type="button" style={S.btn} onClick={() => dispatch({ type: "skip" })}>
            Hoppa över guiden
          </button>
        )}
      </div>
      {checklist}
    </section>
  );
}
