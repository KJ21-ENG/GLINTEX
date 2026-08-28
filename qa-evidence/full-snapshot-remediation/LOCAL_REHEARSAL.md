# Local production-scale rehearsal evidence

Captured: 2026-08-27 Asia/Kolkata

This is local implementation evidence. It does not replace staging browser capture, factory-network timings, Windows or Android proof, production authorization, or the 24-hour production observation gate.

## Proven database boundary

- Database: `glintex_snapshot_remediation_20260827_perf_test`
- User: `kushjariwla`
- Host: local Homebrew PostgreSQL on `127.0.0.1:5432`
- Engine: PostgreSQL 17.5
- Guard: the seed and integration suites reject any database whose name does not end in `_perf_test`.
- Migration result: all 39 existing Prisma migrations applied, followed by the idempotent online index script at `apps/backend/prisma/manual/apply_process_pagination_indexes.sql`.
- Docker image and container validation was not performed because the local Docker daemon was unavailable. `docker compose config --quiet` did pass.

The initial deterministic fixture loaded:

| Entity | Rows |
|---|---:|
| Lots | 2,000 |
| Holo issues | 15,000 |
| Holo receive rows | 15,000 |
| Coning issues | 6,000 |
| Coning receive rows | 12,000 |

The fixture also includes opening stock, mixed issue references, deleted rows, dispatched balances, legacy identifiers, take-backs, and deliberately equal timestamps. The repeatable guarded fixture is `apps/backend/scripts/seedPerformanceRehearsal.sql`.

## Real route measurements

The routes were exercised through the Express application with a real authenticated admin session and the production-scale PostgreSQL fixture. Timings are local and include application serialization. Bytes are the uncompressed response body, which is the stricter wire-budget comparison.

| Route | Status | Duration | Bytes |
|---|---:|---:|---:|
| Holo source lookup | 200 | 46.5 ms | 1,024 |
| Coning source lookup | 200 | 333.0 ms | 1,124 |
| Holo issue action detail | 200 | 29.5 ms | 7,026 |
| Holo receive action detail | 200 | 7.6 ms | 3,290 |
| Coning issue action detail | 200 | 19.1 ms | 9,265 |
| Coning receive action detail | 200 | 12.0 ms | 3,397 |
| Holo issue list, 200 rows | 200 | 244.7 ms | 295,293 |
| Holo receive list, 200 rows | 200 | 42.7 ms | 398,684 |
| Coning issue list, 200 rows | 200 | 84.0 ms | 296,959 |
| Coning receive list, 200 rows | 200 | 42.8 ms | 415,411 |
| Cutter stock groups, 100 groups | 200 | 526.6 ms | 93,841 |
| Holo stock groups, 100 groups | 200 | 313.0 ms | 116,881 |
| Coning stock groups, 100 groups | 200 | 1,618.4 ms | 86,308 |

Second cursor pages were also checked for duplicate IDs. Every ordinary response remained below 500 KB and every lookup/action response remained below 100 KB.

The generated Cutter detailed workbooks were parsed back with SheetJS. The Bobbin export contained its lazily fetched crate in the `Crates` sheet and the Jumbo export contained its lazily fetched piece in the `Pieces` sheet.

## Authoritative row-set and totals parity

The gated parity rehearsal walked every cursor page for Holo and Coning Issue Tracking and Receive History, then compared the complete returned ID sets and first-page summaries against authoritative non-deleted database records. It passed for:

- complete issue and receive row sets with no missing or extra IDs;
- total issue and receive row counts;
- Holo issued bobbin count and weight;
- Holo received roll count and weight;
- Coning issued roll count and weight derived from `receivedRowRefs`;
- Coning received cone count and net weight;
- Holo and Coning take-back count and weight.

The full parity walk completed in 4.53 seconds locally. Existing focused business tests continue to cover cut lineage, rate precedence, opening-stock classification, wastage, reversals, and legacy-reference behavior. Staging comparisons of stock grouping, barcode expansion, filtered exports, and live production-derived totals remain a release gate.

## Mutation latency and concurrency

One hundred successful POSTs per issue process were measured against the populated fixture:

| Mutation | Samples | p95 | p99 |
|---|---:|---:|---:|
| Holo Issue | 100 | 10.7 ms | 34.0 ms |
| Coning Issue | 100 | 24.5 ms | 34.2 ms |

Separate two-request races proved transaction-lock behavior for all reviewed write conflicts:

- Holo: statuses `[200, 409]`; exactly one issue committed; conflict outcome `availability_changed`.
- Coning: statuses `[200, 409]`; exactly one issue committed; conflict outcome `availability_changed`.
- Holo issue versus Cutter dispatch: only one write committed against the source balance.
- Holo receive: statuses `[200, 409]`; only one receive consumed the issue balance.
- Coning receive: statuses `[200, 409]`; only one receive consumed the issue balance.
- Take-back reversal: one reversal committed and the concurrent duplicate was rejected.

The local latency figures satisfy the numerical POST gate, but the release gate remains pending until the same thresholds are proven on staging with production-sized data and representative network conditions.

## Index plans

`EXPLAIN (ANALYZE, BUFFERS)` on the four primary list orderings used the new composite indexes with no heap fetches:

| Table | Plan | 200-row execution |
|---|---|---:|
| `IssueToHoloMachine` | backward index-only scan | 0.369 ms |
| `ReceiveFromHoloMachineRow` | backward index-only scan | 0.148 ms |
| `IssueToConingMachine` | backward index-only scan | 0.399 ms |
| `ReceiveFromConingMachineRow` | backward index-only scan | 0.347 ms |

All plans used `isDeleted, createdAt, id`, preserving cursor ties without an extra sort. Six intended composite indexes were present across Cutter, Holo, and Coning issue and receive tables.

## Repeat commands

```sh
psql postgresql://kushjariwla@127.0.0.1:5432/glintex_snapshot_remediation_20260827_perf_test \
  -v ON_ERROR_STOP=1 -f apps/backend/scripts/seedPerformanceRehearsal.sql

TEST_PERFORMANCE_DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_snapshot_remediation_20260827_perf_test \
  node --test apps/backend/src/routes/__tests__/issueAvailability.integration.test.js

TEST_PERFORMANCE_DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_snapshot_remediation_20260827_perf_test \
RUN_PERFORMANCE_LOAD=1 \
  node --test apps/backend/src/routes/__tests__/performanceRoutes.integration.test.js

TEST_PERFORMANCE_DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_snapshot_remediation_20260827_perf_test \
RUN_PERFORMANCE_PARITY=1 \
  node --test apps/backend/src/routes/__tests__/performanceRoutes.integration.test.js
```

The seed is intentionally one-shot. Recreate a uniquely named rehearsal database before rerunning it.
