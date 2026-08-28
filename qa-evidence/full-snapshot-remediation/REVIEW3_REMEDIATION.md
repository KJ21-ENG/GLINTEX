# Review 3 remediation evidence

Date: 2026-08-27

Base and HEAD before commit: `788258fb4909ef72310188ca592f53736ad49de6`

Product-state fingerprint: 51 files, SHA-256 `463db91b3ca662bae20b99445efc0602c16f6f1b76e99764c015c62ea86e1bb8`. The fingerprint excludes workflow ledgers, QA evidence, and repository instruction files.

## Remediated release blockers

- Production deployment always uses the reviewed base plus production Compose files, deploys the exact workflow SHA, validates backend/frontend health, and restores the prior SHA on failure. Production ports are explicit loopback-only overrides and the development backend bind target matches the image workdir.
- Fresh Cutter Issue uses permission-gated, bounded candidate-lot and available-piece contracts after Item and Lot selection.
- Cutter Purchase edits lock and revalidate source rows and dependencies in the transaction. Holo Issue derives lineage from locked source and inbound rows.
- Holo and Coning Receive create/edit paths require authoritative tare masters, positive integer counts, positive gross weight, and positive net weight. Client validation mirrors the backend.
- Coning Mark Wastage locks the issue and aggregate, accounts for take-backs, is idempotent under concurrent requests, and returns a fresh issue balance.
- Coning Receive delete derives all deltas from the locked row.
- Re-coning references persist their source stage and legacy untagged references remain protected from downstream source edits/deletes.
- Holo mixed-lot keys retain the complete canonical source-lot set. Expansion, cursor identity, barcode auto-expansion, and grouped detailed exports use exact keys rather than lossy display labels.
- Coning Issue Tracking, On Machine, filters, action details, and exports resolve trace-first Cut/Yarn/Twist lineage with stored-field fallback only when trace data is unavailable.
- Receive mutations apply returned authoritative balances to the simultaneously mounted form. Coning close applies its returned closed balance.
- Stock reprint actions are hidden unless the role has the corresponding Receive write permission.

## Verification

- `git diff --check`: passed.
- `node --check` for `src/app.js`, `routes/index.js`, and `routes/v2.js`: passed.
- Backend unit suite: 132 tests, 128 passed, 4 intentional integration skips, 0 failed.
- Frontend production build: passed.
- Static deployment/snapshot/performance contract suite: 17 passed, 0 failed.
- Production-sized integration matrix: 23 tests, 21 passed, 2 opt-in gates skipped in that invocation, 0 failed.
- Production-sized legacy parity gate, run separately: passed.
- Production-sized issue POST load gate, 100 samples per stage: Holo p95 10.9 ms and p99 20.3 ms; Coning p95 23.3 ms and p99 35.8 ms.
- Explicit `docker-compose.yml` plus `docker-compose.prod.yml` model: rendered successfully with loopback-only application ports and runtime persistence under `/app/apps/backend`.

## Deliberately open external gates

No production deployment was performed. Docker image/migration/Nginx execution on a Docker-capable host, staging browser and factory-network/device evidence, production-derived parity, database identity/backup confirmation, rollback rehearsal, explicit production authorization, 60-minute observation, and 24-hour zero-full-snapshot monitoring remain separate release gates.
