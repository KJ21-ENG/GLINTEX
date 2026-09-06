# Repository Guidelines

## Project Structure & Module Organization
- Root `package.json` and `docker-compose.yml` orchestrate both workspaces.
- `apps/frontend`: Vite + React SPA. Shell: `src/features/root/InventoryApp.jsx`. Screens: `src/pages` (Inbound, Stock, Receive, Settings). Helpers: `src/utils`.
- `apps/backend`: Express + Prisma. Middleware: `src/app.js`. Entry: `src/server.js`. Routes: `src/routes/index.js`. Models: `prisma/`.
- Supporting folders: `docker/` (helpers), `docs/` (reference), `temp_ref/` (temporary imports). Seeds (including `glintex_shadow`) run via `docker/postgres-init.sql`.

## Where to Start
- UI work: start in `apps/frontend/src/pages`, then trace shared logic in `apps/frontend/src/utils`.
- API work: start in `apps/backend/src/routes/index.js`, then follow handlers into `apps/backend/prisma`.

## Architecture Overview
- Frontend calls backend REST endpoints via the Vite dev proxy in local development.
- Backend boots in `apps/backend/src/server.js`, wires middleware in `src/app.js`, registers routes from `src/routes`, and uses Prisma for Postgres.
- Seeds load on container init; WhatsApp hooks run alongside the backend in dev.
- Example local flow: `apps/frontend` → `apps/backend/src/routes` → Prisma → Postgres.

## Build, Test, and Development Commands
- `npm install`: install dependencies for both workspaces.
- `npm run dev:backend`: start backend on `http://localhost:4000` (Prisma + WhatsApp hooks).
- `npm run dev:frontend`: start Vite on `http://localhost:5173` with API proxying.
- `npm run build`: build frontend and backend; output in `apps/frontend/dist`.
- `docker compose up -d`: start Postgres + services; `docker compose logs -f backend` for migrations; `docker compose down -v` resets volumes.

## Data Resolution Rules
- **Cut tracing (default):** When displaying or summarizing Cut for any stage that depends on upstream flow (especially coning), prefer tracing from Coning Issue → `receivedRowRefs` → Holo Receive rows → Holo Issue (and cutter lineage if needed). Only fall back to `IssueToConingMachine.cutId` when trace data is unavailable (e.g., opening stock).

## Coding Style & Naming Conventions
- JavaScript/TypeScript, 2-space indentation; prefer `async/await` and descriptive helpers (e.g., `handleIssueSave`, `normalizeReceiveCsv`).
- React components use PascalCase; hooks/utilities use camelCase.
- Keep Tailwind classes inline in JSX; pass process-aware props to separate logic.
- Sort imports external before local. Formatting is manual (no enforced linter yet).

## Testing Guidelines
- No automated test suite currently; validate via manual flows (lot creation, issue, receive).
- If adding tests, prefer Jest or Vitest, colocate in `__tests__` near modules, and use descriptive filenames.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, etc.) with subjects <=72 characters; add a body when helpful.
- PRs should describe the change, list manual verification steps, link related issues, and include screenshots for UI changes.

## Security & Configuration Tips
- Keep secrets in `apps/backend/.env` (never commit). Update `DATABASE_URL`, WhatsApp credentials, and `BARCODE_MATERIAL_CODE`.
- For a clean database, drop the `postgres-data` volume with `docker compose down -v` and let seeds reapply.

<!-- project-workflow:start -->
# Project workflow coordination

Read `.agent/project.yaml` at session start. If it selects Advanced, also read `.agent/workflows.yaml`, active `.agent/tasks/*/task.json` capsules, and recent `.agent/sessions/*.json` handoffs. Treat ledger entries as claims and verify them against Git, the working tree, CI, live provider state, and current external state.

Use the exact provider-native session ID printed by the lifecycle briefing for task and checkpoint commands. If multiple same-provider sessions overlap, never guess or reuse another session's ledger.

If the mode is unselected, analyze read-only and ask the user to choose Advanced (recommended/default) or Normal before material mutations. Normal retains minimal logging and global safety but does not impose workflow phases or capsules. An Advanced project may use a Normal override for one session without changing the shared project choice.

For substantial Advanced work, create a task capsule with declared scope, preserve pre-existing changes, checkpoint task-owned files and validation, record repeatable workflow gaps, and log external actions separately. Only the named steward approves workflow evolution. Never silently change authority, security, deployment, production, finance, or payment policy.

Use the global `project-workflow` skill and CLI for selection, task capsules, checkpoints, semantic validation, repair, gaps, and approved evolution.
<!-- project-workflow:end -->
