# Review 2 remediation evidence

Captured: 2026-08-27 Asia/Kolkata

This is local implementation evidence only. Staging, factory-device proof,
production deployment authorization, and the 24-hour production observation
gate remain separate and incomplete.

## Review disposition

The cumulative reviewer reported 35 findings. The current worktree already
contained corrections for the Docker build and migration layout, production
database override, runtime volume paths, SSE compression exclusion, transaction
locks, stock weight caps and trace-first lineage, complete exports, lazy-detail
generation guards, mutation balance propagation, deployment provenance and
health checks, invalid-index retry, and safe performance-log parsing.

This pass closed the two remaining normal-journey gaps:

- Inbound and Dispatch no longer call the deprecated process module after a
  mutation. They update their targeted state and emit background invalidations.
- Issue, Receive, and On Machine facets now return process-relevant masters
  only. `addedBy` is derived from actors who actually authored rows in that
  stage rather than exposing the complete username directory.

## Fresh rehearsal database

- Database: `glintex_snapshot_remediation_review2_20260827_perf_test`
- Host: local PostgreSQL on `127.0.0.1:5432`
- Boundary guard: all integration suites reject names without `_perf_test`.
- Applied: all 39 Prisma migrations and the guarded online index script.
- Seeded: 2,000 lots, 15,000 Holo issues, 15,000 Holo receives, 6,000 Coning
  issues, and 12,000 Coning receives.

## Validation results

- Backend unit suite: 124 passed, 4 gated/skipped, 0 failed.
- Frontend production build: passed.
- `node --check` for both route modules: passed.
- `git diff --check`: passed.
- Production Compose merge validation: passed. The local Docker daemon was not
  running, so image execution remains an environment gate.
- Fresh production-scale route suite: 9 passed, 0 skipped, 0 failed.
- Full Holo and Coning cursor row-set/totals parity: passed.
- Database-backed concurrency suite: 6 passed, 0 failed.
- Holo Issue load run: 100 samples, p95 7.7 ms, p99 26.3 ms.
- Coning Issue load run: 100 samples, p95 18.1 ms, p99 25.6 ms.
- Stage-facet privacy and process-master assertions: passed.

## Source fingerprint

The sorted SHA-256 manifest of every modified or untracked product, test,
deployment, and runbook file, excluding `.agent/**` and `qa-evidence/**`, was:

`ab40d3d2066508daa9b74c101346a38fa38ab6b47222a0f896aae531b1bcd9b2`

The fingerprint is evidence for this exact uncommitted local state. Any later
product change requires recomputing it.
