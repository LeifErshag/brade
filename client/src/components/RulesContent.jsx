// ── Spelregler för bräde ─────────────────────────────────────────────────────
// Rules text, following "Spelregler för bräde" as adopted by Vasamuseets
// Brädspelsvänner (årsmöte 26 februari 2003). The prose lives in the i18n
// dictionaries (rules.*) in Swedish and English; this file only lays it out.
//
// Every section (and a few sub-sections) carries a stable `id` so other views —
// e.g. the tutorial coach — can deep-link with `/rules#rules-bearing-off`
// or scroll the in-game drawer to a section. Keep these ids stable; their
// titles are the dictionary entries rules.section.<id>.
import { useI18n } from "../i18n/I18nContext.jsx";
import Rich from "../i18n/Rich.jsx";

export const OFFICIAL_RULES_URL =
  "https://www.vasamuseet.se/om-vasamuseet/vasamuseets-vanner/bradspelssektionen/spelregler";

export const RULES_SECTIONS = [
  { id: "rules-setup" },
  { id: "rules-movement" },
  { id: "rules-dice" },
  { id: "rules-hitting" },
  { id: "rules-blocking" },
  { id: "rules-bearing-off" },
  { id: "rules-winning" },
];

const S = {
  root:     { color: "#e8d5b0", fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1.6 },
  intro:    { color: "#a07840", fontSize: 13, fontStyle: "italic", margin: "0 0 6px" },
  official: { fontSize: 13, margin: "0 0 16px" },
  toc:      { listStyle: "none", padding: 0, margin: "0 0 8px", display: "flex", flexWrap: "wrap", gap: 6 },
  tocLink:  {
    display: "inline-block", background: "#2a1400", color: "#e8b86d", border: "1px solid #4a2800",
    borderRadius: 6, padding: "4px 10px", fontSize: 12, textDecoration: "none",
  },
  section:  { borderTop: "1px solid #4a2800", paddingTop: 16, marginTop: 20, scrollMarginTop: 16 },
  h2:       { color: "#e8b86d", fontSize: 19, margin: "0 0 10px", fontWeight: "normal" },
  h3:       { color: "#e8b86d", fontSize: 16, margin: "18px 0 6px", fontWeight: "normal", scrollMarginTop: 16 },
  p:        { margin: "0 0 10px" },
  ul:       { margin: "0 0 10px", paddingLeft: 20 },
  li:       { marginBottom: 4 },
  term:     { color: "#e8b86d", fontStyle: "italic" },
  note:     {
    background: "#2a1400", borderLeft: "3px solid #6b3a10", borderRadius: 4,
    padding: "8px 12px", margin: "0 0 10px", fontSize: 14,
  },
  table:    { borderCollapse: "collapse", width: "100%", maxWidth: 380, margin: "4px 0 12px", fontSize: 14 },
  th:       { textAlign: "left", color: "#a07840", borderBottom: "1px solid #6b3a10", padding: "4px 8px", fontWeight: "normal" },
  thNum:    { textAlign: "right", color: "#a07840", borderBottom: "1px solid #6b3a10", padding: "4px 8px", fontWeight: "normal" },
  td:       { padding: "3px 8px" },
  tdNum:    { padding: "3px 8px", textAlign: "right", color: "#e8b86d" },
  groupTop: { borderTop: "1px solid #4a2800" },
  credit:   { borderTop: "1px solid #4a2800", marginTop: 24, paddingTop: 14, color: "#a07840", fontSize: 13 },
  link:     { color: "#e8b86d" },
};

// Point table (§13), by win type. Rows in the same group rank equally in a
// match tie-break (§14).
const POINT_GROUPS = [
  [["sprangjan", 6]],
  [["jan", 4]],
  [
    ["kronspel_enkelt_munk", 3],
    ["kronspel_dubbelt_munk", 3],
    ["trappspel_munk", 3],
    ["uppspel_munk", 3],
  ],
  [
    ["kronspel_enkelt", 2],
    ["kronspel_dubbelt", 2],
    ["trappspel", 2],
    ["uppspel", 2],
  ],
  [["hemspel_munk", 2]],
  [["hemspel", 1]],
];

function T({ children }) {
  return <em style={S.term}>{children}</em>;
}

const TERM = { t: T };

/**
 * The full rules text, in the current UI language.
 *
 * Props:
 *   showToc     – render a row of section links at the top (default true)
 *   onNavigate  – optional (id) => void; when given, TOC clicks call it instead
 *                 of following the #hash (used by the in-game drawer so the
 *                 game URL isn't changed).
 */
