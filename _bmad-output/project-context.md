---
project_name: 'GLINTEX'
user_name: 'Kush'
date: '2026-02-15T20:42:58Z'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
existing_patterns_found: 0
status: 'complete'
optimized_for_llm: true
rule_count: 47
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- Monorepo: npm workspaces (`apps/frontend`, `apps/backend`)
- Backend: Node (Docker `node:20-bullseye`), Express `4.21.2`, Prisma `4.16.2`, Postgres client `17`, Chromium + `whatsapp-web.js 1.34.3`
- DB: Postgres `17-alpine`; requires `SHADOW_DATABASE_URL` and `glintex_shadow` DB
- Frontend: React `18.3.1`, React Router `6.30.2`, Vite `5.4.20`, Tailwind `3.4.18`
- Hosting/containers: backend runs migrations on start (`prisma migrate deploy`); frontend served by Nginx

## Critical Implementation Rules

### Language-Specific Rules (JavaScript / ESM)

- ESM only: keep `"type":"module"` assumptions; do not introduce `require()`/CommonJS.
- Backend imports should keep explicit file extensions (e.g. `import x from './x.js'`) to match existing patterns.
- Treat "JSON array" fields defensively: values may be `Array`, `null`, or a stringified JSON array; parse safely and default to `[]`.
- Frontend API calls: prefer `apps/frontend/src/api/client.js` helpers; keep `credentials: 'include'` behavior consistent and preserve 401 unauthorized event dispatch.

### Framework-Specific Rules (React)

- Routes are defined in `apps/frontend/src/app/router.jsx` and gated via `PermissionGate`; keep permission checks at the route boundary for new screens.
- Auth-protected shell uses `apps/frontend/src/app/ProtectedAppLayout.jsx`; preserve the `needsBootstrap` flow to `/setup` and unauthenticated redirect to `/login`.

### Framework-Specific Rules (Express)

- Backend entry is `apps/backend/src/server.js`; app wiring is in `apps/backend/src/app.js`; keep middleware registration centralized in `app.js`.
- Auth/permissions: use `apps/backend/src/middleware/auth.js` (`requireAuth`/`requirePermission`) and rely on `req.user.permissions` rather than re-implementing permission logic in handlers.

### Framework-Specific Rules (Prisma/Postgres)

- Prefer Prisma queries via `apps/backend/src/lib/prisma.js`; avoid raw SQL unless necessary.
- Respect soft-delete conventions (`isDeleted` + `deletedAt` + `deletedByUserId`) when adding new models/endpoints; default queries should exclude deleted records unless explicitly requested.

### Testing Rules

- No automated suite assumed: validate changes via manual smoke flows before considering work "done".
- Minimum smoke checklist (when touching related areas):
  - Auth: login/logout, session expiry handling (401 behavior in frontend), protected route redirects.
  - Permissions: `PermissionGate` route access for a non-admin role.
  - Core flows: Inbound create, Issue create, Receive create, Stock view, Opening Stock view.
  - Docker: backend starts and runs migrations; frontend loads and can call backend API.

### Code Quality & Style Rules

- Stick to existing formatting (manual, no enforced linter): 2-space indentation, match the surrounding file's quote style and import ordering.
- Prefer extending existing helpers/utilities rather than adding parallel implementations:
  - Frontend: `apps/frontend/src/utils/*`, `apps/frontend/src/api/*`
  - Backend: `apps/backend/src/utils/*`
- Keep Tailwind classes inline in JSX; use existing design tokens from `apps/frontend/src/index.css` + `apps/frontend/tailwind.config.js` (HSL CSS variables).
- When handling user/input data (CSV/barcodes/ids): follow existing normalization patterns (trim, uppercase where applicable, safe parsing).

### Development Workflow Rules

- Monorepo commands are workspace-scoped (root scripts delegate to `apps/frontend` / `apps/backend`).
- Local dev entrypoints:
  - Backend: `npm run dev:backend` (runs `apps/backend/src/server.js`)
  - Frontend: `npm run dev:frontend` (Vite)
- Docker compose is the reference environment for DB + migrations:
  - `docker compose up -d` starts Postgres 17 + backend (runs `prisma migrate deploy`) + nginx frontend.
- When changing Prisma schema: assume container startup depends on successful migrations; keep migrations deployable and backward-compatible when possible.

### Critical Don't-Miss Rules

- Cut tracing (default): for any stage that depends on upstream flow (especially coning), prefer tracing:
  - Coning Issue -> `receivedRowRefs` -> Holo Receive rows -> Holo Issue (and cutter lineage if needed).
  - Only fall back to `IssueToConingMachine.cutId` when trace data is unavailable (e.g., opening stock).
- Soft delete is the default: treat `isDeleted` rows as hidden unless an endpoint explicitly needs deleted records.
- Do not bypass auth/permissions:
  - Frontend: keep `PermissionGate` on protected routes/screens.
  - Backend: use `requireAuth`/`requirePermission` for protected endpoints.
- When parsing identifiers and imports: keep existing normalization conventions (trim/uppercase/safe JSON parsing) to avoid breaking CSV/barcode flows.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code.
- Follow all rules above; when in doubt, prefer matching existing patterns in nearby files.
- If you discover a new recurring gotcha, add a concise rule here.

**For Humans:**

- Keep this file lean and focused on agent mistakes, not general engineering advice.
- Update when stack/architecture changes (ports, auth, schema, major deps).

Last Updated: 2026-02-15T20:42:58Z
