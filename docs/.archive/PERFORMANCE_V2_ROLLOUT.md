# Performance v2 Rollout and Verification Guide

## Overview
This rollout migrates heavy list screens from legacy module payloads to projection-backed v2 APIs with cursor pagination.

## Feature Flags
Set in frontend environment:

- `VITE_FF_V2_STOCK`
- `VITE_FF_V2_ISSUE_TRACKING`
- `VITE_FF_V2_RECEIVE_HISTORY`
- `VITE_FF_V2_OPENING_STOCK`
- `VITE_FF_V2_ON_MACHINE`

## Prerequisites
1. Run DB migrations.
2. Rebuild projections once.
3. Verify parity before exposing v2 to users.

Commands:

```bash
npm exec --workspace apps/backend prisma migrate deploy --schema prisma/schema.prisma
npm run projections:rebuild --workspace apps/backend
npm run projections:verify --workspace apps/backend
```

## Process-by-Process Rollout
Use this order:
1. Cutter
2. Holo
3. Coning

### Stage 1: Cutter
1. Enable only cutter operators in internal testing window.
2. Validate:
- Stock list loads quickly and matches legacy totals.
- Issue tracking rows, counts, and pending weight match legacy.
- Receive history row count and net-weight summary match legacy.
- Opening stock history entries match legacy for OP data.
3. Compare parity report (`/api/v2/admin/projections/verify?processes=cutter`).
4. If clean for 24h, proceed to Holo.

### Stage 2: Holo
Repeat same checklist with `processes=holo`.

### Stage 3: Coning
Repeat same checklist with `processes=coning`.

## Runtime Monitoring
Track these logs from v2 endpoints:
- `payloadBytes`
- `rows`
- `limit`
- `hasMore`

Alert thresholds:
- p95 > 700ms for 15 minutes
- projection verify `ok=false`

## Rollback
Instant rollback without deploy:
- set affected `VITE_FF_V2_*` flags to `false`

## Acceptance Checklist
- [ ] All v2 flags enabled for all users
- [ ] Projection verify passes across cutter/holo/coning
- [ ] No blocking user flow regressions for one full cycle
- [ ] Legacy heavy views no longer required for operational usage
