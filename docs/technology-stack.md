# Technology Stack

| Part | Category | Technology | Version/Notes | Evidence |
|---|---|---|---|---|
| frontend | Runtime | Node.js | workspace-managed | `apps/frontend/package.json` |
| frontend | UI | React | `^18.3.1` | `apps/frontend/package.json` |
| frontend | Build | Vite | `^5.4.0` | `apps/frontend/package.json` |
| frontend | Styling | Tailwind CSS | `^3.4.9` | `apps/frontend/package.json`, `apps/frontend/tailwind.config.js` |
| frontend | Routing | React Router | `^6.30.2` | `apps/frontend/src/app/router.jsx` |
| backend | Runtime | Node.js | image: `node:20-bullseye` | `apps/backend/Dockerfile` |
| backend | API | Express | `^4.18.2` | `apps/backend/package.json`, `apps/backend/src/app.js` |
| backend | ORM | Prisma | `^4.x` | `apps/backend/package.json`, `apps/backend/prisma/schema.prisma` |
| backend | DB | PostgreSQL | container `postgres:17-alpine` | `docker-compose.yml` |
| backend | Auth | Cookie + session token | custom middleware | `apps/backend/src/middleware/auth.js`, `apps/backend/src/utils/auth.js` |
| backend | Messaging | WhatsApp Web API | GitHub dependency | `apps/backend/package.json`, `apps/backend/src/routes/index.js` |
| local-print-service | Runtime | Node.js | standalone service | `apps/local-print-service/package.json` |
| local-print-service | API | Express + CORS | print bridge | `apps/local-print-service/server.js` |
| print-client | Runtime | Node.js + Rust | Tauri desktop | `apps/print-client/package.json`, `apps/print-client/src-tauri/Cargo.toml` |
| print-client | UI | React | `^19.1.0` | `apps/print-client/package.json` |
| print-client | Desktop shell | Tauri v2 | app bundle config present | `apps/print-client/src-tauri/tauri.conf.json` |

