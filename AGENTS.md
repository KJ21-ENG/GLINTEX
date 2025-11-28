# Repository Guidelines

## Project Structure & Module Organization
- Work from the repo root; `package.json` and `docker-compose.yml` orchestrate both workspaces.
- `apps/frontend`: Vite + React SPA. Tab shell in `src/features/root/InventoryApp.jsx`; main screens in `src/pages` (Inbound, Stock, Receive, Settings); shared helpers in `src/utils`.
- `apps/backend`: Express + Prisma. Middleware in `src/app.js`, server entry in `src/server.js`, REST routes in `src/routes/index.js`, models in `prisma/`.
- `docker/` contains container helpers; `docs/` holds reference docs; `temp_ref/` is for temporary imports. Seeds (including `glintex_shadow`) run via `docker/postgres-init.sql`.

## Build, Test, and Development Commands
- `npm install` (root): installs dependencies for both workspaces via the shared lockfile.
- `npm run dev:backend`: start Express/Prisma + WhatsApp hooks at `http://localhost:4000`.
- `npm run dev:frontend`: run Vite on 5173 with API proxying to the backend.
- `npm run build`: compile frontend and backend; check artifacts in `apps/frontend/dist`.
- Docker: `docker compose up -d` to start Postgres + services; `docker compose logs -f backend` for Prisma/migration output; `docker compose down -v` to reset volumes.

## Coding Style & Naming Conventions
- JavaScript/TypeScript, 2-space indentation, prefer `async/await`, and descriptive helpers (e.g., `handleIssueSave`, `normalizeReceiveCsv`).
- React components use PascalCase; hooks/utilities use camelCase. Keep Tailwind classes inline in JSX and separate logic by passing process-aware props.
- Sort imports (external before local). Formatting is manual—no enforced linter yet.

## Testing Guidelines
- No automated test suite currently. Validate changes via `npm run dev:*` and manual flows (lot creation, issue, receive).
- If adding tests, prefer Jest/Vitest, colocate in `__tests__` next to modules, and name files descriptively.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, etc.) with subjects ≤72 characters; add a body when clarification helps.
- PRs should describe the change, list manual verification steps (e.g., Docker commands, API calls), link related issues, and include screenshots when UI changes are visible.

## Security & Configuration Tips
- Keep secrets in `apps/backend/.env` (never committed). Update `DATABASE_URL`, WhatsApp credentials, and `BARCODE_MATERIAL_CODE` before running the stack.
- For a clean database, drop the `postgres-data` volume with `docker compose down -v` and allow seeds to reapply.
