# Regelrevision — engine vs. "Spelregler för bräde"

Audit for #9. Source of truth: [`nya-svenska-bradspelsregler.pdf`](nya-svenska-bradspelsregler.pdf), Vasamuseets Brädspelsvänner's rules ("Spelregler för bräde", adopted 26 Feb 2003), 9 pages, §1–§14.

Code audited: `server/src/game/engine.js`, `scoring.js`, `ai.js`, `expectimax.js`, plus the parts of `server/src/ws/handlers.js` that implement rules (teka, who starts, match end).

**Path-space reminder** (see `engine.js` header): each colour's path runs pos 0 (home point) … pos 23. Q1 = pos 0–5, Q2 = 6–11 (huk = pos 11), Q3 = 12–17, Q4 = 18–23. Re-entry with die *d* lands on pos *d*−1. The PDF's "tunga *n*" in the player's own numbering is pos *n*−1.

Status: ✅ matches · ❌ differs (issue filed) · ❓ unclear / not decidable from the text.

Test references are test names in `server/src/game/engine.test.js` (E) and `scoring.test.js` (S). Tests added by this audit are in the block headed "Rules audit (#9)" in E and "§13-14 (p.9) scoring table" in S.

## Sammanfattning av reglerna (svenska)

Short summary in Swedish for other work (tutorial, rules panel), following the PDF.

### Uppställning (§1)
- Bräde med 24 tungor (kilar) i fyra kvarter om sex. Varje spelare har 15 brickor och ett eget tärningspar.
- Alla 15 brickor står från början i spelarens **hem**: tungan längst till höger på motsatta sidan av brädet. Motspelarens hem ligger diagonalt mitt emot.
- **Teka:** inför matchens första parti slår var och en en tärning. Lägst börjar, och vid lika slår man om. I följande partier börjar förloraren i föregående parti.

### Förflyttning (§2, §5)
- Båda spelarna flyttar **motsols** åt samma håll: från hemmet åt vänster längs motsatta sidan (kvarter 1–2), sedan över till egna sidan och åt höger (kvarter 3–4). Brickorna får inte lämna fjärde kvarteret förrän hemspelet börjat.
- En bricka flyttas exakt lika många tungor som tärningen visar. Att ta fullt med en bricka räknas som två flytt och kräver en tillåten mellanlandning.
- **Band** (≥2 egna brickor) får på motsatta sidan bara läggas på **huken**, sjätte tungan i andra kvarteret. På egna sidan (kvarter 3–4) får band läggas överallt. I hemmet kan man aldrig lägga nytt band.
- Man får passera över motspelarens band men inte landa eller mellanlanda på dem. Fem band i rad kan bara passeras med en sexa från tungan alldeles bakom.

### Tärningar och alla (§2)
- Lika på båda tärningarna kallas **alla**: man flyttar fyra gånger. En ensam bricka mellanlandar då tre gånger.
- Man måste använda så många tärningsögon som möjligt. Går bara en av tärningarna att använda, och vilken som helst av dem, måste man ta den **högre**. Kan man inte flytta alls **fåtar** man hela slaget.

### Slag och inspel (§3, §4)
- **Blotta** = ensam bricka. Den slås när en motståndarbricka landar eller mellanlandar på den, och placeras då på ribban.
- Har man brickor på ribban får man inte flytta något annat förrän alla är inspelade.
- Inspel sker i första kvarteret: tärning *d* ger tunga *d* (räknat så att den inspelade brickan passerar hemmet). Inspel får bara ske på **tomma tungor eller motspelarens blottor**, alltså inte på egna brickor (inte heller hemmabandet) och inte på motspelarens band. Går det inte fåtar man.

### Sprängning (§6)
- Ett band **sprängs** när man landar, mellanlandar eller spelar in på det. Alla brickor i bandet räknas som slagna.
- Fall 1: motspelaren har **mer än fem band i rad** i spelarens färdväg. Spelaren har då **rätt** att spränga vilket som helst av dem, men är inte tvungen om andra flytt finns.
- Fall 2: spelaren har **fler brickor på ribban än tillgängliga tungor** (tomma eller med motspelarens blotta) i första kvarteret. Han får då spränga band i första kvarteret, och det redan innan de tillgängliga tungorna är utnyttjade. Rätten upphör så snart brickorna ryms.
- **Junker:** den som har 14 brickor hemspelade och bara en kvar får aldrig spränga. Blockeras brickan står spelaren över sitt slag.

