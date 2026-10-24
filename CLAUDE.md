# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Bräde** is an online multiplayer implementation of Svenskt Bräde (Swedish Tables), a backgammon variant. Live at https://brade.ershag.se.

## Commands

### Server
```bash
cd server
npm run dev       # development with --watch
npm start         # production
npm run lint      # ESLint
npm test          # Jest (--experimental-vm-modules)
```

### Client
```bash
cd client
npm run dev       # Vite dev server (localhost:5173)
npm run build     # production build → dist/
npm run lint      # ESLint
```

### Local dev prerequisites
```bash
# Start Postgres and Redis (Docker)
docker run -d -p 5432:5432 -e POSTGRES_DB=brade -e POSTGRES_PASSWORD=dev postgres:16
docker run -d -p 6379:6379 redis:7

# Run DB migrations
psql postgresql://postgres:dev@localhost:5432/brade -f server/src/db/migrations/001_init.sql
```

## Architecture

### Layout
- `server/` — Node.js/Express backend (ES modules, `"type": "module"`)
- `client/` — React 18 + Vite SPA

### Auth flow
1. User clicks OAuth button → redirected to `/auth/google` or `/auth/github`
2. Passport callback issues a short-lived JWT + httpOnly refresh token cookie
3. Server passes the access token in the URL **fragment** (`#token=...`) — never in query string
4. `AuthCallback.jsx` extracts the token, stores in `sessionStorage`, strips the fragment
5. WebSocket connections authenticate by passing the JWT in the query string (`?token=...&room=...`)
6. Refresh tokens are stored in Redis and checked on `/auth/refresh`; revoked on `/auth/logout`

### Data flow
- **Game state** is kept in Redis during play (24h TTL); written to PostgreSQL on completion
- **REST API** (`/api/games`, `/api/users`) is rate-limited to 100 req/min; auth endpoints to 10/min
- **WebSocket** (`/ws`) maintains a `Map<roomId, Set<{ws, userId}>>` room structure on the server
- The server is **authoritative**: dice rolls happen server-side; move validation is server-side

### Redis key namespaces (defined in `server/src/db/redis.js`)
| Key pattern | Contents | TTL |
|---|---|---|
| `room:{id}` | JSON game state | 24h |
| `room:{id}:players` | Set of player UUIDs | 24h |
| `refresh:{userId}` | Refresh token (for revocation) | 7d |
| `queue:match` | Sorted set for matchmaking | — |
| `invite:{id}` | Invite link metadata | 48h |

### Database schema (`server/src/db/migrations/001_init.sql`)
- **users** — UUID PK, OAuth provider+id (unique pair), display_name, avatar_url, ELO (default 1200), wins, losses
- **games** — UUID PK, 8-char room_id, white/black/winner UUIDs, ELO before/after, win_type, match_length
- **moves** — bigserial PK, game_id FK, sequence number, color, from_pt/to_pt (point 1–24, "bar", or "off"), die value

### Client dev proxy (Vite)
During development, `vite.config.js` proxies `/api`, `/auth`, and `/ws` to `localhost:3001`, so the client runs on `:5173` without CORS issues.

## Key conventions

- **Filename casing matters**: the server runs on Linux (Render). Import paths must match the actual filename case exactly (e.g., `ratelimit.js` not `rateLimit.js`).
- All DB queries go through `query(text, params)` in `server/src/db/postgres.js` — parameterized only, no string interpolation.
- Input validation uses Zod via the `validate(schema)` middleware factory in `server/src/middleware/validate.js`.
- `req.userId` is set by `requireAuth` middleware after JWT verification.
- Room IDs are 8 uppercase alphanumeric characters (e.g., `A3F9B2C1`).
- Server logging goes through `log.info/warn/error(msg, fields)` in `server/src/log.js`, not `console.*`. On Render it prints one JSON line per call. Include `userId` and `roomId` when known, so a player's problem can be found by searching Render's logs for their ID. Never log tokens, cookies, emails or full game state.

## Development workflow

Every change reaches `main` through a pull request that has been approved by an **independent reviewer**: a sub-agent that did not write the code and starts without the implementer's context.

1. **Implement** on a feature branch based on `origin/main`, one issue per branch and PR. When using sub-agents, give each its own git worktree. A fresh worktree has no `node_modules`, so run `npm ci` in `client/` and `server/` first. Before pushing, run the same checks as CI (`.github/workflows/ci.yml`, Node 24): `npm run lint` in both `client/` and `server/`, `npm test` and `npm audit --audit-level=high` in `server/`, and `npm run build` in `client/`. Open the PR with `Closes #N`; if there is no issue, the PR description is the spec.
2. **Review** with a fresh sub-agent that gets only the PR number, the issue, this file and any factual repo state it needs (e.g. a known CI failure on `main`), never the implementer's conversation, reasoning or report. The reviewer works in its own temporary worktree, never the main checkout and never with `gh pr checkout` (`git fetch origin +pull/<N>/head:review-<N> && git worktree add <scratch>/review-<N> review-<N>`; the `+` lets a re-review fetch a force-pushed PR). Afterwards it removes the worktree (`git worktree remove <scratch>/review-<N>`) and deletes the branch (`git branch -D review-<N>`), because git refuses to fetch into a branch that a leftover worktree still has checked out. It re-runs the checks, verifies the issue's acceptance criteria, and, when the PR touches rules text or rule logic, checks it against `docs/rules/nya-svenska-bradspelsregler.pdf`. It returns APPROVE or REQUEST_CHANGES with findings ranked blocker / should-fix / nit, and must not push, commit or comment on GitHub.
3. **Fix** findings on the same branch (the implementer can do this), then review again with a *new* independent reviewer. Repeat until approved.
4. **Merge** only after an APPROVE **and** green CI (`gh pr checks <N> --watch`; right after a push it may say "no checks reported", so wait until the checks appear and finish, and don't read that as passing), using `gh pr merge <N> --merge --delete-branch`. `main` has no branch protection and merging deploys to production (see Deployment), so never merge unreviewed, REQUEST_CHANGES or red PRs. There are no exceptions: if a check also fails on `main` (e.g. a new `npm audit` advisory), don't fix it inside an unrelated PR. Open or reference an issue for it, fix that issue first through this same workflow, then re-run the blocked PR's checks.
5. **Follow up**: file pre-existing bugs and leftover nits the reviewer found as separate issues instead of widening the PR. Remove merged worktrees with `git worktree remove <path>`, prune any stale worktrees with `git worktree prune`, and run `git branch -D <branch>` for their local branches.

Rule discrepancies between the engine and the official rules are tracked in `docs/rules/audit.md` and issues labelled `rules`.

## Environment variables

Copy `server/.env.example` → `server/.env` and `client/.env.example` → `client/.env`. Required server vars: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `CLIENT_ORIGIN`, `COOKIE_SECRET`.

## Deployment

Render.com watches the `main` branch and auto-deploys:
- **Web service** (`brade-server`): root dir `server`, build `npm install`, start `npm start`
- **Static site** (`brade-client`): root dir `client`, build `npm install && npm run build`, publish `dist`
