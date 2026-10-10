// ── Spelregler för bräde ─────────────────────────────────────────────────────
// Swedish rules text, following "Spelregler för bräde" as adopted by
// Vasamuseets Brädspelsvänner (årsmöte 26 februari 2003).
//
// Every section (and a few sub-sections) carries a stable `id` so other views —
// e.g. a future tutorial mode — can deep-link with `/rules#rules-bearing-off`
// or scroll the in-game drawer to a section. Keep these ids stable.

export const OFFICIAL_RULES_URL =
  "https://www.vasamuseet.se/om-vasamuseet/vasamuseets-vanner/bradspelssektionen/spelregler";

export const RULES_SECTIONS = [
  { id: "rules-setup",       title: "Uppställning och start" },
  { id: "rules-movement",    title: "Hur brickorna flyttas" },
  { id: "rules-dice",        title: "Tärningar och allor" },
  { id: "rules-hitting",     title: "Blottor, slag och inspel" },
  { id: "rules-blocking",    title: "Band och sprängning" },
  { id: "rules-bearing-off", title: "Hemspel" },
  { id: "rules-winning",     title: "Vinst, poäng och matcher" },
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

// Point table (§13). Rows in the same group rank equally in a match tie-break (§14).
const POINT_GROUPS = [
  [["Sprängjan", 6]],
  [["Jan", 4]],
  [
    ["Enkelt kronspel med munk", 3],
    ["Dubbelt kronspel med munk", 3],
    ["Trappspel med munk", 3],
    ["Uppspel med munk", 3],
  ],
  [
    ["Enkelt kronspel", 2],
    ["Dubbelt kronspel", 2],
    ["Trappspel", 2],
    ["Uppspel", 2],
  ],
  [["Hemspel med munk", 2]],
  [["Hemspel", 1]],
];

function T({ children }) {
  return <em style={S.term}>{children}</em>;
}

/**
 * The full Swedish rules text.
 *
 * Props:
 *   showToc     – render a row of section links at the top (default true)
 *   onNavigate  – optional (id) => void; when given, TOC clicks call it instead
 *                 of following the #hash (used by the in-game drawer so the
 *                 game URL isn't changed).
 */
export default function RulesContent({ showToc = true, onNavigate }) {
  function handleTocClick(e, id) {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(id);
  }

  return (
    <div style={S.root}>
      <p style={S.intro}>
        Bräde – ibland även kallat svenskt brädspel – spelas med ett flertal olika regelvarianter.
        Reglerna nedan följer de spelregler som antagits av Vasamuseets Brädspelsvänner (numera
        Vasamuseets vänner – Brädspelssektionen).
      </p>
      <p style={S.official}>
        <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={S.link}>
          Officiella spelregler hos Brädspelssektionen ↗
        </a>
      </p>

      {showToc && (
        <nav aria-label="Innehåll">
          <ul style={S.toc}>
            {RULES_SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} style={S.tocLink} onClick={e => handleTocClick(e, s.id)}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ── 1. Uppställning ─────────────────────────────────────────────── */}
      <section id="rules-setup" style={S.section}>
        <h2 style={S.h2}>Uppställning och start</h2>
        <p style={S.p}>
          Bräde spelas av två personer med ett spelbräde, två par tärningar, femton ljusa och
          femton mörka brickor. Längs brädets båda långsidor finns tjugofyra triangulära fält –
          tolv på varje sida – som kallas <T>tungor</T> eller <T>kilar</T>. Ribban i mitten delar
          tungorna i grupper om sex. Varje grupp med sex tungor bildar ett <T>kvarter</T>.
        </p>
        <p style={S.p}>
          Innan partiet börjar ställer varje spelare upp alla sina femton brickor i tungan längst
          till höger på den motsatta sidan av brädet. Denna tunga kallas spelarens <T>hem</T>.
        </p>
        <p style={S.p}>
          Spelet är en kapplöpning: man ska snabbast möjligt föra sina brickor ett varv runt
          brädet och spela ut dem, samtidigt som man försöker hindra motspelaren genom att bygga
          hinder och slå hans brickor. Man kan vinna genom att först ta ut alla brickor, men också
          genom att arrangera alla brickor i ett speciellt mönster i det sista kvarteret, eller genom
          att slå så många av motspelarens brickor att han inte kan spela in dem igen.
        </p>
        <p style={S.p}>
          Spelarna använder varsitt tärningspar. För att avgöra vem som börjar det första partiet i
          en match slår varje spelare med en tärning – det kallas att <T>teka</T>. Den som slår
          lägst börjar. Slår spelarna lika tekar man igen. I övriga partier i matchen börjar alltid
          förloraren i föregående parti.
        </p>
      </section>

      {/* ── 2. Förflyttning ─────────────────────────────────────────────── */}
      <section id="rules-movement" style={S.section}>
        <h2 style={S.h2}>Hur brickorna flyttas</h2>
        <p style={S.p}>
          Spelarna turas om att slå och flyttar sina brickor motsols runt brädet: först från hemmet
          och vidare åt vänster på motsatta sidan, sedan över till den egna sidan och vidare åt höger.
          Kvarteren numreras från ett till fyra i brickornas färdväg – vit spelares första kvarter
          är alltså svart spelares tredje kvarter, och så vidare. Brickorna får inte föras ut ur
          spelarens fjärde kvarter förrän hemspelet har börjat.
        </p>
        <p style={S.p}>
          En bricka flyttas alltid lika många tungor framåt som antalet ögon på den tärning man
          flyttar för. Man kan välja mellan att flytta en eller två brickor. Har man slagit t.ex.
          6–4 kan man flytta en bricka tio tungor (ta fullt med en) eller en bricka fyra tungor och
          en annan sex tungor.
        </p>
        <p style={S.p}>
          Att ta fullt med en bricka räknas alltid som två flytt, ett för varje tärning. Brickan får
          inte flyttas direkt till sin slutdestination utan måste <T>mellanlanda</T> på vägen – i
          exemplet med 6–4 antingen på den fjärde eller den sjätte tungan. Mellanlandningen måste
          alltså också vara tillåten.
        </p>
      </section>

      {/* ── 3. Tärningar och allor ──────────────────────────────────────── */}
      <section id="rules-dice" style={S.section}>
        <h2 style={S.h2}>Tärningar och allor</h2>
        <p style={S.p}>
          Visar båda tärningarna samma antal ögon har spelaren slagit en <T>alla</T>. Varje tärning
          räknas då två gånger, d.v.s. spelaren flyttar fyra gånger för tärningens ögon. Vid 5–5
          (femmor all) flyttar man fyra femmor och kan välja att flytta en, två, tre eller fyra
          brickor. Flyttar man en enda bricka måste den mellanlanda tre gånger innan den landar på
          den tjugonde tungan från startpunkten.
        </p>
        <p style={S.p}>
          Om spelaren kan flytta för båda tärningarna är han skyldig att göra det. Han måste använda
          så många av tärningarnas ögon som möjligt. Kan han bara flytta för den ena tärningen måste
          han flytta för den och ge upp den andra. Att ge upp en tärning kallas att <T>fåta</T>.
        </p>
        <ul style={S.ul}>
          <li style={S.li}>
            Kan spelaren flytta för vilken som helst av tärningarna, men inte för båda, måste han ta
            den högre tärningen och fåta den lägre.
          </li>
          <li style={S.li}>
            Kan spelaren inte flytta fyra gånger vid en alla, måste han flytta så många gånger som
            möjligt.
          </li>
          <li style={S.li}>
            En spelare som inte kan flytta alls fåtar hela slaget och står över till nästa kast.
          </li>
        </ul>
      </section>

      {/* ── 4. Blottor, slag och inspel ─────────────────────────────────── */}
      <section id="rules-hitting" style={S.section}>
        <h2 style={S.h2}>Blottor, slag och inspel</h2>
        <p style={S.p}>
          En ensam bricka på en tunga kallas en <T>blotta</T>; två eller flera brickor bildar ett
          {" "}<T>band</T>. Ett band med minst tre brickor kallas också <T>polack</T> eller
          {" "}<T>överband</T>. Att flytta en bricka så att ett band bildas kallas att <T>lägga band</T>
          {" "}eller <T>binda</T>; att flytta isär ett band så att det blir blottor kallas att
          {" "}<T>bryta band</T>.
        </p>
        <p style={S.p}>
          En blotta är oskyddad och kan slås. Ett band är fredat och kan inte slås, såvida inte
          spelaren byggt ett ogenomträngligt hinder med sina band (se{" "}
          <a href="#rules-bursting" style={S.link} onClick={e => handleTocClick(e, "rules-bursting")}>sprängning</a>).
        </p>
        <p style={S.p}>
          En blotta slås när någon av motspelarens brickor landar <em>eller mellanlandar</em> på den
          tunga där blottan ligger. Den slagna brickan placeras på ribban. En spelare som fått en
          eller flera brickor utslagna får inte flytta någon annan bricka förrän de slagna brickorna
          åter spelats in.
        </p>
        <h3 id="rules-reentry" style={S.h3}>Inspel</h3>
        <p style={S.p}>
          Slagna brickor spelas in i det första kvarteret, där spelaren har sitt hem. Har spelaren
          t.ex. en slagen bricka och slår 3–2 kan han spela in brickan på den andra eller den tredje
          tungan, och sedan flytta den vidare till den femte tungan eller flytta en annan bricka. Det
          är däremot <em>inte</em> tillåtet att slå ihop tärningarnas summa och direkt flytta den
          slagna brickan till den femte tungan.
        </p>
        <p style={S.p}>
          Märk att en bricka som spelas in inte hamnar på samma tunga som en bricka som tas
          hemifrån, eftersom den inspelade brickan startar utanför brädet och passerar hemmet på
          vägen. En bricka som tas hemifrån för en trea hamnar på den fjärde tungan, medan en bricka
          som spelas in för en trea hamnar på den tredje.
        </p>
        <ul style={S.ul}>
          <li style={S.li}>
            Brickor får bara spelas in på tomma tungor eller på tungor där motspelaren har en blotta
            – motspelarens blotta blir då slagen.
          </li>
          <li style={S.li}>
            Det är inte tillåtet att spela in på egna blottor eller till ett eget band i hemmet.
          </li>
          <li style={S.li}>
            Det är inte tillåtet att spela in på motspelarens band, såvida han inte byggt så många
            band i det första kvarteret att de utgör ett ogenomträngligt hinder.
          </li>
          <li style={S.li}>
            Om spelaren inte träffar någon tillgänglig tunga måste han fåta.
          </li>
        </ul>
      </section>

      {/* ── 5–6. Band och sprängning ────────────────────────────────────── */}
      <section id="rules-blocking" style={S.section}>
        <h2 style={S.h2}>Band och sprängning</h2>
        <h3 id="rules-band-placement" style={S.h3}>Var band får läggas</h3>
        <p style={S.p}>
          På den motsatta sidan av brädet (första och andra kvarteret) får en spelare bara lägga band
          på tungan allra längst till vänster, d.v.s. den sjätte tungan i det andra kvarteret. Denna
          tunga kallas spelarens <T>huk</T> och är mycket värdefull. På de övriga tungorna i första
          och andra kvarteret får man inte lägga band. På den egna sidan (tredje och fjärde
          kvarteret) får man lägga band överallt.
        </p>
        <p style={S.note}>
          Brickorna som vid spelets början är staplade i hemmet räknas som ett band, men eftersom
          man inte får spela in brickor i hemmet så länge man har kvar egna brickor där, går det
          inte att lägga band i hemmet igen när detta band väl har brutits.
        </p>
        <p style={S.p}>
          Brickor får passera motspelarens band, men det är inte tillåtet att vare sig mellanlanda
          eller landa på en tunga där motspelaren har ett band. Ett block med fem band i rad kan
          t.ex. bara passeras med en sexa från tungan alldeles bakom blocket. Det är ett viktigt
          strategiskt delmål att bygga hinder med upp till fem band i rad.
        </p>

        <h3 id="rules-bursting" style={S.h3}>Sprängning</h3>
        <p style={S.p}>
          Om det är omöjligt för en spelare att ta sig förbi motspelarens band har spelaren rätt att
          göra plats genom att <T>spränga</T> något av banden. Ett band sprängs när spelaren landar,
          mellanlandar eller spelar in en bricka på bandets tunga. Alla brickor i det sprängda
          bandet räknas som slagna och måste spelas in av motspelaren. Sådana ogenomträngliga hinder
          kan uppstå i två fall:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>
            <strong>Mer än fem band i rad.</strong> Spelaren har rätt att spränga vilket som helst av
            banden, men är inte tvungen att spränga om det finns andra möjligheter att flytta för
            tärningarna. Banden måste utgöra ett sammanhängande hinder <em>i spelarens färdväg</em>.
            Har motspelaren t.ex. lagt band i sin huk och på de första fem tungorna i sitt tredje
            kvarter får spelaren inte spränga, eftersom hela hindret då inte ligger i spelarens
            färdväg.
          </li>
          <li style={S.li}>
            <strong>Fler slagna brickor än tillgängliga tungor.</strong> När spelaren har fler slagna
            brickor att spela in än det finns tillgängliga tungor i det första kvarteret (tomma
            tungor eller tungor med motspelarens blotta) får han spela in på motspelarens band, och
            då slås samtliga brickor i bandet. Banden får sprängas redan innan alla tillgängliga
            tungor utnyttjats. Så snart antalet slagna brickor inte längre överstiger antalet
            tillgängliga tungor upphör rätten att spränga. Den som har byggt banden – alltså
            motspelaren till den som ska spela in – är skyldig att lämna så mycket plats att alla
            utslagna brickor hela tiden ryms på det tillgängliga utrymmet i det första kvarteret.
          </li>
        </ul>
        <p style={S.note}>
          Exempel: svart har tre slagna brickor att spela in. I hans första kvarter ligger hans egna
          brickor på tunga 1 (hemmet), tunga 2 är tom, vit har en blotta på tunga 3 och band på
          tungorna 4, 5 och 6. Svart har alltså bara två tillgängliga tungor (2 och 3) och får därför
          spränga <em>ett</em> av vits band. Med 6–2 spränger svart bandet på 6 med sexan och spelar
          in på 2 med tvåan. Med 5–3 spränger han bandet på 5 och slår blottan på 3. Med 6–5 spränger han bandet på 6 och fåtar femman – han får inte spränga på 5,
          eftersom han är skyldig att utnyttja den högre tärningen. Med 2–1 spelar han in med tvåan
          och fåtar ettan.
        </p>
        <h3 id="rules-junker" style={S.h3}>Junker</h3>
        <p style={S.p}>
          Undantag: om en spelare har spelat hem fjorton brickor och bara har en bricka kvar i spel
          får inga band under några omständigheter längre sprängas. Om den sista brickan blir slagen
          får motspelaren blockera den med sex eller sju band i rad. Kan brickan då inte flytta,
          oberoende av vad spelaren slår, måste han stå över sitt slag. Han kallas då
          {" "}<T>junker</T> (ungefär &rdquo;dagdrivare&rdquo;).
        </p>
      </section>

      {/* ── 7. Hemspel ──────────────────────────────────────────────────── */}
      <section id="rules-bearing-off" style={S.section}>
        <h2 style={S.h2}>Hemspel</h2>
        <p style={S.p}>
          Den enklaste segern kallas <T>hemspel</T>: spelaren spelar alla brickor till en tänkt
          tjugofemte tunga utanför spelbrädet. Man säger att spelaren <T>tar ut</T> eller
          {" "}<T>spelar hem</T> sina brickor. Hemspelade brickor tas bort från brädet.
        </p>
        <p style={S.p}>
          En spelare får inte börja spela hem förrän han samlat alla brickor i det fjärde kvarteret.
          Om en eller flera brickor slås för en spelare som börjat spela hem får inga fler brickor
          spelas hem förrän de slagna brickorna återbördats till det fjärde kvarteret.
        </p>
        <p style={S.note}>
          <strong>Vasamuseets regel:</strong> en spelare som flyttar en bricka för en tärning får bara
          spela hem brickan om den ligger sist, eller på delad sista plats, av alla spelarens brickor
          i det fjärde kvarteret. Visar tärningen för lite för att spela hem den sista brickan måste
          spelaren i stället flytta fram någon av sina brickor. Går inte detta måste han fåta. En
          bricka som mellanlandar innan den spelas hem måste ligga sist vid varje mellanlandning.
        </p>
        <ul style={S.ul}>
          <li style={S.li}>
            Visar tärningen exakt det antal ögon som behövs för att spela hem den sista brickan
            spelas den alltid hem – det kallas att gå <T>jämnt hem</T>.
          </li>
          <li style={S.li}>
            Visar tärningen mer än vad som behövs får den sista brickan ändå spelas hem. Slaget sägs
            då <T>reduceras</T>, eftersom tärningens ögon inte utnyttjas fullt ut.
          </li>
          <li style={S.li}>
            Spelaren måste alltid hålla den sammanlagda reduktionen i slaget så liten som möjligt.
          </li>
        </ul>
        <p style={S.note}>
          Exempel: vit har brickor på 21, 22, 23 och 24 och slår 3–2. Han får inte spela hem någon
          bricka från 22 eller 23, eftersom han har brickor kvar på 21. Trean måste användas till att
          flytta en bricka från 21 till 24, och tvåan till att flytta fram en bricka från 21 eller 22.
        </p>
      </section>

      {/* ── 8–14. Vinst och poäng ───────────────────────────────────────── */}
      <section id="rules-winning" style={S.section}>
        <h2 style={S.h2}>Vinst, poäng och matcher</h2>
        <p style={S.p}>Ett parti bräde kan vinnas på flera sätt:</p>

        <h3 id="rules-hemspel-win" style={S.h3}>Hemspel</h3>
        <p style={S.p}>Spelaren har spelat hem alla sina femton brickor (se ovan).</p>

        <h3 id="rules-vackert-spel" style={S.h3}>Vackert spel</h3>
        <p style={S.p}>
          Spelaren arrangerar sina brickor i ett av fyra förutbestämda mönster i det fjärde
          kvarteret:
        </p>
        <ul style={S.ul}>
          <li style={S.li}><strong>Enkelt kronspel:</strong> tre brickor på var och en av de sista fem tungorna (20–24).</li>
          <li style={S.li}><strong>Dubbelt kronspel:</strong> fem brickor på var och en av de sista tre tungorna (22–24).</li>
          <li style={S.li}><strong>Trappspel:</strong> sju brickor på den sista tungan (24), fem på den näst sista (23) och tre på den tredje sista (22).</li>
          <li style={S.li}><strong>Uppspel:</strong> alla femton brickor på den sista tungan (24).</li>
        </ul>
        <p style={S.p}>
          Så fort en spelare har spelat hem en bricka har han gått miste om chansen att göra vackert
          spel.
        </p>

        <h3 id="rules-munk" style={S.h3}>Munk</h3>
        <p style={S.p}>
          Om en spelare avslutar ett hemspel eller ett vackert spel när motspelaren har en eller
          flera brickor utslagna värderas vinsten högre. Man säger att spelaren vinner
          {" "}<T>med munk</T>.
        </p>

        <h3 id="rules-jan" style={S.h3}>Jan</h3>
        <p style={S.p}>
          En spelare gör sin motspelare <T>jan</T> om han slår så många brickor att motspelaren
          omöjligt kan spela in dem igen. Det inträffar när motspelaren har fler brickor utslagna än
          det finns tungor i hans första kvarter som antingen är tomma eller upptagna av spelarens
          band eller blottor.
        </p>

        <h3 id="rules-sprangjan" style={S.h3}>Sprängjan</h3>
        <p style={S.p}>
          En spelare kan också göra motspelaren jan genom att spränga något av hans band i det första
          kvarteret. Detta kallas <T>sprängjan</T> och är det mest prestigefyllda sättet att vinna.
          En sprängning resulterar inte alltid i sprängjan – kan motspelaren fortfarande spela in
          brickorna har han inte förlorat.
        </p>

        <h3 id="rules-last-roll" style={S.h3}>Det sista slaget</h3>
        <p style={S.p}>
          Ett parti är slut så snart en spelare har spelat hem sin sista bricka, placerat sina
          brickor i något av mönstren för vackert spel eller slagit fler brickor för motspelaren än
          denne kan spela in igen.
        </p>
        <ul style={S.ul}>
          <li style={S.li}>
            Den som kan avsluta partiet måste inte göra det, om det är möjligt att göra en annan
            flytt i stället.
          </li>
          <li style={S.li}>
            Det är <em>inte</em> tillåtet att fortsätta ett parti sedan det avslutats, även om man
            bara har flyttat för en av tärningarna.
          </li>
          <li style={S.li}>
            Den som avslutar partiet med den ena tärningen behöver inte ta hänsyn till den andra. Man
            får t.ex. fåta den högre tärningen, och vid en alla flytta en, två, tre eller fyra gånger
            efter eget val.
          </li>
          <li style={S.li}>
            Man är inte skyldig att hålla reduktionen så liten som möjligt i det sista slaget.
          </li>
        </ul>

        <h3 id="rules-points" style={S.h3}>Poäng</h3>
        <table style={S.table}>
          <thead>
            <tr>
              <th scope="col" style={S.th}>Spel</th>
              <th scope="col" style={S.thNum}>Poäng</th>
            </tr>
          </thead>
          {POINT_GROUPS.map((group, gi) => (
            <tbody key={gi} style={gi > 0 ? S.groupTop : undefined}>
              {group.map(([name, pts], ri) => (
                <tr key={name} style={gi > 0 && ri === 0 ? S.groupTop : undefined}>
                  <td style={S.td}>{name}</td>
                  <td style={S.tdNum}>{pts}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>

        <h3 id="rules-match" style={S.h3}>Matcher</h3>
        <p style={S.p}>
          En match spelas i ett udda antal partier, vanligen tre, fem eller sju. Om spelarna får
          samma slutpoäng vinner spelaren med det högst värderade spelet enligt tabellen ovan. Alla
          spel i samma grupp värderas lika högt (t.ex. trappspel och uppspel), medan ett spel i en
          högre grupp värderas högre än ett spel i en lägre grupp även om poängen är densamma –
          trappspel värderas t.ex. högre än hemspel med munk. Om de båda spelarnas bästa spel är lika
          högt värderade räknas de näst bästa spelen, och så vidare.
        </p>
      </section>

      <p style={S.credit}>
        Källa: <em>Spelregler för bräde</em>, antagna av Vasamuseets Brädspelsvänner (numera
        Vasamuseets vänner – Brädspelssektionen) vid årsmötet den 26 februari 2003.{" "}
        <a href={OFFICIAL_RULES_URL} target="_blank" rel="noopener noreferrer" style={S.link}>
          Läs de officiella spelreglerna hos Brädspelssektionen
        </a>
        .
      </p>
    </div>
  );
}