### Hemspel (§7)
- Man får börja spela hem först när alla brickor är i fjärde kvarteret, och inte så länge någon slagen bricka inte återvänt dit.
- Bara brickan som ligger **sist** (eller delar sista plats) får spelas hem, och en bricka som mellanlandar måste ligga sist vid varje mellanlandning.
- Exakt tärning går **jämnt hem**. En större tärning spelar hem den sista brickan men **reduceras**. Den sammanlagda reduktionen i slaget ska vara så liten som möjligt. Räcker tärningen inte till måste man flytta fram någon annan bricka, och annars fåta.

### Vinst och poäng (§8–§14)
- **Hemspel** (1 p): alla 15 brickor utspelade.
- **Vackert spel** (2 p), bara om ingen bricka spelats hem: enkelt kronspel 3+3+3+3+3 på tunga 20–24, dubbelt kronspel 5+5+5 på 22–24, trappspel 3/5/7 på 22/23/24, uppspel 15 på 24.
- **Munk**: hemspel eller vackert spel när motspelaren har minst en bricka utslagen. Hemspel med munk ger 2 p och vackert spel med munk 3 p.
- **Jan** (4 p): motspelaren har fler utslagna brickor än tungor i sitt första kvarter som är tomma eller upptagna av vinnarens band eller blottor.
- **Sprängjan** (6 p): jan som uppnås genom att spränga ett av motspelarens band i det egna första kvarteret. Det är draget som gör motspelaren jan som avgör: blir han inte jan av sprängningen utan först av ett senare drag i samma slag, är det vanlig jan (#88).
- **Sista slaget** (§12): partiet slutar direkt när ett avslutskriterium uppnås, och man får inte fortsätta. Man måste inte avsluta om ett annat flytt finns. Den som avslutar behöver inte bry sig om den andra tärningen eller om reduktionen.
- **Match** (§14): ett udda antal partier (3, 5, 7). Vid lika poäng vinner den med det högst värderade spelet enligt tabellen, där spel i samma ruta är lika värda. Är även det lika jämförs näst bästa spel, och så vidare.

## Checklist

| # | Rule (Swedish text, quoted or paraphrased) | PDF | Status | Test reference | Issue |
|---|---|---|---|---|---|
| 1.1 | 24 tungor, 15 brickor per spelare | §1 p.1 | ✅ | E "§1 setup: 15 white on point 1…" | |
| 1.2 | "ställer upp sina brickor i tungan längst till höger på den motsatta sidan" (hem); hemmen diagonalt mitt emot (bild) | §1 p.1 | ✅ white idx 0, black idx 12 | E "§1 setup…" | |
| 1.3 | Teka: "Den som slår lägst får börja. Slår spelarna lika, tekar man igen." | §1 p.1 | ✅ in `handlers.js` (START). AI, matchmaking and tournament rooms start with a random 50/50 colour instead of visible teka dice, which is statistically equivalent. | none (handler logic) | |
| 1.4 | "I övriga partier i matchen börjar alltid förloraren i föregående parti" | §1 p.1 | ✅ `handleGameOver` sets `gs.turn = opp(winner)` | none (handler logic) | |
| 2.1 | Båda flyttar motsols, från hemmet via kvarter 1–4 | §2 p.2 | ✅ | E "§2 direction: …" (3 tests) | |
| 2.2 | "Brickorna får inte föras ut ur spelarens fjärde kvarter förrän … hemspelet börjat" | §2 p.2 | ✅ | E "§2 may not leave Quarter 4…" | |
| 2.3 | Flytta exakt så många tungor som tärningen visar; en eller två brickor | §2 p.2 | ✅ | E "§2 direction…", "§2 doubles…" | |
| 2.4 | "Att ta fullt med en betraktas alltid som två flytt … måste mellanlanda på vägen" | §2 p.2 | ✅ (engine moves die by die) | E "§2 (p.2) taking full with one checker needs a legal intermediate landing" | |
| 2.5 | Alla: fyra flytt; en ensam bricka mellanlandar tre gånger | §2 p.2 | ✅ | E "§2 doubles = four moves (alla)…", "§1 rollDice…" | |
| 2.6 | "Spelaren måste använda så många av tärningarnas ögon som möjligt" (även vid alla) | §2 p.2 | ✅ max-length filter over every complete turn. The enumerator has no sequence cap (#38 removed one that dropped legal first moves with doubles). | E "§2 max-dice…", "§2 + §6 (#38) doubles with a 6-band wall: every legal first move is offered" | #38 (fixed) |
| 2.7 | "Han måste då ta för den högre tärningen och fåta den lägre" | §2 p.2 | ✅ | E "§2 higher-die…", "§6 (p.4) figure, 6-5…" | |
| 2.8 | "En spelare som inte kan flytta alls fåtar hela slaget" | §2 p.2 | ✅ empty legal moves → handler passes | E "§7 Fig 4…", "§6 Case A: a wall shorter than 6…" | |
| 3.1 | Blotta = ensam bricka; band = två eller fler | §3 p.2 | ✅ | E "§3 a blot (single) can be landed on (hit)" | |
| 3.2 | "En blotta är oskyddad och kan slås … Ett band däremot är fredat" (except §6) | §3 p.2 | ✅ | E "§3 a band (2+) cannot be hit…" | |
| 4.1 | "En blotta slås när någon av motspelarens brickor landar eller mellanlandar på den tunga där blottan ligger"; placed on the bar | §4 p.2 | ✅ | E "§4 hit-on-landing…", "§4 (p.2) a blot is hit by an intermediate landing" | |
| 4.2 | "får inte flytta någon annan bricka på brädet förrän de slagna brickorna åter spelats in" | §4 p.2 | ✅ | E "§4 bar priority…" | |
| 4.3 | Inspel i första kvarteret; 3-2 → tunga 2 eller 3, sedan vidare till 5. "inte tillåtet att slå ihop summan" | §4 p.2–3 | ✅ | E "§4 (p.2–3) re-entry example 3-2…", "§4 re-entry lands on path pos d-1" | |
| 4.4 | A re-entered checker lands one point short of a checker moved from home ("den inspelade brickan startar utanför brädet") | §4 p.3 | ✅ | E "§4 re-entry pos d-1 ≠ home-move pos d…" | |
| 4.5 | "Brickor får bara spelas in på tomma tungor eller på tungor där motspelaren har en blotta" | §4 p.3 | ✅ | E "§4 re-entry legality: MAY re-enter on opponent blot…" | |
| 4.6 | "inte tillåtet att spela in brickor på egna blottor eller till ett eventuellt eget band i hemmet" | §4 p.3 | ✅ | E "§4 re-entry legality: may NOT re-enter on own band/blot", "§4 (p.3) may NOT re-enter onto the own home band" | |
| 4.7 | Not onto an opponent band unless it is an impenetrable obstacle (§6); "Om en spelare … inte träffar någon tillgänglig tunga, måste han fåta" | §4 p.3 | ✅ | E "§4 re-entry legality: may NOT re-enter on opponent band…" | |
| 5.1 | Motsatta sidan: band bara på huken ("den sjätte tungan i det andra kvarteret"); "inte tillåtet att lägga band på någon av de andra tungorna i det första eller andra kvarteret" | §5 p.3 | ✅ (pos 1–10 forbidden; home can never be re-banded per 4.6) | E "§5 huk-only banding…", "§5 may make a band at the huk…", "§5 black: …symmetrically" | |
| 5.2 | Band överallt i tredje och fjärde kvarteret | §5 p.3 | ✅ | E "§5 banding allowed anywhere on own side…" | |
| 5.3 | Does an *intermediate* landing on an own blot in Q1/Q2 (one checker taking full) count as "lägga band"? The engine forbids it, but the PDF only defines "lägga band" as a move that creates a band. | §5 p.3 | ❓ | none | not filed (ambiguous) |
| 5.4 | "inte tillåtet att varken mellanlanda eller landa på en tunga där motspelaren har ett band" | §5 p.3 | ✅ | E "§5 cannot land on an opponent band…", "§2 (p.2) taking full…" | |
| 5.5 | "Ett block med fem band i rad kan t.ex. bara passeras … med en sexa" | §5 p.3 | ✅ | E "§5 (p.3) a block of five bands can be passed only with a six…" | |
| 6.1 | Sprängning by landing, intermediate landing or re-entry; "Alla brickor i det sprängda bandet betraktas som slagna" | §6 p.3 | ✅ | E "§6 Case B worked example, roll 6-2…", "§6 Case A: a 6-band wall…" | |
| 6.2 | Case 1: "mer än fem band i rad … rätt att spränga vilket som helst av banden" | §6 p.3 | ✅ whether or not the player has other moves | E "§6 Case A: a 6-band wall directly in path may be burst when no other move exists", "§6 (p.3) Case A: a wall burst is optional…", "§6 Case A: a wall shorter than 6 does NOT grant a burst (player simply stuck)" | |
| 6.2b | Case 1 while **on the bar**: a 6+ wall directly in front of a checker on the bar (e.g. opp bands on pos 1–6, only five of them in Q1). §4 limits re-entry bursting to "i det första kvarteret" (case 2), and §6 case 1 doesn't say whether a bar checker can use it. The engine never applies case 1 while on the bar (`wallBurstTargets` returns `[]` when bar > 0), so white with 1 on the bar, bands on pos 1–6 and a roll of 3-4 passes. | §6 p.3, §4 p.3 | ❓ | E "§6 (p.3) current behaviour: a checker on the bar facing a 6-band wall (pos 1–6) just passes" (asserts current behaviour, NOTE) | not filed (ambiguous) |
| 6.2c | Two bursts in one turn: with a 7-band wall and 1-1-1-1, the first burst leaves six bands in a row, so the right still holds and a second band may be burst. §6 grants the right to burst "vilket som helst av banden" while there are "mer än fem band i rad", and the engine judges this in the position each move is played from. The text doesn't address it directly, but this is the natural reading. | §6 p.3 | ✅ | E "§6 (p.3) Case A: a 7-band wall may be burst twice in one turn with 1-1-1-1" | not filed (defensible) |
| 6.3 | "… men han är inte tvungen att spränga om det finns andra möjligheter att flytta" (burst is an *optional right*) | §6 p.3 | ✅ (fixed in #11) the wall burst is offered alongside ordinary moves; §2 maximal use still applies | E "§6 (p.3) Case A: a wall burst is optional…", "§6 (p.3) Case A: NOT forced…", "§6 (p.3) + §2 Case A: an optional burst that would forfeit a die…" | #11 (fixed) |
| 6.3b | The burst is optional only "om det finns andra möjligheter att flytta för tärningarna". When bursting is the only way to use both dice, §2 maximal use makes it effectively mandatory. Example: dice 1-2, white on 5 and 22, wall on 6–11. Without a burst only 22→23 can be played, so every legal turn bursts 5→7. | §6 p.3, §2 p.2 | ✅ | E "§6 (p.3) + §2 Case A: a wall burst becomes mandatory when it is the only way to use both dice" | |
| 6.4 | "banden måste utgöra ett sammanhängande hinder *i spelarens färdväg*" (wall across huk → Q3 is not in the path) | §6 p.3 | ✅ contiguity does not wrap past pos 23 (`contiguousBandRunCovers`) | E "§6 (p.3) a wall that is not in the player's path (opp huk + first five of Q3) may not be burst" | |
| 6.5 | Case 2: "antalet slagna brickor är större än antalet tillgängliga tungor" (tom eller motspelarens blotta) | §6 p.3–4 | ✅ | E "§6 Case B: bar overflow grants burst right…" | |
| 6.6 | "banden får sprängas redan innan alla tillgängliga tungor … utnyttjats"; rätten upphör när brickorna ryms | §6 p.4 | ✅ | E "§6 Case B: burst right ceases as soon as bar <= availableQ1", "§6 Case B: bar overflow grants burst right (bar 3 > availableQ1 2)", figure tests (6.7) | |
| 6.6b | "Motspelaren är skyldig att lämna så mycket plats att alla utslagna brickor hela tiden ryms på det tillgängliga utrymmet i det första kvarteret." This could be an obligation that restricts the *opponent's* moves, or just the rationale for the burst right in 6.5–6.6. The engine has no such restriction on the opponent. Overflow is handled only through the case-2 burst right. | §6 p.4 | ❓ | none | not filed (ambiguous) |
| 6.7 | Figure: 6-2, 5-3, 6-5 ("inte tillåtet att spränga bandet på tunga 5"), 2-1 | §6 p.4 | ✅ | E "§6 (p.4) figure, 6-2: burst the band on 6 with the six and enter on 2 with the two", "§6 (p.4) figure, 5-3: burst the band on 5 and hit the blot on 3", "§6 (p.4) figure, 6-5: burst with the six and forfeit the five (may NOT burst on 5)", "§6 (p.4) figure, 2-1: enter with the two and forfeit the one" | |
| 6.8 | Junker: "spelat hem fjorton brickor … får inga band under några omständigheter längre sprängas" | §6 p.4 | ✅ | E "§6 junker exception…", "§6 (p.4) junker on the bar may not burst…" | |
| 6.9 | Junker blocked: "kan spelaren inte längre flytta … och måste stå över sitt slag" | §6 p.4 | ✅ a junker on the bar facing bands passes; it is not jan (see 10.3) | E "§6/§10 (p.4, p.6) a junker stuck on the bar just passes — it is not jan (#12)" | #12 (fixed) |
| 7.1 | Hemspel to an imaginary 25th point; borne-off checkers leave the board | §7 p.4 | ✅ | E "§7 applyMove bear-off…" | |
| 7.2 | "får inte börja spela hem … förrän han samlat alla brickor i det fjärde kvarteret" | §7 p.4 | ✅ | E "§7 canBearOff: false until all 15 in Quarter 4…" | |
| 7.3 | "får bara spela hem brickan om den ligger sist eller på delad sista plats" | §7 p.4 | ✅ | E "§7 only the rearmost Q4 checker may bear off…" | |
| 7.4 | "Om tärningen visar för lite … måste spelaren istället flytta fram någon av sina brickor. Går inte detta … fåta" | §7 p.4–5 | ✅ | E "§7 Fig 3…", "§7 Fig 4…" | |
| 7.5 | "En bricka som mellanlandar … måste ligga sist vid varje mellanlandning" | §7 p.5 | ✅ | E "§7 (p.5) a checker taking full must be rearmost at every intermediate landing" | |
| 7.6 | "jämnt hem" (exact die) | §7 p.5 | ✅ | E "§7 jämnt hem…" | |
| 7.7 | Larger die bears off the last checker, "slaget reduceras" | §7 p.5 | ✅ | E "§7 die > needed bears off the rearmost with reduction…" | |
| 7.8 | "En spelare måste alltid hålla den sammanlagda reduktionen i slaget så liten som möjligt" | §7 p.5 | ✅ | E "§7 Fig 2 (roll 5-2): minimize reduction — bear off rear (pos21) with 5 (red 2) then off with 2 (red 1)", "§7 (p.5) Fig. 2 exact, 5-2: bear off from 22 and from 24, total reduction 3", "§7 (p.5) Fig. 3 exact, 5-3: five moves 19→24, three moves 21→24; no bear-off" | |
| 7.9 | "Om en eller flera brickor slås för en spelare som börjat spela hem, får inga fler brickor spelas hem förrän … återbördats till det fjärde kvarteret" | §7 p.5 | ✅ | E "§7 (p.5) after being hit, no bear-off until the hit checker is back in the fourth quarter" | |
| 7.10 | Fig. 1 (3-2), Fig. 2 (5-2), Fig. 3 (5-3), Fig. 4 (4-4 forfeit) | §7 p.5 | ✅ | E "§7 (p.5) Fig. 1 exact, 3-2: 21→24 with the three, then the two from 21 or 22", "§7 (p.5) Fig. 2 exact, 5-2: bear off from 22 and from 24, total reduction 3", "§7 (p.5) Fig. 3 exact, 5-3: five moves 19→24, three moves 21→24; no bear-off", "§7 Fig 4 (roll 4-4-4-4): rearmost 20 needs 5, 20→24 blocked by opp band → forfeit whole roll" | |
| 8.1 | Enkelt kronspel 3×(20–24), dubbelt kronspel 5×(22–24), trappspel 7/5/3 on 24/23/22, uppspel 15 on 24 | §8 p.6 | ✅ | E "§8 enkelt kronspel: 3 on each of pos 19–23 → kronspel_enkelt (2 pts)", "§8 dubbelt kronspel: 5 on each of pos 21–23 → kronspel_dubbelt (2 pts)", "§8 trappspel: 7 on pos 23, 5 on pos 22, 3 on pos 21 → trappspel (2 pts)", "§8 uppspel: 15 on pos 23 → uppspel (2 pts)" | |
| 8.2 | "Så fort en spelare har spelat hem en bricka, har han gått miste om chansen att göra vackert spel" | §8 p.6 | ✅ | E "§8 a single borne-off checker forfeits vackert spel…" | |
| 9.1 | Munk: hemspel or vackert spel "när motspelaren har en eller flera brickor utslagna" | §9 p.6 | ✅ | E "§9 hemspel med munk…", "§9 vackert spel med munk…", "§9 plain hemspel…" | |
| 10.1 | Jan: "fler brickor utslagna än det finns tungor i hans första kvarter som antingen är tomma eller upptagna av spelarens band eller blottor" | §10 p.6 | ✅ | E "§10 jan…", "§10 no jan when bar <= available", "§10 jan accessibility…" | |
| 10.2 | Jan is detected whenever it arises, including when the player to move is the one closed out | §10 p.6, §12 p.8 | ✅ `checkWin` + `checkJanOnPass` | E "§10 jan-on-pass: …" (3 tests) | |
| 10.3 | Same definition applies to a junker: the winner's bands count as available, so a junker (1 checker) can never be jan | §10 p.6 (+ §6 p.4) | ✅ `checkJan` counts the winner's bands as available with no junker exception | E "§10 jan edge: loser is junker → winner bands still count as available (no jan)", plus the 6.9 test | #12 (fixed) |
| 11.1 | Sprängjan: jan achieved "genom att spränga något av hans band i det första kvarteret" | §11 p.7 | ✅ Only a burst of a band in the bursting player's own first quarter (where the opponent's bands block his re-entry; cf. "motspelaren har många band … i spelarens första kvarter") counts: `applyMove` returns `burstFirstQuarter` and the handlers pass it to `checkWin(gs, lastMoveBurstFirstQuarter)`. A §6 wall burst elsewhere that leaves the opponent jan scores plain jan. | E "§11 sprängjan…", "§11 (p.8) figure: …" (3 tests), "§11 (p.7) a wall burst outside the first quarter … plain jan…", "§11 (p.7) a wall burst inside the first quarter … sprängjan…", "§11 applyMove: a burst on the mover's path pos 6 …" | #34 (fixed) |
| 11.2 | Jan reached on a *later* die of the same roll after an earlier burst (e.g. burst, then hit a blot): sprängjan or jan? | §11 p.7–8 | ✅ Maintainer decision (#88): the text is silent, so only the move that makes the opponent jan counts. If the burst itself does not make him jan, a later move that does is plain jan, not sprängjan. The engine already works this way (`checkWin(gs, lastMoveBurstFirstQuarter)`), and so do the handlers and Grandmaster. | E "§11 (p.7) a burst that does not make jan, followed by a hit that does, is plain jan (#88)", "§11 (p.7) the same roll played hit first, burst last, is sprängjan (#88)"; `expectimax.terminal.test.js` "sprängjan needs the last move's burst…" | #88 (decided) |
| 12.1 | "Ett parti är slut så snart en spelare antingen spelat hem sin sista bricka, placerat sina brickor i något av de fyra mönstren … eller slagit fler brickor … än denne kan spela in igen" | §12 p.8 | ✅ | E "§12 cannot continue once the game ends…" | |
| 12.2 | "En spelare som kan avsluta ett parti måste inte göra det, om det är möjligt att göra en annan flytt istället" | §12 p.8 | ✅ | E "§12 may decline to end…" | |
| 12.3 | "inte tillåtet att fortsätta ett parti sedan något av … kriterier för avslut uppnåtts" (e.g. no bearing off after completing kronspel with two of four fives) | §12 p.8 | ✅ | E "§12 (p.8) the game ends the moment a vackert spel is formed…" | |
| 12.4 | "behöver inte ta någon som helst hänsyn till den andra … tillåtet att fåta den högre tärningen i sista slaget"; with alla he may move 1–4 times | §12 p.8 | ✅ | E "§12 (p.8) lower die ends the game (jan) → may forfeit the higher die even when only one die is playable" (fails without the §12 exemption). "§12 ending move exempt from higher-die rule" is only partial, since it would pass without the exemption. | |
| 12.5 | "Spelaren är inte skyldig att hålla reduktionen så liten som möjligt i det sista slaget" (19 + blot on 21, 6-2 → munk) | §12 p.8 | ✅ | E "§12 (p.8) last roll need not minimise reduction…" | |
| 13.1 | Table: sprängjan 6, jan 4, vackert spel med munk 3, vackert spel 2, hemspel med munk 2, hemspel 1 | §13 p.8–9 | ✅ | E "§13-14 WIN_POINTS…", S "§13-14 (p.9) scoring table" | |
| 14.1 | "En match spelas i ett udda antal partier, vanligen tre, fem eller sju" | §14 p.9 | ✅ match lengths 1/3/5/7 (all odd), fixed number of games | none (Zod schemas in routes) | |
| 14.2 | Tie on points → "vinner spelaren med det högst värderade spelet"; same box equal; higher box wins even at equal points | §14 p.9 | ✅ | S "winRank" tests, "§13-14 (p.9) scoring table" | |
| 14.3 | "Om de båda spelarnas bästa spel är lika högt värderade, räknas de näst bästa spelen o.s.v." | §14 p.9 | ✅ | S "equal points, first ranks tied — second rank breaks tie", "equal points, equal best play → second-best…" | |
| 14.4 | Completely identical records: the rules give no tie-break. The app falls back to the last game's winner (`resolveMatchWinner`). | §14 p.9 | ❓ | none | not filed (text silent) |
| X.1 | Resign (1 p, ends the match) is an app feature and isn't in the rules | n/a | n/a | E "§13-14 WIN_POINTS…" (`resign`) | |

### AI (`ai.js`, `expectimax.js`)

| Check | Status | Notes |
|---|---|---|
| All difficulties choose only from engine-legal moves | ✅ | `pickMove` picks from `gs.legalMoves`. Grandmaster picks from `legalTurnSequences`, the same survivor set behind `getLegalMoves`. Covered by `ai.test.js` ("…always returns a legal move", "Grandmaster returns a move from getLegalMoves"). The engine fixes for #11 (optional wall burst) and #12 (junker is never jan) have landed, and the AI follows them automatically. |
| Grandmaster cached plan is replayed without re-validation | ❓ (robustness, not a rule) | `triggerAiTurn` applies the AI's move without checking it against `gs.legalMoves`. Plans come from legal sequences, so this is safe today. |
| Heuristic `janThreat` counts the winner's bands as available re-entry points | ✅ | Matches §10 and the engine's `checkJan`: only the loser's own checkers block an entry point. `evaluate` scores both our jan threat and the opponent's against us (#68). Game-ending sequences are terminal in the search and valued by points (sprängjan included), then §14 rank (#68). |
| Master prompt describes vackert spel as "bear off all 15 in a special pattern" | ❓ (prompt text) | Per §8, vackert spel means *arranging* the checkers in a pattern with **none** borne off. It's only an LLM hint and doesn't affect legality. |

## Discrepancies filed

- #11 (fixed): Wall bursting (§6 case 1) was only allowed when no other move existed. The rules make it an optional right, and the engine now offers it alongside ordinary moves.
- #12 (fixed): A junker stuck on the bar was declared jan. The rules say he stands over (§6 p.4, §10 p.6), and `checkJan` no longer has a junker exception.
- #38 (fixed): Turn enumeration stopped after 4000 sequences, which silently dropped legal first moves with doubles (§2). The enumerator now shares one transposition set across the search and has no cap.
