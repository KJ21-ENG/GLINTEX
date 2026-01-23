# Project Restructure Plan

High-level objectives and TODOs tracked during the restructuring effort.

## 1. Document Current State
- [x] Capture current frontend + backend layout (files, responsibilities, pain points).
- [x] Inventory generated/backup folders that should be ignored or relocated (`dist/`, `temp_ref/`, etc.).
- [x] Note runtime/deployment requirements (Docker, Prisma migrations, WhatsApp dependencies).

## 2. Backend Modularization
- [x] Move backend project into `apps/backend` and update Docker/Compose paths.
- [x] Split Express bootstrap into `src/app.js` + `src/server.js` and relocate route handlers to `src/routes/index.js`.
- [x] Create `src/lib/prisma.js` and update utilities/scripts to consume the shared helper.
- [x] Point Nodemon scripts and the Docker entrypoint at the new server bootstrap.

## 3. Frontend Architecture Cleanup
- [x] Convert the repo to npm workspaces and move the SPA into `apps/frontend`.
- [x] Introduce a React Router shell (`src/app`) and relocate the legacy tabbed UI into `features/root`.
- [x] Sync tab navigation with router paths so URLs now mirror the active tab.
- [x] Remove ad-hoc backup files and route all entrypoints through the new shell.

## 4. Repository Hygiene & Tooling
- [x] Establish npm workspaces with root-level scripts for dev/build commands.
- [x] Update Docker Compose + README instructions to reflect the new structure.
- [x] Expand `.gitignore` to cover workspace build artifacts/backups.
- [x] Capture architecture notes and migration plans under `/docs`.
