# Cold-load correction evidence

Date: 2026-08-28

## Boundary

- Worktree: `/Volumes/MacSSD/Development/CursorAI_Project/GLINTEX-full-snapshot-remediation-20260827`
- Base and current commit before any authorized commit: `788258fb4909ef72310188ca592f53736ad49de6`
- Rehearsal database: `glintex_cold_load_20260828_perf_test`
- The database was created only for this rehearsal. No primary or production database was changed.
- Seed counts after the one-shot load included 15,000 Holo issues, 15,000 Holo receives, 6,003 Coning issues, 12,003 Coning receives, 2,000 lots, boiler logs, deleted rows, equal timestamps, take-backs, legacy barcodes, mixed lots, stale child lineage, and branching re-coning to depth three.
- The pagination, boiler, and active take-back indexes were applied and the migration script reported every required index valid.

## Separate list and summary contracts

The isolated database-backed route suite passed with separate On Machine and Stock lists returning `summary: null` and `summaryPending: true`, while their summary endpoints matched the inline compatibility totals. Stock grouping, exact mixed-lot keys, trace-first lineage, cursor stability, lazy lot expansion, facets, permissions, and response budgets also passed.

The initial combined database invocation ran route and mutation files concurrently against the same database. Two inline-versus-summary comparisons observed writes committed by the mutation file between their requests. Serial execution of the database-backed files, which is now enforced by the backend test scripts, passed. Mutation concurrency remains inside the relevant tests and is not serialized away.

## Repeated route measurements

Each route below was sampled sequentially 20 times through the Express application and PostgreSQL rehearsal database. The first hit, p95, and p99 are milliseconds.

| Route | First hit | p95 | p99 |
|---|---:|---:|---:|
| On Machine Cutter list | 138.8 | 43.8 | 138.8 |
| On Machine Holo list | 138.1 | 306.8 | 493.3 |
| On Machine Coning list | 498.7 | 362.6 | 498.7 |
| On Machine Cutter summary | 6.9 | 6.5 | 6.9 |
| On Machine Holo summary | 29.3 | 57.3 | 62.5 |
| On Machine Coning summary | 40.2 | 40.2 | 48.2 |
| Stock Cutter Jumbo list | 267.7 | 432.8 | 714.9 |
| Stock Cutter Bobbins list | 176.7 | 296.1 | 538.5 |
| Stock Holo list | 368.1 | 604.3 | 766.7 |
| Stock Coning list | 283.2 | 453.1 | 535.1 |
| Stock Cutter Jumbo summary | 194.7 | 203.5 | 209.1 |
| Stock Cutter Bobbins summary | 87.1 | 151.0 | 199.3 |
| Stock Holo summary | 263.6 | 299.1 | 303.7 |
| Stock Coning summary | 257.4 | 801.4 | 845.2 |

Four concurrent normal-page list requests completed in 698.6 ms. Every sampled routine response stayed below 500 KB. Source and action-detail responses stayed below 100 KB.

These local rehearsal measurements are below the API gates, so `ProcessLineageProjection` is not justified at this stage. The projection remains a mandatory fallback only if production-sized staging misses the same gates.

## Issue mutation load

| Mutation | Samples | p95 | p99 |
|---|---:|---:|---:|
| Holo Issue | 100 | 28.5 ms | 43.8 ms |
| Coning Issue | 100 | 125.0 ms | 212.0 ms |

The sampler excludes deleted source rows and rows whose parent issue is deleted. This keeps the load test focused on valid operational writes while preserving the production availability and lineage guards.

## Query-plan evidence

`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` was run against the representative Coning On Machine list, On Machine summary, stock groups, stock summary, and lot-row shapes after `ANALYZE` and index validation.

| Shape | Execution | Buffers and notable plan |
|---|---:|---|
| On Machine list | 39.862 ms | 636 shared-buffer hits; aggregate balances before top-N 51-row selection |
| On Machine summary | 13.248 ms | 630 shared-buffer hits; one aggregate over active issues, receives, and take-backs |
| Stock groups | 4.689 ms | 626 shared-buffer hits; hash aggregate then top-N 101 groups |
| Stock summary | 17.174 ms | 634 shared-buffer hits; exact active-row aggregate |
| Lot rows | 0.631 ms | 265 shared-buffer hits; `ReceiveFromConingMachineRow_issueId_isDeleted_idx` index scan |

The full commands are repeatable against the named isolated database. Sequential scans in the full-result aggregate shapes are expected at this fixture size and remain far below the measured gates. The bounded lot-row lookup uses the issue/deletion index.

## Final post-review rerun

After autoreview cycle 4 cleared all three review passes, the complete serial database-backed suite was rerun with the cold-load gate enabled. It completed 42 tests with 38 passed, 4 optional gates skipped by their explicit environment flags, and 0 failures. The optional parity and mutation-load gates were then run directly and both passed.

The final 20-sample cold-load measurements remained below every API gate. The slowest list or summary p95 was 337.6 ms and the slowest p99 was 378.2 ms. Four concurrent normal-page list requests completed in 205.1 ms.

| Mutation | Samples | p95 | p99 |
|---|---:|---:|---:|
| Holo Issue | 100 | 28.5 ms | 127.5 ms |
| Coning Issue | 100 | 25.3 ms | 32.5 ms |

The authoritative v2-versus-legacy row-set and totals parity gate passed after the final corrections. The optimized SQL remains comfortably below the projection fallback threshold, so no `ProcessLineageProjection` read model was added.

## Functional and local browser boundary

- Production frontend build: passed.
- Shared request-broker tests: passed, including one effective fetch per identical URL, Strict Mode remount reuse, and abort after the last consumer leaves.
- Local API probes and production preview were started from this isolated worktree.
- The visible Codex in-app Browser was already on `http://127.0.0.1:5173/login`, but the browser control policy rejected programmatic interaction with that local URL. No alternate browser surface was used as a workaround.
- Staging browser timing, Windows factory desktop proof, Android factory-device proof, deployment authorization, 60-minute observation, and 24-hour zero-snapshot evidence remain external release gates.

## Repeat commands

```sh
DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_cold_load_20260828_perf_test npx prisma db push --skip-generate
psql postgresql://kushjariwla@127.0.0.1:5432/glintex_cold_load_20260828_perf_test -v ON_ERROR_STOP=1 -f scripts/seedPerformanceRehearsal.sql
psql postgresql://kushjariwla@127.0.0.1:5432/glintex_cold_load_20260828_perf_test -v ON_ERROR_STOP=1 -f prisma/manual/apply_process_pagination_indexes.sql
TEST_PERFORMANCE_DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_cold_load_20260828_perf_test RUN_COLD_LOAD_ROUTE_GATE=1 node --test --test-concurrency=1 --test-name-pattern='cold-load list and summary' src/routes/__tests__/performanceRoutes.integration.test.js
TEST_PERFORMANCE_DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_cold_load_20260828_perf_test RUN_PERFORMANCE_PARITY=1 node --test --test-concurrency=1 src/routes/__tests__/performanceRoutes.integration.test.js
TEST_PERFORMANCE_DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_cold_load_20260828_perf_test RUN_PERFORMANCE_LOAD=1 node --test --test-concurrency=1 --test-name-pattern='issue POST latency' src/routes/__tests__/performanceRoutes.integration.test.js
```
