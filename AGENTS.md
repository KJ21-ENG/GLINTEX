# Repository Guidelines

## Project Structure & Module Organization
- `apps/frontend` is the Vite + React SPA; `src/features/root/InventoryApp.jsx` hosts the router-backed tab shell, and `src/pages/*` contain the visible screens (Inbound, Stock, Receive, Settings, etc.).
- `apps/backend` is an Express + Prisma API. `src/app.js` wires middleware, `src/server.js` boots the HTTP server plus WhatsApp integration, and `src/routes/index.js` defines every REST endpoint with helpers in `src/utils/` and `whatsapp/service.js`.
- `docker/` holds infra helpers (`postgres-init.sql`), while `docs/` captures architecture notes. Temporary import artifacts live under `temp_ref/` until cleaned up.
- Shared tooling (npm workspaces, Docker Compose) is orchestrated at the repo root (`package.json`, `docker-compose.yml`), so contributor commands typically run from `/Volumes/.../GLINTEX` root unless noted otherwise.

## Build, Test, and Development Commands
- `npm install --workspaces` – installs frontend/backend dependencies in lockstep.
- `npm run dev:backend` – starts Express/Prisma API on `http://localhost:4000`, powering `/api/*` routes and WhatsApp hooks.
- `npm run dev:frontend` – runs Vite dev server on `http://localhost:5173` and proxies API calls to the backend (adjust `VITE_API_BASE` as needed).
- `npm run build` / `npm run preview` – builds both workspaces and serves the static frontend via Vite preview.
- `docker compose up -d` – builds container images (Postgres, backend, frontend) and runs the full stack (`docker compose down -v` resets volumes).
- Use `docker compose logs -f backend` when you need to trace Prisma migrations, barcode generation, or WhatsApp statuses.

## Coding Style & Naming Conventions
- JavaScript/TypeScript files use 2-space indentation, `async/await`, and descriptive helper names (`handleSaveCart`, `parseReceiveCsvContent`). Keep exports named when possible.
- Frontend components follow PascalCase; hooks/utility files use camelCase. Backend routers use `Router` helpers and inline validation functions before hitting Prisma.
- Tailwind classes live in JSX; keep logic separate from styling by passing data via props (`{db}` object from `/api/db`).
- No automated lints are enforced yet, so tidy formatting manually and keep imports sorted (e.g., `import React...` before local modules).

## Testing Guidelines
- There are no automated unit or integration tests in the repo yet. Validate changes via the dev servers (`npm run dev:*`) and manually exercise key flows (lot creation, issue, receive, WhatsApp templates).
- If you add tests, align with Jest or Vitest conventions and place them next to the affected module (`apps/backend/src/__tests__`, `apps/frontend/src/pages/__tests__`) while keeping names descriptive (e.g., `ReceiveFromMachine.test.jsx`).

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes (`feat:`, `chore:`, `fix:`, etc.) as seen in recent history (`git log --oneline`). Keep the subject under 72 characters and add a brief body when the change is non-trivial.
- Pull requests should explain what feature/bug is addressed, list manual verification steps (storybook, API calls, Docker commands), and link to relevant issues or docs. Include screenshots only if the UI changed noticeably.

## Security & Configuration Tips
- Secret values live in `apps/backend/.env` (not committed). Update `BARCODE_MATERIAL_CODE`, `DATABASE_URL`, and WhatsApp credentials there before running Docker or `npm run dev:backend`.
- The Postgres container seeds `glintex_shadow` via `docker/postgres-init.sql`. Use the `postgres-data` volume to keep state and drop it only with `docker compose down -v` when you need a clean slate.
