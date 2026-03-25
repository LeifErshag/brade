# Bräde Web App — Development Plan

## Overview
A fully playable implementation of Svenskt Bräde (Swedish Tables) as a web app, based on the official rules from Vasamuseets Brädspelsvänner (2003). Supports local multiplayer, AI opponents of varying skill, and a random opponent mode. Bilingual UI: Swedish / English.

---

## Tech Stack
- **React** (via Claude artifact)
- **Tailwind CSS** for styling
- **Claude API** (claude-sonnet-4-20250514) for Master-level AI opponent reasoning
- All game state managed in React (no backend required for local/AI modes)

---

## Phases

### ✅ Phase 1 — Board & Visual Foundation
**Goal:** Render a correct, beautiful Bräde board with pieces in starting position.

- [ ] Draw the 24-point board in traditional Swedish colours (red/yellow triangles on green background)
- [ ] Split bar (two separate parts, as per Swedish tradition)
- [ ] Place all 15 checkers per player in their respective homes (rightmost point on opponent's side)
- [ ] Checker stacking display (pairs + centred odd checker on top)
- [ ] Point numbering (1–24, from each player's perspective)
- [ ] Language toggle (SV / EN) in UI
- [ ] Responsive layout

**Deliverable:** Static board with correct starting position, Swedish aesthetic, language toggle.

---

### 🔲 Phase 2 — Game State & Movement Engine
**Goal:** Implement all legal move logic.

- [ ] Game state model: point occupancy, bar, off-board, whose turn
- [ ] Dice rolling (two dice, doubles = ×4)
- [ ] Legal move generation:
  - Counter-clockwise movement
  - Touchdown rules (must land on intermediate point for combined moves)
  - Cannot split a single die across two checkers
  - Must use both dice if possible; if only one, must use larger
- [ ] Blot detection & hitting (send to bar)
- [ ] Bar re-entry logic (re-enter in first quarter before other moves)
- [ ] Closed point rules:
  - May not close points 2–11 on opponent's side (only head = point 1 on that side)
  - May close any point on own side (quarters 3 & 4)
- [ ] Move highlighting (show legal destinations on click)
- [ ] Pass turn when no legal moves

**Deliverable:** Fully playable 2-player local game (pass & play), all movement rules enforced.

---

### 🔲 Phase 3 — Win Conditions & Scoring
**Goal:** Detect all seven win types and score correctly.

- [ ] **Bearing off**: all checkers in Q4, bear from backmost point only, reduction rules
- [ ] **Handsome games** (vackra spel):
  - Single crown (enkla kronan): 3 checkers on each of points 20–24
  - Double crown (dubbla kronan): 5 checkers on each of points 22–24
  - Staircase (trappan): 7 on 24, 5 on 23, 3 on 22
  - Tower (tornet): all 15 on point 24
- [ ] **Jan**: opponent cannot re-enter all checkers (more on bar than accessible points)
- [ ] **Forced jan**: jan achieved by forcing closed points
- [ ] **Monk** detection (opponent has checkers on bar at game end)
- [ ] Scoring table (1–6 points):
  - Forced jan: 6 | Jan: 4
  - Handsome game with monk: 3 | Handsome game: 2
  - Bearing off with monk: 2 | Bearing off: 1
- [ ] End-of-game screen with result, win type, points awarded
- [ ] Match tracking (best of 3 / 5 / 7)
- [ ] Tiebreak logic (highest-ranked win type wins tie)

**Deliverable:** Complete win/loss/score detection, match play with scoreboard.

---

### 🔲 Phase 4 — Five-Prime & Forcing Rules
**Goal:** Implement the advanced rules that make Bräde distinct from Backgammon.

- [ ] Five-prime detection (5+ consecutive closed points)
- [ ] Must place checker in front of prime, then roll 6 to pass
- [ ] Six/seven prime → vulnerable (can be forced)
- [ ] **Forcing rule 1**: prime > 5 points → any point in prime can be forced
- [ ] **Forcing rule 2**: checkers on bar > accessible points in Q1 → closed points in Q1 vulnerable
- [ ] Exception: only one checker left → forcing disabled
- [ ] Junker (player who cannot move at all passes turn)

**Deliverable:** All advanced Bräde-specific mechanics fully enforced.

---

### 🔲 Phase 5 — AI Opponents
**Goal:** Three AI skill levels.

- [ ] **Beginner (Nybörjare)**: picks a random legal move
- [ ] **Journeyman (Gesäll)**: heuristic AI
  - Prefers hitting blots
  - Builds closed points and primes
  - Avoids leaving blots in dangerous positions
  - Tries to advance toward Q4
- [ ] **Master (Mästare)**: Claude API-powered
  - Sends board state + legal moves to Claude
  - Claude evaluates positions and picks best move
  - Understands jan strategy, prime building, forcing
- [ ] AI "thinking" animation / delay for realism
- [ ] Difficulty selector in game setup

**Deliverable:** All three AI levels playable, Master uses Claude API reasoning.

---

### 🔲 Phase 6 — Game Modes & UX Polish
**Goal:** All game modes, complete UX.

- [ ] **Local 2-player** (pass & play with screen flip or shared screen)
- [ ] **vs AI** (choose difficulty)
- [ ] **Random opponent** (random AI difficulty — simulates online matchmaking feel)
- [ ] Game setup screen: player names, mode, match length, language
- [ ] Move history / log (in Swedish or English)
- [ ] Undo last move (local play only)
- [ ] Rules reference panel (collapsible, full Vasamuseet rules summary)
- [ ] Animations: dice roll, checker movement, hit to bar
- [ ] Sound effects (optional toggle): dice, checker clack, win fanfare
- [ ] Mobile-friendly layout

**Deliverable:** Feature-complete, polished app ready for real play.

---

## Bilingual Support (SV / EN)
All UI text, labels, win type names, and rules reference available in both Swedish and English. Toggle button in header. Default language: Swedish.

| English | Swedish |
|---|---|
| Home | Hem |
| Bar | Baren |
| Bear off | Bära av |
| Blot | Ensam pjäs |
| Closed point | Stängd punkt |
| Prime | Rad |
| Handsome game | Vackert spel |
| Single crown | Enkla kronan |
| Double crown | Dubbla kronan |
| Staircase | Trappan |
| Tower | Tornet |
| Jan | Jan |
| Forced jan | Tvingad jan |
| Monk | Munk |
| Junker | Junker |
| Bearing off | Bära av |

---

## Backend Roadmap

### Stack
- **Frontend**: React (Vite build) → hosted on Render.com static site
- **Backend**: Node.js + Express + WebSockets (ws library)
- **Database**: Redis (game state, sessions) + PostgreSQL (persistent data: users, match history, ELO, tournaments)
- **Auth**: OAuth only — no password storage. Providers: Google + GitHub (via Passport.js or Auth.js)
- **Repo**: GitHub → auto-deploy to Render.com on push
- **Domain**: `brade.ershag.se` (CNAME to Render)
- **Security**: HTTPS everywhere, JWT (short-lived) + refresh tokens in httpOnly cookies, CORS locked to domain, rate limiting on all endpoints, input validation, Redis session expiry, no secrets in repo (environment variables only)

---

### Phase 7 — Project Setup & Infrastructure
**Goal:** Repo, hosting, CI/CD pipeline, domain.

- [ ] Create GitHub repo (`brade`) with monorepo structure:
  ```
  /client   ← Vite React frontend
  /server   ← Node.js backend
  ```
- [ ] Set up Render.com:
  - Web Service for Node.js backend
  - Static Site for React frontend
  - Redis instance (Render managed Redis)
  - PostgreSQL instance (Render managed Postgres)
- [ ] Environment variables configured in Render dashboard (never in code)
- [ ] GitHub Actions CI: lint + test on every push, deploy on merge to `main`
- [ ] Configure `brade.ershag.se` DNS: CNAME → Render frontend URL
- [ ] HTTPS enforced (Render handles TLS automatically)
- [ ] Set up `.env.example` with all required keys documented

**Deliverable:** Deployed skeleton app at `brade.ershag.se`, CI/CD running.

---

### Phase 8 — Auth (OAuth only)
**Goal:** Secure login via Google and GitHub. No passwords stored, ever.

- [ ] Auth.js (formerly NextAuth) or Passport.js with Google + GitHub strategies
- [ ] On first login: create user record in PostgreSQL (oauth_provider, oauth_id, display_name, avatar_url)
- [ ] Session: short-lived JWT (15 min) + refresh token stored in httpOnly, Secure, SameSite=Strict cookie
- [ ] CSRF protection on all state-changing endpoints
- [ ] User can set a display name / avatar after first login
- [ ] Logout invalidates refresh token server-side
- [ ] No PII beyond what OAuth provides; no email stored without explicit consent

**Deliverable:** Login with Google/GitHub, persistent session, user profile page.

---

### Phase 9 — Game Rooms & Invitations
**Goal:** Create a game, invite opponent via link or in-app.

- [ ] `POST /api/games` → creates game room, returns unique invite link: `brade.ershag.se/game/ABC123`
- [ ] Room settings: match length (1/3/5/7), time control (optional future), public/private
- [ ] Invite link shareable externally — recipient clicks link, joins room
- [ ] In-app invite: search for player by display name, send invite notification
- [ ] Room lobby shows: both players connected, settings, ready/start button
- [ ] Game rooms stored in Redis with TTL (auto-expire abandoned games after 24h)
- [ ] Spectator mode: additional users can join room as observers (read-only state)

**Deliverable:** Create game → share link → opponent joins → game starts.

---

### Phase 10 — WebSocket Game Server
**Goal:** Server is authoritative game state. Clients send intentions, server validates and broadcasts.

- [ ] WebSocket server with room-based channels
- [ ] All game logic (genMoves, applyMoveToState etc.) runs on server — client is display only
- [ ] Message protocol:
  ```
  Client → Server:  ROLL | MOVE {from, to, die} | PASS | RESIGN
  Server → Client:  STATE {gameState} | ERROR {msg} | GAME_OVER {result}
  ```
- [ ] Server validates every move against legal moves before applying
- [ ] Reconnection: client sends room ID + JWT → server replays current state
- [ ] Disconnect handling: grace period (60s) before opponent can claim forfeit
- [ ] Anti-cheat: server never trusts client dice rolls — server rolls dice
- [ ] Move timestamps stored for audit log

**Deliverable:** Full real-time multiplayer, server-authoritative, reconnect-safe.

---

### Phase 11 — Server-Side AI Opponents
**Goal:** Let authenticated users play against a bot directly from the lobby, no second player required.

- [ ] `POST /api/games` accepts `opponent: "ai"` + `aiDifficulty: "beginner" | "journeyman" | "master"`
- [ ] Server creates the room and immediately occupies the black seat with a virtual AI user (stored as a `system` user in the DB)
- [ ] AI move loop runs server-side inside the WebSocket handler — no client connection needed for the AI:
  - **Beginner**: picks a random legal move with a short random delay (0.5–1.5 s)
  - **Journeyman**: heuristic evaluation — prefers hitting blots, building closed points, advancing the back checker; avoids leaving blots; uses the higher die when forced to discard
  - **Master**: calls the Claude API (`claude-haiku-4-5`) with a compact board representation + legal moves; Claude returns the chosen move; falls back to Journeyman on API error
- [ ] AI rolls dice server-side immediately after the human's turn ends (no ROLL message needed)
- [ ] `GET /api/games/:roomId` returns `isAi: true` so the client can hide the invite / ready flow and go straight to the board
- [ ] Home page shows "Play vs AI" button with difficulty selector alongside "Create Game"
- [ ] AI games count toward ELO and match history (separate ELO column `elo_vs_ai` optional future)
- [ ] Rate-limit Master AI calls: max 1 concurrent Claude request per user

**Deliverable:** Single-player mode — click "Play vs AI", choose difficulty, game starts immediately.

---

### Phase 12 — Match History & ELO
**Goal:** Persistent stats, rating system, player profiles.

- [ ] PostgreSQL schema:
  ```
  users         (id, oauth_provider, oauth_id, display_name, avatar, elo, created_at)
  games         (id, white_id, black_id, winner_id, win_type, monk, white_score, black_score, started_at, ended_at)
  moves         (id, game_id, color, from_pt, to_pt, die, force, timestamp)
  ```
- [ ] ELO rating system (K=32 standard, separate rating for each AI difficulty eventually)
- [ ] Player profile page: ELO, W/L record, win type breakdown, recent games, head-to-head
- [ ] Match history: full replay from stored moves (step through game move by move)
- [ ] Leaderboard: top players by ELO, filterable by time period

**Deliverable:** Full stats, ELO ratings, game replay, leaderboard.

---

### Phase 13 — Matchmaking
**Goal:** Find a random opponent automatically.

- [ ] Matchmaking queue in Redis: players join queue with ELO range preference
- [ ] Server pairs players within ±200 ELO, expanding range every 30s
- [ ] Queue position / estimated wait shown in UI
- [ ] Maps to existing "Random opponent" button in the setup screen

**Deliverable:** One-click matchmaking against real opponents.

---

### Phase 14 — Tournaments (future)
**Goal:** Organised tournament play — natural fit for Medeltidsdagar and online championships.

- [ ] Tournament types: single elimination, round robin, Swiss system
- [ ] Tournament admin creates bracket, sets match length and time control
- [ ] Players register → seeded by ELO
- [ ] Automated bracket advancement on match completion
- [ ] Tournament leaderboard and results page
- [ ] Perfect for running a digital Bräde-SM alongside Vasamuseet's championship

**Deliverable:** Full tournament system ready for competitive play.

---

## Security Checklist (applies to all phases)
- OAuth only — zero passwords stored
- httpOnly + Secure + SameSite=Strict cookies for refresh tokens
- JWT expiry: 15 minutes access, 7 days refresh
- CORS: locked to `brade.ershag.se`
- Rate limiting: login (10/min), API (100/min), WS messages (30/sec)
- All inputs validated and sanitised server-side
- No secrets in code — all via environment variables
- Redis keys namespaced and TTL-expiring
- PostgreSQL: parameterised queries only (no string interpolation)
- HTTPS enforced, HSTS header set
- Dependency audit in CI pipeline (`npm audit`)
- Logs: no PII in logs, structured JSON logging

---

## Development Log

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Board & Visual Foundation | ✅ Done | Wooden colours, starting position, language toggle |
| Phase 2 — Movement Engine | ✅ Done | Dice, legal moves, bar, closing/huk rules, animations |
| Phase 3 — Win Conditions & Scoring | ✅ Done | All 7 win types, monk, bear-off, match score |
| Phase 4 — Five-Prime & Forcing | ✅ Done | Forceable points, forced jan, junker, visual cues |
| Phase 5 — AI Opponents | ✅ Done | Beginner/Journeyman/Master, AI dice display, move animation |
| Phase 6 — UX Polish & Game Modes | ✅ Done | Move log, rules reference, undo, match length, random opponent |
| Phase 7 — Infrastructure & CI/CD | ✅ Done | |
| Phase 8 — OAuth Auth | ✅ Done | |
| Phase 9 — Game Rooms & Invitations | ✅ Done | |
| Phase 10 — WebSocket Game Server | ✅ Done | |
| Phase 11 — Server-Side AI Opponents | ✅ Done | Beginner/Journeyman/Master (Claude Haiku), auto-play loop, ELO vs AI |
| Phase 12 — Match History & ELO | ✅ Done | Profile page with game history, ELO deltas, leaderboard |
| Phase 13 — Matchmaking | ⏳ Pending | |
| Phase 14 — Tournaments | ⏳ Pending | |