export default function RulesContent({ showToc = true, onNavigate }) {
  const { t, winType } = useI18n();

  function handleTocClick(e, id) {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(id);
  }

  // Plain render helpers (not components), so re-renders never remount the text.
  const para = (text, style = S.p, slots) => (
    <p style={style}><Rich text={text} components={TERM} slots={slots} /></p>
  );
  const list = (items) => (
    <ul style={S.ul}>
      {items.map((item, i) => <li key={i} style={S.li}><Rich text={item} components={TERM} /></li>)}
    </ul>
  );
  const h2 = (id) => <h2 style={S.h2}>{t(`rules.section.${id}`)}</h2>;
  const h3 = (id) => <h3 id={id} style={S.h3}>{t(`rules.section.${id}`)}</h3>;

  const officialLink = (text) => (
    <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={S.link}>
      {text}
    </a>
  );

  return (
    <div style={S.root}>
      <p style={S.intro}>{t("rules.intro", { org: t("source.org") })}</p>
      <p style={S.official}>{officialLink(t("rules.officialLink"))}</p>

      {showToc && (
        <nav aria-label={t("rules.toc")}>
          <ul style={S.toc}>
            {RULES_SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} style={S.tocLink} onClick={e => handleTocClick(e, s.id)}>
                  {t(`rules.section.${s.id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ── 1. Uppställning ─────────────────────────────────────────────── */}
      <section id="rules-setup" style={S.section}>
        {h2("rules-setup")}
        {para(t("rules.setup.p1"))}
        {para(t("rules.setup.p2"))}
        {para(t("rules.setup.p3"))}
        {para(t("rules.setup.p4"))}
      </section>

      {/* ── 2. Förflyttning ─────────────────────────────────────────────── */}
      <section id="rules-movement" style={S.section}>
        {h2("rules-movement")}
        {para(t("rules.movement.p1"))}
        {para(t("rules.movement.p2"))}
        {para(t("rules.movement.p3"))}
      </section>

      {/* ── 3. Tärningar och allor ──────────────────────────────────────── */}
      <section id="rules-dice" style={S.section}>
        {h2("rules-dice")}
        {para(t("rules.dice.p1"))}
        {para(t("rules.dice.p2"))}
        {list(t("rules.dice.list"))}
      </section>

      {/* ── 4. Blottor, slag och inspel ─────────────────────────────────── */}
      <section id="rules-hitting" style={S.section}>
        {h2("rules-hitting")}
        {para(t("rules.hitting.p1"))}
        {para(t("rules.hitting.p2"), S.p, {
          link: (
            <a href="#rules-bursting" style={S.link} onClick={e => handleTocClick(e, "rules-bursting")}>
              {t("rules.hitting.burstLink")}
            </a>
          ),
        })}
        {para(t("rules.hitting.p3"))}
        {h3("rules-reentry")}
        {para(t("rules.hitting.p4"))}
        {para(t("rules.hitting.p5"))}
        {list(t("rules.hitting.list"))}
      </section>

      {/* ── 5–6. Band och sprängning ────────────────────────────────────── */}
      <section id="rules-blocking" style={S.section}>
        {h2("rules-blocking")}
        {h3("rules-band-placement")}
        {para(t("rules.blocking.p1"))}
        {para(t("rules.blocking.note"), S.note)}
        {para(t("rules.blocking.p2"))}

        {h3("rules-bursting")}
        {para(t("rules.blocking.burstP1"))}
        {list(t("rules.blocking.burstList"))}
        {para(t("rules.blocking.burstExample"), S.note)}
        {h3("rules-junker")}
        {para(t("rules.blocking.junker"))}
      </section>

      {/* ── 7. Hemspel ──────────────────────────────────────────────────── */}
      <section id="rules-bearing-off" style={S.section}>
        {h2("rules-bearing-off")}
        {para(t("rules.bearingOff.p1"))}
        {para(t("rules.bearingOff.p2"))}
        {para(t("rules.bearingOff.note"), S.note)}
        {list(t("rules.bearingOff.list"))}
        {para(t("rules.bearingOff.example"), S.note)}
      </section>

      {/* ── 8–14. Vinst och poäng ───────────────────────────────────────── */}
      <section id="rules-winning" style={S.section}>
        {h2("rules-winning")}
        {para(t("rules.winning.intro"))}

        {h3("rules-hemspel-win")}
        {para(t("rules.winning.hemspel"))}

        {h3("rules-vackert-spel")}
        {para(t("rules.winning.vackert"))}
        {list(t("rules.winning.vackertList"))}
        {para(t("rules.winning.vackertLost"))}

        {h3("rules-munk")}
        {para(t("rules.winning.munk"))}

        {h3("rules-jan")}
        {para(t("rules.winning.jan"))}

        {h3("rules-sprangjan")}
        {para(t("rules.winning.sprangjan"))}

        {h3("rules-last-roll")}
        {para(t("rules.winning.lastRoll"))}
        {list(t("rules.winning.lastRollList"))}

        {h3("rules-points")}
        <table style={S.table}>
          <thead>
            <tr>
              <th scope="col" style={S.th}>{t("rules.winning.colGame")}</th>
              <th scope="col" style={S.thNum}>{t("rules.winning.colPoints")}</th>
            </tr>
          </thead>
          {POINT_GROUPS.map((group, gi) => (
            <tbody key={gi} style={gi > 0 ? S.groupTop : undefined}>
              {group.map(([type, pts], ri) => (
                <tr key={type} style={gi > 0 && ri === 0 ? S.groupTop : undefined}>
                  <td style={S.td}>{winType(type)}</td>
                  <td style={S.tdNum}>{pts}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>

        {h3("rules-match")}
        {para(t("rules.winning.match"))}
      </section>

      <p style={S.credit}>
        <Rich
          text={t("rules.credit", { title: t("source.title"), org: t("source.org") })}
          slots={{ link: officialLink(t("rules.creditLink")) }}
        />
      </p>
    </div>
  );
}
