# Current Project State

Snapshot of how GLINTEX is organized today. This acts as the reference before we start refactors outlined in `plan.md`.

## Repository Layout

- `package.json` – npm workspaces root with scripts to proxy into each app.
- `apps/frontend` – Vite + React SPA (public assets, Tailwind config, Dockerfile, etc.).
- `apps/backend` – Express + Prisma API (Dockerfile, Prisma schema/migrations, scripts, WhatsApp integration).
- `docs/` – architecture notes and refactor plans.
- `docker/` – infra assets shared by Compose (Postgres init script).
- `temp_ref/` – CSV/JSON dumps used during imports (still checked in for now).

## Frontend (Vite/React)

- Entry: `apps/frontend/src/main.jsx` renders `<App />` with Tailwind styles from `src/index.css`.
- Routing shell lives under `apps/frontend/src/app/`:
  - `App.jsx` wires `RouterProvider`.
  - `router.jsx` redirects `/` → `/app/inbound` and renders the legacy inventory UI for `/app/*`.
- The legacy UI now lives in `apps/frontend/src/features/root/InventoryApp.jsx`:
  - Still handles theming, brand settings, and CRUD handlers.
  - Tab navigation is now synchronized with React Router paths so bookmarks and reloads map back to the correct tab.
- Supporting structure mirrors the previous setup:
  - `src/pages/*`, `src/components/*`, `src/api`, `src/utils`, `src/services`, `src/context`.
  - Styling handled via Tailwind configuration local to the workspace.
- Docker build happens via `apps/frontend/Dockerfile` (nginx runner, Vite build stage).

## Backend (Express + Prisma)

- Located at `apps/backend`.
- `src/app.js` configures Express middleware, loads env vars, and mounts the API router.
- `src/server.js` starts the HTTP server and initializes WhatsApp.
- `src/routes/index.js` currently hosts all HTTP handlers (ported from the previous monolithic `index.js`).
- Shared helpers/services:
  - `src/lib/prisma.js` exports a Prisma client singleton.
  - `src/utils/*` (audit logger, barcode helpers, WhatsApp templates) reuse the lib client.
  - `whatsapp/service.js` manages puppeteer/LocalAuth sessions and outbound queueing.
  - `scripts/*.mjs` access Prisma via the new lib helper.
- Dockerfile installs Chromium deps, runs `npm ci`, `prisma generate`, and boots via `node src/server.js`.

## Generated / Backup / Large Folders

Currently tracked in git but slated for cleanup/relocation:

| Path | Notes |
| --- | --- |
| `temp_ref/` | CSV/JSON dumps, import payloads, SO overrides, etc. |
| `apps/backend/backups/` | Backup JSON files taken during data migrations. |
| `.wwebjs_auth/` (runtime) | WhatsApp auth data (created at runtime; ignored in git). |

## Tooling & Workflows

- npm workspaces manage frontend/backend dependencies from the repo root (`npm install --workspaces`).
- Root scripts proxy into each workspace (`npm run dev:frontend`, `npm run dev:backend`, etc.).
- Docker Compose uses the new workspace paths for build contexts.
- Architecture docs live under `/docs` (current state + backend/frontend repo hygiene plans).

This document should be updated as we continue modularizing the backend routes/services and extracting frontend features into standalone route modules.
