# Repository Hygiene & Tooling Plan

Goal: ensure the monorepo stays clean, reproducible, and easy to work with after the architecture refactors.

## Workspace Structure

```
apps/
  frontend/   # Vite React app (moved from root)
  backend/    # Express/Prisma API (moved from /backend)
packages/
  shared/     # optional shared utilities/types (future)
```

- Use npm workspaces (or switch to pnpm) to manage dependencies:
  ```json
  {
    "private": true,
    "workspaces": [
      "apps/frontend",
      "apps/backend",
      "packages/*"
    ]
  }
  ```
- Move existing frontend files into `apps/frontend` and backend files into `apps/backend` once modularization is ready.

## Git Hygiene

- Update `.gitignore` to cover:
  - `apps/frontend/dist/`, `temp_ref/`, `apps/backend/backups/`, `*.log`, `.wwebjs_auth/`, `*.sqlite` (if added), `.DS_Store`.
  - `node_modules/` at both root and workspace scope.
- Remove committed build artifacts/backups from git history (or at least from working tree going forward).
- Store future datasets/backups outside repo (or use Git LFS if they must be tracked).

## Tooling & Automation

- **Linting/Formatting**
  - Add ESLint + Prettier configs per workspace with shared base config in root.
  - Consider TypeScript strictness for new modules.
- **Testing**
  - Define `npm run test` scripts (frontend: Vitest/Jest; backend: Jest/supertest) and ensure they run in CI.
- **CI/CD**
  - Add GitHub Actions (or equivalent) with jobs:
    - `lint` & `test` for frontend/backend in parallel.
    - `docker-build` (optional) to ensure images still build.
- **Docs**
  - Create `/docs/README.md` index referencing the architecture plans and keeping them updated.
  - Update root `README.md` after the restructure to explain workspace commands and deployment steps.

## Migration Steps

1. Introduce root `package.json` workspaces config.
2. Move frontend files into `apps/frontend`, update scripts and Dockerfile paths.
3. Move backend into `apps/backend`, adjust Docker build contexts + compose file.
4. Clean up `.gitignore`, remove tracked artifacts.
5. Add lint/test configs + CI workflows.
6. Document new structure in README and `/docs`.

Tracking this plan ensures the repo remains maintainable as the codebase grows.
