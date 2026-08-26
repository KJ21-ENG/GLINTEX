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

Read `.agent/project.yaml` at session start. If it selects Advanced, also read `.agent/workflows.yaml`, the active task capsule, and recent `.agent/sessions/*.json` handoffs. Verify session claims against Git and current state before relying on them.

If the mode is unselected, analyze read-only and ask the user to choose Advanced (recommended/default) or Normal before material mutations. Normal retains minimal logging and global safety but does not impose workflow phases or capsules. An Advanced project may use a Normal override for one session without changing the shared project choice.

Use the global `project-workflow` skill and CLI for selection, checkpoints, gaps, and approved evolution. Never silently change authority, security, deployment, production, finance, or payment policy.
<!-- project-workflow:end -->

## Environment and Release Protection

- Production is `main` at `https://app.glintex.in`, deployed from `/var/www/glintex-app` with compose project `glintex-app`. Treat production Git, containers, volumes, database, Nginx, DNS, integrations, and GitHub environment as read-only unless the user explicitly authorizes a production action.
- Employee staging is `release/dispatch-v2` at `https://staging.glintex.in`, deployed from `/var/www/glintex-staging` with compose project `glintex-staging`. It uses loopback frontend/backend ports `4273`/`4102`, its own internal network and PostgreSQL volume, HTTPS, HTTP Basic Auth, and application auth. Do not deploy `agent-api` in staging.
- Browser access remains behind Basic Auth by exchanging a successful gateway response for a short-lived `Secure`, `HttpOnly`, `SameSite=Strict` staging-only cookie. Keep its random token only in the mode-`600` VPS staging vhost; never place it in source, evidence, or another environment.
- Never push a feature release directly to `main`. Routine flow is feature branch to `release/dispatch-v2`, staging automation and employee feedback, a recorded release candidate, then a separate explicitly authorized production promotion.
- Before every database or business mutation, prove `current_database()`, role, host, and port against the expected environment. For staging migrations use `APP_DIR=/var/www/glintex-staging docker/staging/migrate.sh`; do not run Prisma commands that may implicitly load `apps/backend/.env`.
- Retain the staging database after employee testing. Do not reset it to the green fixture state. Take a verified pre-deploy backup and record its SHA-256 before each staging deployment. The retained local green database remains reference-only and must never be mutated.
- Staging must set `GLINTEX_RUNTIME_MODE=staging` and `EXTERNAL_INTEGRATIONS_DISABLED=true`. WhatsApp, Telegram, Google Drive, email/notification delivery, schedulers, stored recipients/tokens/sessions, and owner-agent actions must remain disabled and sanitized. Never copy production credentials or WhatsApp auth into staging.
- Secrets live only in restrictive VPS files, GitHub's `staging` environment, and the operator's secure credential store. Never commit `.env.staging`, password files, `.htpasswd`, dumps, backups, auth state, QA evidence, recordings, screenshots, or build output.
- An urgent production hotfix starts from the exact deployed `production-*` baseline tag/SHA on `hotfix/<ticket>`, uses an isolated temporary production-like database/runtime, and receives targeted regression evidence. Only explicit user production authorization permits backup, promotion to `main`, and deployment. Immediately forward-port the same fix to `release/dispatch-v2`, redeploy staging, record both SHAs, and remove temporary resources.
- Required rollout evidence includes exact Git/deploy SHA, DB identity and migration status, backup hash/size, compose health, Nginx/TLS checks, protected public readiness, authenticated browser smoke, external-integration proof, and before/after production preservation.

See `docs/dispatch-v2-staging-and-release-runbook.md` for exact deployment, rollback, employee-access, and hotfix procedures.
