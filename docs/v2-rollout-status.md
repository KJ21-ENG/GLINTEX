# v2 Rollout Status

## Purpose
This file tracks rollout readiness and current enablement of performance v2 screens/endpoints.

## Authoritative Sources
- `docs/PERFORMANCE_V2_ROLLOUT.md` (process and acceptance checklist)
- `apps/frontend/src/api/v2.js` (frontend v2 consumers)
- `apps/backend/src/routes/v2.js` (backend v2 endpoint implementation)
- `apps/frontend/src/utils/featureFlags.js` and env (`VITE_FF_V2_*`) for exposure toggles

## Implemented v2 Surface
- Issue tracking (`/api/v2/issue/:process/tracking` + facets/export)
- Receive history (`/api/v2/receive/:process/history` + facets/export)
- Opening stock history (`/api/v2/opening-stock/:stage/history` + export)
- On-machine (`/api/v2/on-machine/:process`)
- Stock lot APIs (`/api/v2/stock/:process/lots`, `/lot-rows`, `/barcode-lot-keys`)

## Rollout Controls
- `VITE_FF_V2_STOCK`
- `VITE_FF_V2_ISSUE_TRACKING`
- `VITE_FF_V2_RECEIVE_HISTORY`
- `VITE_FF_V2_OPENING_STOCK`
- `VITE_FF_V2_ON_MACHINE`

## Process Rollout Sequence
1. Cutter
2. Holo
3. Coning

## Verification and Monitoring
- Run Prisma migrations before rollout.
- Rebuild and verify projections before broad enablement.
- Use parity endpoint pattern from rollout guide: `/api/v2/admin/projections/verify?processes=<process>`.
- Monitor endpoint payload/rows/limit/hasMore logs and latency thresholds from rollout guide.

## Current Status (Documentation Baseline)
- Implementation: Present in codebase.
- Enablement: Environment-dependent (feature-flag controlled).
- Operational acceptance state: must be tracked by team using rollout checklist in `docs/PERFORMANCE_V2_ROLLOUT.md`.

## Rollback
- Disable affected `VITE_FF_V2_*` flags.

