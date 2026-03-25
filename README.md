# Bräde

Online multiplayer implementation of Svenskt Bräde (Swedish Tables), based on the official rules of Vasamuseets Brädspelsvänner.

**Live:** [brade.ershag.se](https://brade.ershag.se)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Real-time | WebSockets (ws) |
| Game state | Redis |
| Persistent data | PostgreSQL |
| Auth | OAuth (Google + GitHub) via Passport.js |
| Hosting | Render.com |
| CI/CD | GitHub Actions → Render auto-deploy |

---

## Local Development

### Prerequisites
- Node.js 20+
- Docker (for local Redis + Postgres) or accounts on a cloud provider

### 1. Clone
```bash
git clone https://github.com/YOUR_USERNAME/brade.git
cd brade
```

### 2. Start local services
```bash
docker run -d -p 5432:5432 -e POSTGRES_DB=brade -e POSTGRES_PASSWORD=dev postgres:16
docker run -d -p 6379:6379 redis:7
```

### 3. Configure environment
```bash
cp .env.example server/.env
# Fill in your OAuth credentials and secrets
```

### 4. Start backend
```bash
cd server && npm install && npm run dev
```

### 5. Start frontend
```bash
cd client && npm install && npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:3001

---

## Deployment (Render.com)

1. Push repo to GitHub
2. Create on Render:
   - **Web Service** → `server/` → Build: `npm install`, Start: `npm start`
   - **Static Site** → `client/` → Build: `npm run build`, Publish: `dist/`
   - **Redis** → Render managed Redis (free tier)
   - **PostgreSQL** → Render managed Postgres (free tier)
3. Set all environment variables from `.env.example` in Render dashboard
4. Connect GitHub repo → auto-deploy on push to `main`
5. Set DNS: `brade.ershag.se` CNAME → your Render static site URL

---

## Security

- OAuth only — no passwords stored
- JWT access tokens (15 min) + httpOnly refresh cookies (7 days)
- Server-authoritative game state — clients never trusted for dice or move validation
- Rate limiting on all endpoints
- All SQL queries parameterised
- HTTPS enforced, HSTS enabled
- No secrets in repo — environment variables only

---

## Rules

Based on the official rules of Vasamuseets Brädspelsvänner (2003).  
Full rules available in-app in Swedish and English.