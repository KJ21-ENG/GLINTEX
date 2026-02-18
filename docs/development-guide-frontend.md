# Development Guide - Frontend

## Start
- `npm run dev:frontend` (from repository root)

## Build
- `npm run build:frontend`

## Config
- `VITE_API_BASE`
- Feature flags: `VITE_FF_V2_STOCK`, `VITE_FF_V2_ISSUE_TRACKING`, `VITE_FF_V2_RECEIVE_HISTORY`, `VITE_FF_V2_OPENING_STOCK`, `VITE_FF_V2_ON_MACHINE`

## Notes
- Route-level permissions map directly to backend permission keys.
- For rollout sequencing, parity checks, and rollback procedure, follow `docs/PERFORMANCE_V2_ROLLOUT.md`.
