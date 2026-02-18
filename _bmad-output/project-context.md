---
project_name: 'GLINTEX'
user_name: 'Kush'
date: '2026-02-18T17:31:38Z'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
existing_patterns_found: 12
status: 'complete'
optimized_for_llm: true
rule_count: 41
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- Monorepo root with npm workspaces for primary app parts (`apps/frontend`, `apps/backend`)
- Frontend: React `^18.3.1`, React Router `^6.30.2`, Vite `^5.4.0`, Tailwind `^3.4.9`
- Backend: Node ESM, Express `^4.18.2`, Prisma Client `^4.16.2`, Prisma CLI `^4.15.0`
- Database: PostgreSQL 17 (`postgres:17-alpine` via docker compose)
- Local print service: Express `^4.19.2`, CORS/body-parser
- Desktop print client: React `^19.1.0`, Vite `^7.0.4`, Tauri v2 (`@tauri-apps/*` + Rust `tauri = "2"`)
- Preserve v2 feature-flag compatibility controls: `VITE_FF_V2_STOCK`, `VITE_FF_V2_ISSUE_TRACKING`, `VITE_FF_V2_RECEIVE_HISTORY`, `VITE_FF_V2_OPENING_STOCK`, `VITE_FF_V2_ON_MACHINE`

## Critical Implementation Rules

### Language-Specific Rules

- Use ESM consistently (`import`/`export`); do not introduce CommonJS (`require`, `module.exports`).
- In backend code, keep explicit relative `.js` import extensions for local modules.
- Keep frontend API helper behavior consistent:
  - requests use `credentials: 'include'`
  - preserve 401 unauthorized event dispatch behavior.
- Parse mixed JSON payload fields defensively (array or stringified JSON), with safe defaults.
- Normalize barcode/id inputs before processing (trim; uppercase where applicable).
- Keep runtime startup/bootstrap side effects in `server.js` and middleware wiring in `app.js`.

### Framework-Specific Rules

- Route access must remain permission-gated via `PermissionGate` in `apps/frontend/src/app/router.jsx`.
- Keep auth flow consistency with `ProtectedAppLayout` and auth context (`/login` and `/setup` behavior).
- Prefer extending existing `src/components/common` and `src/components/ui` primitives over introducing parallel UI systems.
- Keep shared frontend state orchestration through existing contexts (`AuthContext`, `InventoryContext`) and existing refresh/load contracts.
- Keep API route registration centralized in `apps/backend/src/routes/index.js` and `apps/backend/src/routes/v2.js` (mounted via `app.js`).
- Enforce security with existing middleware (`requireAuth`, `requirePermission`, role/edit/delete variants); do not bypass in new handlers.
- Default backend read paths should honor soft-delete conventions (`isDeleted`) unless deleted records are explicitly required.
- Use Prisma via `apps/backend/src/lib/prisma.js`; only use raw SQL for established aggregation/performance paths when required.
- Keep v2 rollout behavior aligned with feature flags and parity workflow in `docs/PERFORMANCE_V2_ROLLOUT.md`.

### Testing Rules

- No full automated suite is guaranteed; always run targeted manual smoke tests for touched flows.
- For auth/permission changes:
  - verify login/logout/session expiry behavior
  - verify route-level permission gating and forbidden states.
- For inventory domain changes:
  - validate affected process path end-to-end (`inbound -> issue -> receive -> stock`) for relevant stage(s).
- For v2/performance path changes:
  - validate parity against legacy behavior for impacted screens/processes
  - verify feature-flag fallback behavior (`VITE_FF_V2_*` disabled path remains functional).
- For Prisma/schema changes:
  - ensure migrations apply cleanly and backend startup path remains valid.
- For print path changes:
  - validate local-print-service health, printer listing, and queue behavior with a real print attempt.

### Code Quality & Style Rules

- Match existing formatting/style in each file (manual formatting baseline; follow surrounding file conventions).
- Preserve naming patterns:
  - React components use `PascalCase`
  - hooks/helpers/utilities use `camelCase`
  - backend utility modules remain focused and single-purpose under `src/utils`.
- Keep imports grouped external before local and consistent with neighboring files.
- Do not duplicate utility logic:
  - frontend shared logic belongs in `apps/frontend/src/utils` or `apps/frontend/src/services`
  - backend shared logic belongs in `apps/backend/src/utils`.
- Preserve established module boundaries:
  - frontend: `pages/components/context/api`
  - backend: `routes/middleware/utils/lib`.
- Keep comments minimal and meaningful; avoid obvious comments and stale TODO clutter.

### Development Workflow Rules

- Use workspace-root scripts for primary frontend/backend development and builds.
- Treat Docker Compose as the canonical integration environment for DB-backed flows.
- For Prisma/schema-affecting changes, keep migrations deployable and aligned with container startup behavior.
- Keep environment-sensitive behavior explicit:
  - backend integration env vars (DB, WhatsApp, Drive, barcode material code)
  - frontend rollout flags (`VITE_FF_V2_*`) managed deliberately.
- For v2 changes, follow staged rollout and parity verification in `docs/PERFORMANCE_V2_ROLLOUT.md`.
- Keep docs synchronized when changing contracts; update `docs/index.md` references when primary technical docs are added/removed.

### Critical Don't-Miss Rules

- Do not bypass permission controls:
  - frontend must keep `PermissionGate` coverage for protected routes
  - backend endpoints must use existing auth/permission middleware.
- Do not ignore soft-delete semantics in backend queries; missing `isDeleted` filters can surface incorrect records.
- Preserve lineage/tracing behavior across cutter/holo/coning flows; avoid simplifying trace paths that break reconciliation.
- Do not treat v2 APIs as universally active:
  - keep code paths safe when feature flags are disabled
  - maintain parity assumptions with legacy views during rollout.
- Avoid introducing parallel API clients/state stores/components when established shared paths already exist.
- Do not change barcode/id normalization rules casually; these affect lookups, joins, and operational integrity.
- For print service changes, avoid unbounded queueing or bypassing rate-limiting safeguards.
- For deployment/runtime updates, preserve startup chain assumptions (migrations, service health dependencies, environment variables).

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code.
- Follow all rules above; when uncertain, prefer the more restrictive option that preserves existing behavior.
- Prefer existing project patterns over introducing new abstractions.
- Propose updates to this file when recurring implementation pitfalls are discovered.

**For Humans:**

- Keep this file lean and focused on non-obvious agent guidance.
- Update when technology versions, architecture boundaries, or rollout controls change.
- Remove rules that become obvious or obsolete.
- Re-check rule relevance when major modules are refactored.

Last Updated: 2026-02-18T17:31:38Z
