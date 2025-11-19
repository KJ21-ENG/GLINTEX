# Repository Guidelines

## Project Structure & Module Organization
- `apps/frontend` is the Vite + React SPA. `src/features/root/InventoryApp.jsx` hosts the tab shell, while `src/pages` holds the main screens (Inbound, Stock, Receive, Settings) and `src/utils` houses shared helpers.
- `apps/backend` runs Express + Prisma. `src/app.js` configures middleware, `src/server.js` boots the HTTP/WhatsApp server, and `src/routes/index.js` defines REST handlers on top of Prisma models in `prisma/`.
- Container helpers live in `docker/`, docs in `docs/`, and temporary imports in `temp_ref/`. Work from the repo root since `package.json` and `docker-compose.yml` orchestrate both workspaces.

## Build, Test, and Development Commands
- `npm install` (root) installs both workspaces via the shared lockfile.
- `npm run dev:backend` starts the backend (Express, Prisma, WhatsApp hooks) on `http://localhost:4000`.
- `npm run dev:frontend` runs Vite on port 5173 and proxies API calls to the backend.
- `npm run build` compiles both workspaces; inspect `apps/frontend/dist`.
- `docker compose up -d` spins up Postgres, backend, and frontend containers; use `docker compose logs -f backend` for Prisma/migration details.
- `docker compose down -v` removes volumes when you need a fresh database.

## Coding Style & Naming Conventions
- JavaScript/TypeScript uses 2-space indentation, `async/await`, and descriptive helpers (`handleIssueSave`, `normalizeReceiveCsv`). Keep exports named when practical.
- React components follow PascalCase; hooks/utilities use camelCase. Keep styling (Tailwind classes) inside JSX and separate logic by passing process-aware props (e.g., `process`, `units`).
- Sort imports (external before local) and rely on manual formatting—there is no enforced lint yet.

## Testing Guidelines
- No automated tests exist yet. Validate changes via the dev servers (`npm run dev:*`) and manual flows (lot creation, issue, receive). If you add tests, follow Jest/Vitest conventions, colocate them with the module (`__tests__` folders), and keep names descriptive.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, etc.) as seen in history, keep subjects ≤72 characters, and add a body for clarity when needed.
- PRs must describe the change, list manual verification steps (Docker commands, API calls), link related issues, and include screenshots only when the UI changes visibly.

## Security & Configuration Tips
- Store secrets in `apps/backend/.env` (never committed). Update `DATABASE_URL`, WhatsApp creds, and `BARCODE_MATERIAL_CODE` before running the stack.
- Postgres seeds (including `glintex_shadow`) run via `docker/postgres-init.sql`; drop the `postgres-data` volume with `docker compose down -v` whenever you need a clean slate.
