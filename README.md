# GLINTEX Inventory

Vite + React + Tailwind project of the GLINTEX Inventory app.

## Repo Layout

- `apps/frontend` – Vite + React client
- `apps/backend` – Express + Prisma API (with WhatsApp automation)
- `docker/` – shared infra assets (Postgres init SQL)
- `docs/` – architecture notes and plans

## Quick Start

```bash
npm install --workspaces
npm run dev:backend     # starts API on http://localhost:4000
npm run dev:frontend    # starts Vite on http://localhost:5173
```

The frontend expects the backend on port `4000` by default. Override `VITE_API_BASE` if you bind the API elsewhere.

## Docker

Spin up the entire stack (frontend, backend API, and PostgreSQL) with Docker:

```bash
docker compose build           # build frontend/backend images
docker compose up -d           # start db + backend + frontend
```

Services will be available at:

- Frontend: http://localhost:4173
- Backend API: http://localhost:4001 (set `BACKEND_PORT` if you need another host port)
- PostgreSQL 17: localhost:5433 (`glintex` / `glintex`) — override host binding via `POSTGRES_PORT`.

Environment knobs:

- `BARCODE_MATERIAL_CODE` – override the default `MET` code in generated barcodes.
- `VITE_API_BASE` – optional build arg that forces a specific API URL in the frontend bundle (defaults to `http://localhost:4001` to match `BACKEND_PORT`).
- `POSTGRES_PORT` – change the host port that Postgres binds to (container still listens on 5432).
- `BACKEND_PORT` – change the backend’s host port (container stays on 4000); set `VITE_API_BASE` accordingly if you override it.
- When running the `frontend-dev` service from `docker-compose.override.yml`, the Vite dev server binds to `http://localhost:6173`. Set `HOST_IP` to your LAN IP before `docker compose up` (e.g., `HOST_IP=192.168.0.50 docker compose up -d db backend frontend-dev`) so other devices can hit `http://<HOST_IP>:6173` and `http://<HOST_IP>:4001`.

Persistent data:

- Database storage lives in the `postgres-data` named volume.
- WhatsApp auth sessions persist in the `backend-whatsapp-auth` volume so you only need to scan the QR code once per environment.

Use `docker compose logs -f backend` to watch the API (and WhatsApp) logs, and `docker compose down -v` if you need to reset all state.

## Build

```bash
npm run build
npm run preview
```

## Notes

- Data, theme, and branding are stored in localStorage (`glintex_db_v1`, `glintex_theme`).
- Upload your logo from **Admin / Data → Branding**. A default logo is included at `/public/brand-logo.jpg`.
- All create/update/delete actions are now captured in the backend `AuditLog` table. After pulling these changes, run `cd apps/backend && npx prisma migrate dev` (or `prisma migrate deploy` in prod) so the new tables/columns (`AuditLog`, payload text) exist, then query them directly or via `npx prisma studio` for a full history of changes.
- **Barcode workflow:** every inbound roll now receives a barcode (`INB-MET-<lot>-<piece>`). Each issue transaction generates a single barcode (`ISM-MET-<lot>-<piece>`)—print as many stickers as needed at issue time and apply them to all crates born from that roll. The manual receive screen accepts that barcode to auto-fill the piece/lot and still prints the warehouse label (`REC-<lot>-<piece>-C###`) for finished goods. Stock rows expose printable barcode links, and `/api/barcodes/render?code=...` returns the image for any code.
- You can override the default material code (`MET`) used inside barcodes by setting `BARCODE_MATERIAL_CODE=XYZ` in `apps/backend/.env` before starting the server.
- Database migrations added for audit payload text and single-issue barcodes. Apply them with:
  ```bash
  cd apps/backend
  npx prisma migrate dev
  ```
  (Use `prisma migrate deploy` in production.)
