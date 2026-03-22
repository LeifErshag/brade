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

## Environment variables

Copy `server/.env.example` → `server/.env` and `client/.env.example` → `client/.env`. Required server vars: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `CLIENT_ORIGIN`, `COOKIE_SECRET`.

## Deployment

Render.com watches the `main` branch and auto-deploys:
- **Web service** (`brade-server`): root dir `server`, build `npm install`, start `npm start`
- **Static site** (`brade-client`): root dir `client`, build `npm install && npm run build`, publish `dist`
