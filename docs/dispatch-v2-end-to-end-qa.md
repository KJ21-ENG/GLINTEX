# Dispatch V2 End-to-End QA Runbook and Progress Ledger

- Status: `QA_COMPLETE`
- Canonical requirements: `docs/post-coning-packing-dispatch-spec-plan.md`
- Repository: `/Volumes/MacSSD/Development/CursorAI_Project/GLINTEX`
- QA target: the complete Post-Coning Packing, Packed Stock, Dispatch V2, reconciliation, lineage, reporting, permissions, compatibility, and cutover implementation
- Execution mode: browser-driven end-to-end QA in the Codex in-app Browser, backed by isolated local or isolated rehearsal API and database verification
- Last updated by: `Main orchestrator 01a02450-e74f-7d22-8f6e-78ec481106b6`
- Last updated at: `2026-08-21T12:38:56Z`

## 1. Purpose and definition of done

This file is both the test specification and the durable progress ledger for the QA run. The executing agent must update this file as it works. It must not keep the only copy of progress in chat, a terminal scrollback, or an unreferenced scratch file.

The QA run is complete only when:

1. Every applicable test below has a terminal result of `PASS`, `FAIL`, or `SKIPPED`.
2. No applicable test remains `NOT_RUN`, `IN_PROGRESS`, or `BLOCKED`.
3. Every `FAIL` has reproducible steps, exact observed behavior, expected behavior, source provenance, database evidence, and artifact links.
4. Every `SKIPPED` has a requirement-backed reason plus an explicit user approval reference. A worker or orchestrator may not self-approve a skip.
5. Local test data is reconciled and either retained in the isolated QA database or removed by dropping only the explicitly named QA database.
6. The final summary reports coverage, failures, risks, unverified boundaries, and the exact source commit/tree tested.
7. Every operator-facing workflow has been exercised through the Codex in-app Browser. Terminal, API, and SQL proof supplements the Browser journey and never replaces it.
8. Every in-app Browser QA action after authentication is represented in an ordered, foreground-independent tab recording, with a playable MP4. Any capture gap must be repeated and resolved before the affected test can pass; an unresolvable required gap is a `FAIL`.

Passing QA means the tested source and isolated data set satisfied the requirements. It does not authorize a commit, push, deployment, production migration, production cutover, or production write.

## 2. Authority and safety boundary

The QA agent is authorized to:

- inspect the repository, Git state, runtime state, logs, and local database;
- use the Codex in-app Browser to navigate the local app, sign in, click, type, scan, resize, inspect visible state, capture screenshots, and verify operator workflows;
- record the authenticated GLINTEX application tab with the checked-in tab-native recorder and create replayable QA evidence;
- create a named, isolated local QA database and populate it with QA-only data;
- apply the checked-in additive migration to that isolated QA database;
- run the local backend and frontend against the isolated QA database;
- use the UI and authenticated local APIs to exercise QA flows;
- run read-only SQL against the original local database for fixture discovery;
- mutate only the isolated QA database through application APIs, QA commands, or tightly scoped SQL when a scenario cannot be built through a supported application path;
- run targeted builds, Prisma validation, syntax checks, browser QA, and safe concurrency probes;
- update this QA file and create QA evidence under an explicitly named local evidence directory.

The QA agent is not authorized to:

- modify product source code, migrations, the canonical spec, or workflow policy;
- silently fix a product defect discovered during QA;
- commit, push, open a PR, deploy, send external messages, or modify GitHub state;
- connect to production for writes, run a live cutover, or mutate any production-like shared database;
- reset, truncate, drop, or rewrite the original local database;
- use `docker compose down -v`, Prisma reset, destructive Git commands, or broad cleanup commands;
- store credentials, session cookies, tokens, or secrets in this file or in evidence artifacts.
- substitute terminal-only HTTP, standalone Playwright, Computer Use, Chrome, or another browser surface for a required in-app Browser test unless the user explicitly changes the browser requirement.
- use macOS screen recording, Record & Replay, or foreground application capture for QA recording; the recording must remain scoped to the in-app Browser application tab.

If a product defect blocks a scenario, record a `FAIL`, add it to the defect register, preserve the evidence, and continue with every independent test. If a missing credential, approval, or external system is the only blocker, mark the case `BLOCKED`, notify the main orchestration task, continue elsewhere where safe, and request only the minimum missing input. Never convert `BLOCKED` or unexecuted work to `SKIPPED` without explicit user approval.

## 3. Progress protocol

### 3.1 Status values

- `NOT_RUN`: no meaningful attempt yet.
- `IN_PROGRESS`: active work has begun; evidence may be incomplete.
- `PASS`: every listed expected result and database invariant was proven.
- `FAIL`: an expected result or invariant was disproven.
- `BLOCKED`: execution cannot proceed without a specific external input or authority.
- `SKIPPED`: proven not applicable to this run, with a recorded reason and explicit user approval reference.

For every test:

1. Change `Status` to `IN_PROGRESS` before the first mutation.
2. Record fixture IDs and the pre-state before the mutation.
3. Record UI/API/SQL artifacts while testing.
4. Change the checkbox to `[x]` only for `PASS`, `FAIL`, or user-approved `SKIPPED`; record the exact approval reference for every skip.
5. Add failures to Section 25 immediately rather than waiting for the end.
6. Update Section 4 and the run log after each logical checkpoint.

### 3.2 Visual progress companion

The local Dispatch V2 QA dashboard is a read-only visual companion to this Markdown ledger. This file remains the sole source of truth.

From the repository root, first reuse an already healthy dashboard or start exactly one instance:

```bash
curl --fail --silent http://127.0.0.1:4318/api/health \
  || node tools/dispatch-v2-qa-dashboard/dashboardctl.mjs start
```

Confirm that the health JSON identifies the service as `dispatch-v2-qa-dashboard`, then open `http://127.0.0.1:4318` in a dedicated Codex in-app Browser tab. Keep the GLINTEX application itself on `localhost` as required by the authenticated application session. The dashboard listens only on loopback, has no dependencies or build step, uses two filesystem watchers plus Server-Sent Events, performs no polling, and cannot write to this runbook.

After every checkpoint save, verify that the dashboard reports the new modification time, totals, current focus, and run-log entry. A dashboard rendering issue never changes a test result and never replaces browser QA of the GLINTEX application. If the dashboard is unavailable, continue updating this runbook and record the visualization issue in the run log without marking product tests `BLOCKED`.

### 3.3 Evidence standard

Each case must cite the relevant evidence, using paths relative to the repository when possible:

- source provenance: branch, HEAD SHA, `git status --short`, and a hash or saved diff manifest;
- UI: screenshot or recording plus viewport and route;
- Browser interaction: visible pre-state, user action, visible result, and a screenshot at the decisive state;
- Browser recording: ordered frame manifest, session metadata, playable MP4 path, byte size, SHA-256, capture coverage statement, and any recording gaps;
- API: method, path, sanitized request body, status, and sanitized response;
- database: query and result before and after the operation;
- logs: relevant backend/browser excerpt with timestamps;
- concurrency/idempotency: both request outcomes and the final row/event counts;
- PDF/export: file path, byte size, SHA-256, and rendered visual result.

Never mark a database-affecting test `PASS` from the UI alone.

### 3.4 Foreground-independent Browser recording

Record the GLINTEX application tab itself with `tools/dispatch-v2-qa-dashboard/tab-recorder.mjs`. This is tab-native CDP screencast capture, not desktop recording, so the user's foreground application and unrelated activity cannot appear in the recording or interrupt its visual source.

The recording scope is every in-app Browser QA action from immediately after any required manual authentication through the final Browser verification. It does not record terminal, API, or SQL work; those lanes remain documented through their normal evidence. Never capture credential entry. If sign-in or reauthentication is required, start or resume a newly named segment only after the user finishes signing in.

Use the low-load defaults in `tools/dispatch-v2-qa-dashboard/README.md`: JPEG quality 42, maximum 1280 by 800, every third rendered frame, no audio, no timer, and no polling. Drain and label frames after every visible Browser action or short atomic action group. Record the current test ID, action, route, and drain result. A truncation error is an evidence gap: preserve the partial segment, add the gap to the run log, repeat the affected UI proof, and mark the gap resolved only after the replacement action and recording are validated. A required flow with an unresolved gap cannot pass.

Do not run a live video encoder during QA. At each phase checkpoint, record the accumulated frame count and directory size. If recording data exceeds 2 GB or free disk space falls below 5 GB, stop the segment safely and ask the user before resuming. Run the low-CPU finalizer only after Browser QA has stopped.

At closure, stop every recorder, use `tools/dispatch-v2-qa-dashboard/finalize-tab-recording.mjs` to create H.264 MP4 playback, and verify each replay with `ffprobe`, SHA-256, file size, and a rendered sample frame. Retain the source frames, `frames.jsonl`, `session.json`, `replay-summary.json`, and MP4. When a required flow uses another top-level Browser tab, record a separately named segment and list all MP4s in playback order.

### 3.5 Exact test-ID and packet evidence rule

The orchestration plan assigns every test ID to exactly one packet. A worker may update only its assigned IDs. Statuses must be set one test ID at a time from observed evidence; bulk or range classification is forbidden.

For every operator-facing test, the phase result and Browser action ledger must contain the exact test ID, route, viewport, visible pre-state, performed action, visible result, decisive screenshot path, and recording segment/drain reference. API, SQL, logs, and code inspection may supplement this record but cannot replace it. A browser-required test without exact per-test Browser evidence must remain `NOT_RUN`, `BLOCKED`, or become `FAIL` based on what was actually attempted.

A worker must write its packet result artifact, run the deterministic packet validator, and send a structured completion or blocker message directly to the main orchestration task before ending. The main task reacts to that incoming message. It must not use continuous or periodic task polling.

## 4. Live run dashboard

Update this section throughout the run. Values below are the clean rerun baseline; do not reuse identities or counts from an older run.

| Field | Current value |
|---|---|
| Run ID | `DV2-20260821T123729Z` |
| Agent/model | `Main orchestrator: 01a02450-e74f-7d22-8f6e-78ec481106b6 (gpt-5.6-sol); workers: GPT-5.6 Luna Max` |
| Started at | `2026-08-21T12:38:56Z` |
| Last checkpoint | `QP-08 complete; all 8 assigned tests terminal with 5 PASS, 3 FAIL, and 0 BLOCKED; packet validator PASS, final validator PASS, and protected-source recheck UNCHANGED at ff1c04cd304e42da984b38f291ed6835b594fd05` |
| Source branch | `main` |
| Source HEAD | `ff1c04cd304e42da984b38f291ed6835b594fd05` |
| Working-tree fingerprint | `qa-evidence/DV2-20260821T123729Z/source/pre-run-source-baseline.json` |
| QA database name | `glintex_dispatch_v2_qa_20260821t123729z` |
| Backend URL | `http://localhost:4000` |
| Frontend URL | `http://localhost:5173` |
| QA dashboard URL | `http://127.0.0.1:4318` |
| QA dashboard state | `RUNNING_HEALTHY; dispatch-v2-qa-dashboard v2.0.0; PID 35659; polling false` |
| Browser surface | `Codex in-app Browser REQUIRED` |
| Browser tab / route | `iab tab 1; last authenticated route http://localhost:5173/app/dispatch` |
| Browser recording mode | `TAB_NATIVE_CDP_REQUIRED` |
| Browser recording root | `qa-evidence/DV2-20260821T123729Z/browser-recording (QP-00 creates)` |
| Browser recording frames | `3268 persisted frames across the 66 run segments; QP-03 contributed 157 frames across app-44 through app-66, with the app-54 capture gap resolved by its replacement drain` |
| Browser replay MP4 / segments | `QP-03 MP4 replays and recorder segments are persisted at qa-evidence/DV2-20260821T123729Z/browser-recording/DV2-20260821T123729Z-app-44 through app-66; recording-index.json contains hashes and byte counts` |
| Browser playback verification | `PASS; ffprobe verified the app-54 H.264 replay at 1280x720 with 20 frames and no audio; all 23 indexed QP-03 segments have positive bytes, valid hashes, and zero unresolved gaps` |
| Migration state | `APPLIED; second deploy/status clean` |
| Tests PASS | `152` |
| Tests FAIL | `97` |
| Tests BLOCKED | `0` |
| Tests SKIPPED | `0` |
| Tests NOT_RUN/IN_PROGRESS | `0` |
| Current section | `QA_COMPLETE; QP-08 has 8 exact tests terminal with 5 PASS, 3 FAIL, 0 BLOCKED, and 0 SKIPPED; packet validator PASS, final validator PASS, final NO-GO verdict recorded with 31 defects and complete replay index` |
| Current blocker | `NONE; the final release verdict is NO-GO because reproducible product S1 defects remain, not because of an unresolved QA execution blocker.` |

### Run log

| Timestamp | Checkpoint | Result | Evidence / next action |
|---|---|---|---|
| `2026-08-21T12:38:56Z` | Fresh run initialization | `PASS` | Plan-only validator confirmed 249 unique tests, all `NOT_RUN`; protected source baseline captured at `qa-evidence/DV2-20260821T123729Z/source/pre-run-source-baseline.json`; prior invalid run remains historical only. |
| `2026-08-21T12:38:56Z` | Workflow-health boundary | `PRE_EXISTING` | `project-workflow validate --strict` reported 5 historical legacy session/task-schema errors and 2 pre-existing open governance gaps. No repair or workflow evolution is authorized; this boundary is not a Dispatch V2 product or evidence result. |
| `2026-08-21T13:46:27Z` | QP-00 packet execution | `PASS` | `DV2-PRE-001` through `DV2-PRE-014` are terminal PASS with exact per-test evidence in `qa-evidence/DV2-20260821T123729Z/phases/QP-00.json`; isolated DB/runtime, permission sessions, iab navigation, screenshots, and recorder gap replacement are documented. Main orchestrator should recover iab to stop/finalize the persisted recorder segment before closure and then launch QP-01. |
| `2026-08-21T16:14:44Z` | QP-01 packet execution | `PASS WITH DEFECTS` | `DV2-DB-001` through `DV2-DB-010` and `DV2-AUTH-003`, `DV2-AUTH-005` through `DV2-AUTH-012` are terminal PASS; `DV2-AUTH-001`, `DV2-AUTH-002`, and `DV2-AUTH-004` are terminal FAIL with `DV2-DEF-003`, `DV2-DEF-002`, and `DV2-DEF-001`. Exact phase evidence is in `qa-evidence/DV2-20260821T123729Z/phases/QP-01.json`; packet validator passed and the protected-source recheck is unchanged. |
| `2026-08-21T18:50:00Z` | QP-02 packet execution | `PASS WITH DEFECTS` | `DV2-REC-001` through `DV2-BAT-020` are terminal with 26 PASS and 21 FAIL. FAIL evidence records `DV2-DEF-004` for authenticated Packing UI mutations, `DV2-DEF-005` for reservation concurrency/idempotency, and `DV2-DEF-006` for Decimal reconciliation preview serialization. Exact phase evidence is in `qa-evidence/DV2-20260821T123729Z/phases/QP-02.json`; protected source is unchanged and the next action is main-orchestrator launch of QP-03. |
| `2026-08-22T08:15:00Z` | QP-03 status-contract correction | `PASS WITH DEFECTS` | `DV2-UNIT-001` through `DV2-UNIT-018` and `DV2-STK-001` through `DV2-STK-012` are terminal with 9 PASS, 21 FAIL, and 0 BLOCKED. The six attempted Packed Stock UI workflows previously marked BLOCKED are now FAIL with DV2-DEF-007 and preserved Browser/API/DB evidence in `qa-evidence/DV2-20260821T123729Z/phases/QP-03.json`; rerun the packet validator and protected-source check before advancing. |
| `2026-08-22T11:20:00Z` | QP-04 packet execution correction | `PASS WITH DEFECTS` | `DV2-DSP-001` through `DV2-DSP-018`, `DV2-PACKDSP-001` through `DV2-PACKDSP-015`, and `DV2-CHL-001` through `DV2-CHL-015` are terminal with 32 PASS, 16 FAIL, and 0 BLOCKED. DSP-001 and DSP-003 were re-executed through visible iab submission with `mutationSubmitted:true`; both reproduce DV2-DEF-009 and preserve API/DB before-after proof. CHL-011 preserves the original blocked Preview PDF action and now passes through the separately recorded approved localhost evidence-only viewer render, with matching API/PDF/hash, targeted DB reconciliation, and rendered-page proof. QP-04 phase evidence is assembled; the deterministic packet validator passed and the protected-source recheck is UNCHANGED. |
| `2026-08-22T17:10:09Z` | QP-05 packet execution correction | `PASS WITH DEFECTS` | Attempts 1 and 2 remain retired and idle. After the corrected exact credential-free OS-authenticated proof for `glintex_dispatch_v2_qa_20260821t123729z`, the 38 stale permission-only QP-05 `BLOCKED` classifications were replaced one exact test ID at a time immediately before execution; no non-QP-05 status changed. QP-05 is terminal with 25 PASS and 13 FAIL, with failures `DV2-DEF-004`, `DV2-DEF-006`, `DV2-DEF-015`, `DV2-DEF-016`, and `DV2-DEF-017`; app-83 through app-86 recordings include the resolved app-84 capture gap and valid replacement drains. Exact phase evidence is `qa-evidence/DV2-20260821T123729Z/phases/QP-05.json`; QA-only cutover fixtures and temporary state were removed and restored to ACTIVE; packet validator passed and the protected-source recheck is UNCHANGED. |
| `2026-08-22T18:10:02Z` | QP-06 packet execution | `PASS WITH DEFECTS` | `DV2-REP-001` through `DV2-SCAN-001` are terminal with 7 PASS and 7 FAIL. Failures are `DV2-DEF-018` through `DV2-DEF-023`: report date filtering, exception coverage, reversal lineage, bounded lineage truncation, packing notification delivery/replay, and legacy RHO scanner lookup. Exact iab actions and API/DB evidence are in `qa-evidence/DV2-20260821T123729Z/phases/QP-06.json`; app-87 replay is finalized with 1178 frames, H.264 proof, SHA-256, and zero unresolved gaps; packet validator and protected-source recheck are complete. |
| `2026-08-22T22:29:29Z` | QP-07 packet execution continuation | `PASS WITH DEFECTS` | `DV2-CUT-001` through `DV2-EXCL-005` are terminal with 15 PASS, 13 FAIL, and 0 BLOCKED. The authorized fresh-copy `DV2-CUT-011` rehearsal restored the exact dump into `glintex_dispatch_v2_qa_20260821t123729z_cut011_rehearsal`, applied migration, gated writes, completed historical migration, applied cutover, and then reproduced `DV2-DEF-030` during opening import, activation, and reversal; the temporary database was dropped and proven absent. Phase evidence is `qa-evidence/DV2-20260821T123729Z/phases/QP-07.json`; packet validator PASS and protected-source recheck UNCHANGED. |
| `2026-08-22T23:19:46Z` | QP-08 final reconciliation and verdict | `NO-GO WITH COMPLETE EVIDENCE` | `DV2-CLOSE-001` through `DV2-CLOSE-008` are terminal with 5 PASS and 3 FAIL. The live isolated database integrity, conservation, idempotency, and preservation checks are reconciled; `DV2-QA-DEF-001` records the missing canonical fixture ledger and `DV2-DEF-017` remains reproducible. All 177 Browser-required tests are represented by 731 exact action rows, 77 playable H.264 segments, 8352 frames, 928 drains, 17 resolved capture gaps, and zero unresolved required gaps in `qa-evidence/DV2-20260821T123729Z/recording-index.json`. Final counts are 152 PASS, 97 FAIL, 0 BLOCKED, 0 SKIPPED, and 0 NOT_RUN/IN_PROGRESS; no product or external state was modified. Packet validator PASS, final validator PASS, and protected-source recheck PASS/UNCHANGED. |

## 5. Implementation surface under test

The executing agent must re-read the live files before testing because this runbook describes the current uncommitted implementation, not a frozen commit.

- Canonical contract: `docs/post-coning-packing-dispatch-spec-plan.md`
- Schema/migration: `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/20260820090000_add_packing_dispatch_v2/migration.sql`
- Packing and inventory: `apps/backend/src/services/packing/**`, `apps/backend/src/services/inventory/**`
- Dispatch V2: `apps/backend/src/services/dispatch/**`, `apps/backend/src/routes/dispatchV2.js`
- Reconciliation/cutover: `apps/backend/src/services/cutover/**`, `apps/backend/src/routes/reconciliation.js`, `apps/backend/src/scripts/*Packing*.mjs`, `apps/backend/src/scripts/migrateDispatchV2.mjs`
- Reports/lineage: `apps/backend/src/services/packingReports/**`, `apps/backend/src/services/packingLineage/**`, `apps/backend/src/routes/packingReports.js`
- Integration bridge: `apps/backend/src/routes/index.js`, `apps/backend/src/routes/v2.js`, `apps/backend/src/utils/permissions.js`
- Frontend: `apps/frontend/src/pages/Packing.jsx`, `apps/frontend/src/pages/DispatchV2.jsx`, `apps/frontend/src/components/packing/**`, `apps/frontend/src/components/dispatchV2/**`, `apps/frontend/src/components/stock/PackedStockView.jsx`, `apps/frontend/src/components/settings/PackingSettings.jsx`, `apps/frontend/src/components/reports/PackingReports.jsx`
- Deployment/readiness: `.github/workflows/deploy-production.yml`, `docker-compose.yml`, `docker-compose.prod.yml`, `apps/backend/src/routes/readiness.js`

## 6. QA environment and fixture strategy

### 6.1 Required isolation

Use a database name that contains the run ID, for example `glintex_dispatch_v2_qa_20260821t080000`. Resolve the current database host safely, take a logical backup of the original local database, create the explicit QA database, and restore or seed it. Point the QA backend at the QA database only. Record commands with credentials redacted.

Do not reuse the shared `glintex` database for destructive or exhaustive flows. Do not use a database URL whose hostname or metadata indicates production. Before the first mutation, prove the backend process is connected to the named QA database.

Use `localhost` consistently for the browser and API when the authentication cookie is SameSite-bound. Do not mix `127.0.0.1` and `localhost` in one login session.

### 6.2 Browser-first execution contract

The Codex in-app Browser is the mandatory primary surface for this QA run.

- Read and follow the `browser:control-in-app-browser` skill before the first Browser action.
- Select the in-app Browser explicitly and keep one persistent Browser binding for the run.
- Reuse a valid tab when possible. If a tab becomes stale or closes, obtain a new tab from the same in-app Browser binding.
- Open the local frontend through `localhost`, not `127.0.0.1`, and keep the frontend/API hostname compatible with the authenticated session.
- Do not inspect browser cookies, local storage, profiles, passwords, or session stores.
- If authentication is required, ask the user to sign in in the in-app Browser and say when it is ready. Do not switch browsers or bypass authentication.
- For each operator-facing case, navigate and perform the real visible workflow by clicking, typing, selecting, scanning, opening dialogs, and observing the rendered result.
- Capture the decisive visible state with the Browser screenshot capability. Record route, viewport, fixture ID, and timestamp.
- Keep the checked-in tab recorder bound to the GLINTEX application tab and drain it after every visible Browser action; switching the user's foreground application must not affect capture.
- Use Browser resizing or supported viewport controls for phone, tablet, intermediate, and desktop checks.
- Verify PDF preview/print/download and multi-challan rendering through the visible Browser workflow, then use file/hash/render checks as supporting evidence.
- Browser-visible behavior is required even when the same API behavior has already passed through terminal requests.
- API and SQL may be used to establish preconditions, inspect exact requests/results, create otherwise unavailable isolated fixtures, and prove database invariants. They must not replace the Browser path when the UI exposes the workflow.
- Do not use standalone Playwright, Computer Use, Chrome, or another browser as a fallback. If the in-app Browser is unavailable, mark Browser-dependent work `BLOCKED`, preserve completed non-Browser proof, and ask the user to restore that exact surface.

### 6.3 Test-data namespace

Use a unique marker everywhere a free-text field permits it:

```text
QA-DV2-<RUN_ID>
```

Track all created rows in the fixture ledger below. Prefer application APIs or UI flows. Direct SQL is allowed only for a missing prerequisite that cannot be produced through supported behavior, and must be:

- limited to the isolated QA database;
- executed inside a transaction;
- copied from a valid existing row shape;
- annotated in the evidence and fixture ledger;
- followed by Prisma/application reads proving the row is valid.

### 6.4 Required fixture families

Prepare enough data to cover these independent families. Do not reuse a terminally mutated unit where a clean unit is required.

| Fixture | Required properties | IDs / evidence |
|---|---|---|
| `CUST-A` | active customer | `TBD in the new isolated QA database` |
| `CUST-B` | second active customer | `TBD in the new isolated QA database` |
| `CUST-INACTIVE` | deactivated customer with historical reference where possible | `TBD in the new isolated QA database` |
| `ROLE-NONE` | non-admin, packing `NONE`, dispatch as needed | `TBD; credentials must not be recorded` |
| `ROLE-READ` | non-admin, packing `READ`, dispatch `READ` | `TBD; credentials must not be recorded` |
| `ROLE-WRITE` | non-admin, packing `WRITE`, dispatch `WRITE` | `TBD; credentials must not be recorded` |
| `SRC-CONING-A/B/C` | positive exact count and weight, distinct barcodes/IDs | `TBD in the new isolated QA database` |
| `SRC-RECONING` | Coning source eligible for re-Coning | `TBD in the new isolated QA database` |
| `SRC-INBOUND` | available legacy Inbound source | `TBD in the new isolated QA database` |
| `SRC-CUTTER` | available legacy Cutter source | `TBD in the new isolated QA database` |
| `SRC-HOLO` | available legacy Holo source | `TBD in the new isolated QA database` |
| `RECIPE-GENERIC` | active, generic, one stock level, no quality hold, partial disabled | `TBD in the new isolated QA database` |
| `RECIPE-HIERARCHY` | active, at least three levels, stock child plus barcoded Parcel parent | `TBD in the new isolated QA database` |
| `RECIPE-PARTIAL-QH` | active, partial enabled, quality hold enabled, warning 2%, approval 5% | `TBD in the new isolated QA database` |
| `RECIPE-CUST-A` | active and restricted to `CUST-A` | `TBD in the new isolated QA database` |
| `UNIT-AVAILABLE-*` | several independently actionable generic units | `TBD in the new isolated QA database` |
| `UNIT-RESERVED-A-*` | several units reserved to `CUST-A` | `TBD in the new isolated QA database` |
| `UNIT-PARENT-PARCEL` | sealed parent with multiple eligible stock-unit children | `TBD in the new isolated QA database` |
| `LEGACY-CHALLAN-GOOD` | consistent legacy challan group | `TBD in the new isolated QA database` |
| `LEGACY-CHALLAN-BAD` | isolated inconsistent group for refusal test | `TBD in the new isolated QA database` |
| `OPENING-LOOSE` | classified loose/unpacked opening line | `TBD; do not self-skip` |
| `OPENING-PACKED` | classified packed opening line with new barcode | `TBD; do not self-skip` |

If the copied database lacks valid upstream sources, create business-valid test lineage through the normal Inbound -> Cutter -> Holo -> Coning workflow. Do not fabricate Packed Units directly merely to bypass Packing, except in a separately documented negative database-constraint probe.

### 6.5 Fixture ledger

| Fixture ID | Table/entity | Created through | Initial state | Current state | Safe cleanup / retention note |
|---|---|---|---|---|---|
| `NONE_YET` |  |  |  |  | Add one row per new-run fixture family as it is created or selected. |

## 7. Standard database assertion toolkit

Adapt these queries to the resolved IDs and save sanitized results. Quote Prisma mixed-case table names.

### 7.1 Migration and table inventory

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name = '20260820090000_add_packing_dispatch_v2';

SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'OperationalSequence', 'PackingColor', 'PackingPackageType',
    'PackingLaunchState', 'PackingRecipe', 'PackingRecipeLevel',
    'PackingBatch', 'PackingBatchSource', 'PackedUnit', 'PackedUnitEvent',
    'DispatchChallan', 'DispatchLine', 'DispatchEvent', 'DispatchDocument',
    'InventoryAdjustmentBatch', 'InventoryAdjustmentLine'
  )
ORDER BY tablename;
```

### 7.2 Append-only and idempotency assertion

For each mutation, capture counts before, after the first call, and after replaying the same `Idempotency-Key`. The second call must return `replay: true` where implemented, and row/event counts must not increase.

```sql
SELECT COUNT(*) FROM "PackedUnitEvent" WHERE "idempotencyKey" = '<key>';
SELECT COUNT(*) FROM "DispatchEvent" WHERE "idempotencyKey" LIKE '<key>%';
SELECT COUNT(*) FROM "DispatchChallan" WHERE "idempotencyKey" = '<key>';
SELECT COUNT(*) FROM "InventoryAdjustmentBatch" WHERE "idempotencyKey" = '<key>';
```

### 7.3 Source conservation assertion

For each `PackingBatchSource`, verify:

```text
reservedBaseCount = consumedBaseCount + releasedBaseCount + remaining reservation count
reservedNetWeightKg = consumedNetWeightKg + releasedNetWeightKg + remaining reservation weight
```

For every split, damage, write-off, return, or repacking flow, prove exact count and weight conservation from the source snapshot, event payloads, children/replacements, dispatch lines, and write-off quantities.

### 7.4 Orphan and duplicate assertion

Prove no test flow introduced:

- a `PackedUnit` without a valid batch, recipe, package type, item, wrapper, color, or cone type;
- a `DispatchLine` without a challan;
- a duplicate non-null packed barcode;
- a duplicate `(familyKey, version)` recipe;
- a duplicate `(batchId, levelIndex, unitSequence)` unit;
- a duplicate legacy dispatch representation;
- a dangling reversal link;
- a negative authoritative Coning balance;
- a hard-deleted event or historical Dispatch row.

### 7.5 Audit identity assertion

For each exceptional operation, verify actor, reason, timestamp, before/after payload, idempotency identity, and reversal link where applicable. Database timestamps and displayed history must agree within expected formatting/time-zone conversion.

## 8. Phase A: source, environment, and migration preflight

- [x] `DV2-PRE-001` Record exact source provenance.
  - Status: `PASS`
  - Procedure: record branch, HEAD, `origin/main`, ahead/behind state, `git status --short`, diff stat, and hashes for every untracked implementation file.
  - Expected: the target is unambiguous; unrelated changes are identified and preserved.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-001-source-provenance.json` records main@ff1c04cd304e42da984b38f291ed6835b594fd05, origin/main, ahead/behind, dirty-tree preservation, diff stat, and SHA-256 values for the untracked QA implementation files.

- [x] `DV2-PRE-002` Read the canonical spec and compare its required sections to this runbook.
  - Status: `PASS`
  - Expected: no required product area is absent from the QA matrix; discrepancies are added before testing.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-002-spec-runbook-coverage.json` maps every canonical product area to runbook sections/test families and records 249 unique plan IDs with no discrepancies.

- [x] `DV2-PRE-003` Prove environment isolation and non-production destination.
  - Status: `PASS`
  - Procedure: resolve process environment without exposing credentials; query `current_database()`, server address, and port from the QA backend connection.
  - Expected: explicit QA database name and local/rehearsal host; no production host.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-003-environment-isolation.json` records local-only host/database configuration and the post-start QA `/api/readiness` plus direct `current_database()` proof before mutation.

- [x] `DV2-PRE-004` Back up the original local database before cloning.
  - Status: `PASS`
  - Expected: backup exists, is non-empty, has SHA-256 recorded, and a list/restore-read check succeeds.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-004-original-db-backup.json` records the 9,278,543-byte custom dump, SHA-256, 346-entry restore list, and successful schema-only restore-read.

- [x] `DV2-PRE-005` Create and restore/seed the isolated QA database.
  - Status: `PASS`
  - Expected: the original database remains unchanged; QA DB is accessible and named in Section 4.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-005-qa-db-restore.json` proves the previously absent run-specific database was created/restored on localhost, selected source counts match, and glintex_dev remains present.

- [x] `DV2-PRE-006` Apply the additive Packing/Dispatch migration to the QA database.
  - Status: `PASS`
  - Expected: migration succeeds once; a second deploy/status check is clean and idempotent; no legacy table/column is removed.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-006-migration.json` records first/second deploy, clean migration status, required new tables, no source-only tables/columns, and no destructive migration tokens.

- [x] `DV2-PRE-007` Validate Prisma schema/client readiness.
  - Status: `PASS`
  - Procedure: run safe Prisma validation/generation against the QA configuration and record exact commands.
  - Expected: validation and client generation succeed without changing product source unexpectedly.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-007-prisma-readiness.json` records successful Prisma validation, Prisma Client 4.16.2 generation/load, the dependency warning, and an unchanged protected-source check.

- [x] `DV2-PRE-008` Run targeted backend and frontend builds.
  - Status: `PASS`
  - Expected: both builds pass; warnings are captured and triaged.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-008-builds.json` records successful backend syntax and Vite frontend builds plus all emitted warnings and a clean protected-source check.

- [x] `DV2-PRE-009` Start backend/frontend against the QA database.
  - Status: `PASS`
  - Expected: backend, frontend, login, `/api/health`, and `/api/readiness` are reachable; browser/API use one hostname.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-009-runtime.json` records the localhost QA backend/frontend, health/readiness/auth-status probes, and direct/runtime proof of the new QA schema before authentication or business mutation.

- [x] `DV2-PRE-010` Verify readiness success and failure contracts.
  - Status: `PASS`
  - Procedure: record healthy response, then use an isolated misconfigured process or mocked unavailable schema/database without disturbing the QA runtime.
  - Expected: healthy is HTTP 200; unavailable dependency/schema is HTTP 503 with stable non-secret error data.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-010-readiness-contract.json` records healthy HTTP 200 readiness and isolated nonexistent-database HTTP 503 diagnostics with no secret leakage.

- [x] `DV2-PRE-011` Inventory baseline row counts and legacy evidence.
  - Status: `PASS`
  - Expected: counts for all new and affected legacy tables are saved before fixtures or mutations.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-011-baseline-counts.json` records the isolated QA row-count baseline for affected legacy/audit/settlement tables and zero new V2 rows before fixtures.

- [x] `DV2-PRE-012` Establish authenticated admin, `NONE`, `READ`, and `WRITE` sessions.
  - Status: `PASS`
  - Expected: accounts/sessions are available without recording passwords or cookies.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-012-permission-sessions.json` records the admin session, three isolated accounts, final permission projections, visible post-login identities, and sanitized database session counts without passwords or cookies.

- [x] `DV2-PRE-013` Connect to the Codex in-app Browser and read its complete control documentation.
  - Status: `PASS`
  - Procedure: use the `browser:control-in-app-browser` skill, select the in-app Browser explicitly, bind a persistent Browser instance, and open the local frontend.
  - Expected: the in-app Browser is available and controllable; no substitute browser or terminal-only flow is used.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-013-browser-binding.json` plus `qa-evidence/DV2-20260821T123729Z/ui/DV2-PRE-013-inapp-browser-authenticated.png` and the exact `DV2-PRE-013` Browser ledger/drain prove the persistent `iab` tab stayed on authenticated localhost GLINTEX after reload; the full `iab` documentation was read before control.

- [x] `DV2-PRE-014` Establish and prove the authenticated Browser session.
  - Status: `PASS`
  - Procedure: navigate visibly to the `localhost` login/app route, have the user sign in if needed, and open authenticated Packing, Stock, Dispatch, Settings, and Reports pages without inspecting cookies or local storage.
  - Expected: one stable in-app Browser session reaches all permitted routes and preserves authentication across navigation and refresh.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/DV2-PRE-014-browser-navigation.json` maps exact Packing, Stock, Dispatch, Settings, Reports, and refresh actions to decisive screenshots and recorder drains; app-03 contains the settled replacement for the earlier Dispatch capture gap.

## 9. Phase B: schema, constraints, and additive migration

- [x] `DV2-DB-001` Verify all new enums and every required enum value.
  - Status: `PASS`
  - Expected: package, launch, recipe, delivery, batch, source, unit, event, challan, dispatch source/event/document, and adjustment enums exactly match the spec.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-001-enums.json`

- [x] `DV2-DB-002` Verify all new tables, columns, defaults, decimal precision, timestamps, actor fields, and optimistic version fields.
  - Status: `PASS`
  - Expected: schema matches Sections 4-6 and 10-11 of the canonical spec.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-002-schema.json`

- [x] `DV2-DB-003` Verify required uniqueness constraints.
  - Status: `PASS`
  - Procedure: transactionally attempt duplicate normalized master names, recipe family/version, batch number, unit barcode, batch/level/sequence, challan number, legacyDispatchId, document/challan, idempotency keys, and reversal links; roll back probe rows.
  - Expected: each invalid duplicate is rejected by service and/or database.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-003-uniqueness.json`

- [x] `DV2-DB-004` Verify foreign-key restriction behavior.
  - Status: `PASS`
  - Expected: referenced recipes, masters, customers, batches, units, lines, documents, events, and adjustment rows cannot be orphaned by deletion.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-004-foreign-keys.json`

- [x] `DV2-DB-005` Verify indexes supporting barcode, active stock, status, source, customer, business date, created time, challan, hierarchy, events, and report pagination.
  - Status: `PASS`
  - Expected: required indexes exist and representative `EXPLAIN` plans use bounded/indexable access at a meaningful fixture volume.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-005-indexes.json`

- [x] `DV2-DB-006` Verify `Customer.isActive` migration behavior.
  - Status: `PASS`
  - Expected: existing customers default active; historical references remain intact; inactive customers can be queried for history but not selected for new work.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-006-customer-is-active.json`

- [x] `DV2-DB-007` Verify `OperationalSequence` allocation under concurrency.
  - Status: `PASS`
  - Procedure: concurrently create several batches and challans in a controlled fixture.
  - Expected: unique, monotonic, correctly padded `PB-YYYYMMDD-NNNN`, `IAB-YYYYMMDD-NNNN`, `PKU-...`, and fiscal `DC/...` identifiers with no count-based collision.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-007-sequences.json`

- [x] `DV2-DB-008` Prove the migration is additive to legacy Dispatch and production/contractor tables.
  - Status: `PASS`
  - Expected: legacy columns, rows, barcodes, piece totals, weights, wastage, and contractor evidence remain byte/value-equivalent to baseline unless a later explicit QA mutation targets them.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-008-additive-legacy.json`

- [x] `DV2-DB-009` Verify database check constraints and service guards for positive counts, valid levels, and nonnegative weights.
  - Status: `PASS`
  - Expected: invalid count/weight/level/status data is rejected and no partial row remains.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-009-check-guards.json`

- [x] `DV2-DB-010` Run the global orphan/duplicate/negative-balance assertion baseline.
  - Status: `PASS`
  - Expected: zero new integrity violations before functional testing begins.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/db/DV2-DB-010-integrity-baseline.json`

## 10. Phase C: authentication, permissions, navigation, and write gates

- [x] `DV2-AUTH-001` Unauthenticated access to every new protected route.
  - Status: `FAIL`
  - Expected: HTTP 401 stable JSON; readiness remains intentionally public.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-001-unauthenticated.json`

- [x] `DV2-AUTH-002` Packing `NONE` user navigation and routes.
  - Status: `FAIL`
  - Expected: Packing navigation/action surfaces are absent or access-denied; Packing/Packed Stock API reads and writes return 403.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-002-none.json`

- [x] `DV2-AUTH-003` Packing `READ` user behavior.
  - Status: `PASS`
  - Expected: Packing, Packed Stock, details, histories, and launch state are readable; every Packing mutation is hidden/disabled and API writes return 403.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-003-packing-read.json`

- [x] `DV2-AUTH-004` Packing `WRITE` user behavior.
  - Status: `FAIL`
  - Expected: all authorized Packing/master/stock mutations are available; no action-specific Packing permission is required.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-004-write.json`

- [x] `DV2-AUTH-005` Dispatch `NONE`, `READ`, and `WRITE` boundaries.
  - Status: `PASS`
  - Expected: source/history/PDF/export reads require dispatch `READ`; challan/correction/void/return/reversal require dispatch `WRITE`.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-005-dispatch-boundaries.json`

- [x] `DV2-AUTH-006` Reports permission boundary.
  - Status: `PASS`
  - Expected: Packing report and barcode-lineage routes require reports `READ`, independently of Packing navigation visibility.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-006-reports.json`

- [x] `DV2-AUTH-007` Legacy-role normalization regression.
  - Status: `PASS`
  - Procedure: open and save a pre-migration non-admin role missing `packing`.
  - Expected: missing remains `NONE`; saving cannot silently grant `WRITE` or `READ`.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-007-role-normalization.json`

- [x] `DV2-AUTH-008` Admin override behavior.
  - Status: `PASS`
  - Expected: admin can perform authorized local QA actions without malformed permission objects; audit actor remains the real admin ID.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-008-admin-override.json`

- [x] `DV2-AUTH-009` Inactive-customer selection boundary.
  - Status: `PASS`
  - Expected: inactive customer is hidden from new Packing/Dispatch selections, while historical batches, units, challans, documents, and reports still render.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-009-inactive-customer.json`

- [x] `DV2-AUTH-010` Cutover write gate coverage.
  - Status: `PASS`
  - Procedure: in isolated QA state only, enter the supported gated phase and attempt Dispatch, re-Coning, Packing, and affected Stock mutations plus unaffected reads.
  - Expected: all affected writes are rejected server-side; reads remain available; unsupported phase/action combinations fail stably.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-010-cutover-gate.json`

- [x] `DV2-AUTH-011` Active launch requirement.
  - Status: `PASS`
  - Expected: new Packing/Dispatch behavior obeys the implemented launch-state policy; PREPARATION/gated/failed/reversed states do not accidentally permit writes.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-011-launch-state.json`

- [x] `DV2-AUTH-012` Stable error envelope and missing idempotency key.
  - Status: `PASS`
  - Expected: every new mutation without `Idempotency-Key` returns HTTP 400 with `{error,message,details}` and leaves no row/event changes.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-012-idempotency-envelope.json`

## 11. Phase D: Packing masters, recipe seed, and recipe lifecycle

- [x] `DV2-REC-001` Create, list, edit, deactivate, and include-inactive Packing colors.
  - Status: `FAIL`
  - Expected: normalized uniqueness is case/whitespace-safe; deactivated values disappear from new selection but remain historically resolvable.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json

- [x] `DV2-REC-002` Create, list, filter, edit, and deactivate each package kind.
  - Status: `FAIL`
  - Expected: `PACKET`, `BOX`, `BORI`, `PARCEL` work; tare uses three-decimal semantics; outbound types remain separate from legacy receive `Box` master.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json

- [x] `DV2-REC-003` Reject duplicate normalized master names and invalid tare/kind values.
  - Status: `FAIL`
  - Expected: stable validation/duplicate error; no duplicate row.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-004` Run the 39-row recipe seed importer once.
  - Status: `PASS`
  - Expected: exactly 39 source rows are represented as `DRAFT`; raw values/source row metadata are preserved; none is active.
  - Evidence: qa-evidence/DV2-20260821T123729Z/artifacts/QP-02-import-proof.json; qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-005` Replay the recipe seed importer.
  - Status: `PASS`
  - Expected: all prior rows are skipped/reused; no duplicate recipe families/versions, colors, or package types.
  - Evidence: qa-evidence/DV2-20260821T123729Z/artifacts/QP-02-import-proof.json; qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-006` Audit exact recipe seed normalization and unresolved cases.
  - Status: `PASS`
  - Expected: `120PAC` normalizes while raw remains; Parcel `1` is one outer Parcel; local rows lack Parcel; `GRAM=S`, spelling variants, and inexact arithmetic remain unresolved and blocked.
  - Evidence: qa-evidence/DV2-20260821T123729Z/artifacts/QP-02-import-proof.json; qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-007` Create and edit a valid generic DRAFT recipe.
  - Status: `FAIL`
  - Expected: master references, thresholds, delivery mode, partial/quality rules, levels, stock level, and notes round-trip exactly.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-008` Recipe-level validation matrix.
  - Status: `PASS`
  - Procedure: test missing levels, duplicate indexes, index starting other than 1, gaps, zero/negative child count, invalid package reference, invalid stock level, and hierarchy/package mismatch.
  - Expected: each invalid draft/activation is rejected atomically with a stable error.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-009` Activation prerequisite matrix.
  - Status: `PASS`
  - Procedure: independently omit Item, Wrapper, Color, Cone Type, nominal gram, valid levels, and stock-unit level.
  - Expected: activation is blocked until all required fields are resolved.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-010` Activate a valid recipe and enforce one active version per family.
  - Status: `FAIL`
  - Expected: recipe becomes immutable `ACTIVE`; second active version cannot coexist without lifecycle handling.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-011` Active recipe immutability and new-version workflow.
  - Status: `PASS`
  - Expected: direct physical edits to ACTIVE fail; a new DRAFT superseding version can be created, activated, and traced without changing historical batches/units.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-012` Retire recipe behavior.
  - Status: `FAIL`
  - Expected: RETIRED recipe is immutable and unavailable for new confirmation; existing batches/units preserve snapshots and remain readable.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-013` Customer-restricted recipe behavior.
  - Status: `PASS`
  - Expected: only the matching active customer can use it; generic recipe permits neutral stock.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-014` Batch-only override.
  - Status: `PASS`
  - Expected: missing reason or invalid JSON fails; valid override is snapshot-only, does not mutate recipe, and remains visible in batch history.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-REC-015` Variance threshold validation.
  - Status: `PASS`
  - Expected: invalid/negative/inverted thresholds fail; valid warning/approval decimals round-trip exactly.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

## 12. Phase E: authoritative Coning balance and shared consumers

- [x] `DV2-BAL-001` Baseline authoritative balance formula.
  - Status: `PASS`
  - Procedure: select a known Coning receive and independently calculate current quantity minus Dispatch, re-Coning, Packing consumption/reservation plus applied adjustments.
  - Expected: service/UI/API count and weight equal the independent SQL calculation.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-002` Box Transfer is not subtracted twice.
  - Status: `PASS`
  - Expected: current row quantity already reflects transfer; authoritative balance matches it without a second deduction.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-003` Draft Packing sources do not reserve.
  - Status: `PASS`
  - Expected: staging a DRAFT batch source leaves authoritative availability unchanged.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-004` Confirmed/in-progress Packing reservations reduce availability exactly.
  - Status: `PASS`
  - Expected: exact reserved count and Decimal weight are unavailable to another batch/re-Coning operation.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-005` Packing consumption replaces reservation without double deduction.
  - Status: `PASS`
  - Expected: sealing/completion moves the quantity from reserved to consumed; total reduction remains exact once.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-006` Re-Coning uses the shared balance service.
  - Status: `PASS`
  - Expected: it cannot consume Packing-reserved stock and its successful consumption appears in authoritative availability.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-007` Coning Stock and legacy read paths use shared balance.
  - Status: `PASS`
  - Expected: displayed count/weight match the service after Dispatch, reservation, consumption, release, and adjustment changes.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-008` Reconciliation adjustment changes availability once.
  - Status: `FAIL`
  - Expected: only signed `APPLIED` adjustments affect balance; DRAFT/FAILED/REVERSED do not.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-009` Negative count and weight rejection.
  - Status: `PASS`
  - Expected: over-reservation/consumption/adjustment is rejected atomically with no counters/events changed.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-010` Exact count is never inferred from weight.
  - Status: `PASS`
  - Procedure: use fixtures with non-proportional count/weight and partial historical semantics.
  - Expected: count follows explicit count evidence, not weight ratio.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-011` Deterministic multi-source locking concurrency.
  - Status: `FAIL`
  - Procedure: concurrently reserve the same two sources in opposite client order.
  - Expected: no deadlock; one or both succeed only within aggregate balance; final sources never go negative.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAL-012` Shared mutation idempotency.
  - Status: `FAIL`
  - Expected: duplicate keys replay one result; distinct keys cannot overconsume a source.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

## 13. Phase F: Packing batch lifecycle and source reservation

- [x] `DV2-BAT-001` Create stock-driven generic DRAFT batch.
  - Status: `PASS`
  - Expected: `PB-YYYYMMDD-NNNN`, recipe snapshot, neutral customer, delivery mode, exact targets, actor/version, and no reservation.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-002` Create customer-driven DRAFT batch.
  - Status: `FAIL`
  - Expected: one customer copied to batch; recipe/customer compatibility enforced.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-003` Edit DRAFT metadata and targets with mandatory amendment reason.
  - Status: `FAIL`
  - Expected: valid edit increments version and adds administrative/target evidence; missing reason or stale version fails.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-004` Stage one and multiple Coning sources while DRAFT.
  - Status: `PASS`
  - Expected: source snapshots and exact planned reservation values display; availability remains unreserved until confirm.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-005` Reject duplicate source, duplicate source delta, barcode mismatch, invalid type, and nonexistent source.
  - Status: `PASS`
  - Expected: stable error and atomic no-op.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-006` Confirm a valid DRAFT batch.
  - Status: `FAIL`
  - Expected: exact sources lock/reserve; state `CONFIRMED`; `BATCH_CONFIRMED` and `SOURCE_RESERVED` events; idempotent replay.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-007` Reject confirmation without source or with insufficient balance.
  - Status: `FAIL`
  - Expected: no partial reservations or events; batch stays DRAFT.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-008` Modify source reservation in CONFIRMED state.
  - Status: `FAIL`
  - Expected: add/release delta preserves exact target totals, appends reserve/release events, and updates shared availability once.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-009` Reject invalid release or projected source total mismatch.
  - Status: `FAIL`
  - Expected: cannot release consumed quantity or exceed residual; operation is atomic.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-010` Start a CONFIRMED batch.
  - Status: `FAIL`
  - Expected: `IN_PROGRESS`, started timestamp, version increment, `BATCH_STARTED`, idempotent replay.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-011` Delivery mode lifecycle.
  - Status: `PASS`
  - Expected: editable in DRAFT/CONFIRMED under compatibility rules; locked after start.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-012` Optimistic concurrency on batch edits/transitions.
  - Status: `PASS`
  - Procedure: issue two writes with the same version.
  - Expected: one succeeds, one returns `stale_version`; no lost update.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-013` Target amendment before overproduction.
  - Status: `FAIL`
  - Expected: sealing above current target fails; valid reasoned amendment updates target/event and permits only the amended amount.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-014` Reject target below completed output.
  - Status: `PASS`
  - Expected: stable error, unchanged target.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-015` Void DRAFT/CONFIRMED/no-output IN_PROGRESS batch.
  - Status: `FAIL`
  - Expected: mandatory reason, state `VOIDED`, reservations fully released, append-only events, no source deletion.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-016` Reject void after completed output.
  - Status: `FAIL`
  - Expected: `batch_output_exists`/not-voidable error; output and reservations unchanged.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-017` Partial completion and short close.
  - Status: `FAIL`
  - Expected: state moves through `PARTIALLY_COMPLETED` to `SHORT_CLOSED`; reason recorded; unused reservation released exactly; notification emitted once.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-018` Full completion.
  - Status: `PASS`
  - Expected: exact target output yields `COMPLETED`, completion timestamp/event, all source reservation accounted, batch notification once.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-019` Reject every unspecified batch transition.
  - Status: `FAIL`
  - Expected: transition service rejects, route does not assign status directly, and no audit/counter drift occurs.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

- [x] `DV2-BAT-020` Batch list/detail/history pagination and filters.
  - Status: `PASS`
  - Expected: status/customer/recipe filters, cursors, limits, lazy details, and bounded history have no duplicate/omitted rows.
  - Evidence: qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json; qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json

## 14. Phase G: physical hierarchy, sealing, labels, and quality

- [x] `DV2-UNIT-001` Build a valid single-level stock unit.
  - Status: `FAIL`
  - Expected: level/package/master snapshots, exact count and weights, stock flag, sequence, actor, and `IN_PROGRESS` state are correct.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-001-20260821192246625-DV2-UNIT-001-drain-00002` through `DV2-UNIT-001-20260821192520448-DV2-UNIT-001-drain-00006`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-001-submit-failure.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-001.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-001.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab as the ordinary Packing WRITE user, open `/app/packing`, open `PB-20260821-0006`, choose Build containers, enter level-1 QA Packet with base count 10, nominal gram 125, gross 1.375 kg, tare 0.125 kg, net 1.25 kg, and click Add unit. The visible result is `Packing request failed` / `Illegal invocation`; the form remains and no container is created. API and direct QA-database proof show zero physical units and no state drift.

- [x] `DV2-UNIT-002` Build a valid multi-level hierarchy.
  - Status: `PASS`
  - Expected: parent/child levels, package kinds, capacities, base counts, composition, and recipe-selected stock level are enforced.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-002-20260821195534539-DV2-UNIT-002-drain-00007` and `DV2-UNIT-002-20260821195600337-DV2-UNIT-002-drain-00008`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-002-containers.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-002.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-002.json`.

- [x] `DV2-UNIT-003` Reject invalid parent and hierarchy structures.
  - Status: `PASS`
  - Procedure: cycle, same/lower parent level, wrong batch, capacity exceeded, base mismatch, package mismatch, incomplete/unexpected children, too deep/large.
  - Expected: atomic stable errors; no orphan unit.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-UNIT-003-20260821195837101-DV2-UNIT-003-drain-00009`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-003-builder.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-003.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-003.json`.

- [x] `DV2-UNIT-004` Seal within warning threshold.
  - Status: `FAIL`
  - Expected: no reason required; barcode allocated; label evidence succeeds; `UNIT_SEALED`; source consumption exact; status `AVAILABLE` or `RESERVED`.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-004-20260821200335586-DV2-UNIT-004-drain-00011` and `DV2-UNIT-004-20260821200354252-DV2-UNIT-004-drain-00012`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-004-submit-failure.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-004.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-004.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab on `PB-20260821-0037`, open the level-1 IN_PROGRESS unit Actions, click Seal, accept the prefilled exact warning-boundary values (10 base, gross 1.4 kg, tare 0.125 kg, net 1.275 kg), and click Seal and print label. The visible result is Packing request failed / Illegal invocation; API and DB reads show the unit remains IN_PROGRESS without barcode, label print, source consumption, or seal event.

- [x] `DV2-UNIT-005` Seal above warning and at/below approval threshold.
  - Status: `FAIL`
  - Expected: missing reason fails; reasoned seal succeeds and stores planned/actual/variance/threshold/actor evidence.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-005-20260821200604211-DV2-UNIT-005-drain-00013` through `DV2-UNIT-005-20260821200645534-DV2-UNIT-005-drain-00015`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-005-submit-failure.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-005.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-005.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab on `PB-20260821-0038`, open the IN_PROGRESS unit's Seal form, enter reason `QA approval-band variance reason` for the 4% variance (10 base, gross 1.425 kg, tare 0.125 kg, net 1.3 kg), leave approval confirmation unchecked, and submit Seal and print label. The visible result is Packing request failed / Illegal invocation; API and DB reads show no seal transition.

- [x] `DV2-UNIT-006` Seal above approval threshold.
  - Status: `FAIL`
  - Expected: reason alone fails; explicit confirmation plus reason succeeds; variance notification once.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-006-20260821200823548-DV2-UNIT-006-drain-00016` through `DV2-UNIT-006-20260821200901601-DV2-UNIT-006-drain-00018`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-006-submit-failure.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-006.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-006.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab on `PB-20260821-0024`, open the above-approval Seal form, enter `QA above-approval variance reason`, check Explicitly confirm above approval variance threshold for 8% variance (10 base, gross 1.625 kg, tare 0.125 kg, net 1.5 kg), and submit. The visible result is Packing request failed / Illegal invocation; API and DB reads show no seal or variance notification.

- [x] `DV2-UNIT-007` Validate physical weights.
  - Status: `PASS`
  - Expected: gross, tare, and net are required and mutually consistent; negative, zero where prohibited, NaN, and conservation mismatch fail.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-UNIT-007-20260821201004992-DV2-UNIT-007-drain-00019`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-007-weight-form.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-007.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-007.json`.

- [x] `DV2-UNIT-008` Label contents and barcode format.
  - Status: `PASS`
  - Expected: label contains exactly barcode, minimal item identity, and exact base count; no customer, weight, batch, or recipe detail; barcode is `PKU-<batch>-L<level>-U<sequence>` and globally unique.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-UNIT-008-20260821201216764-DV2-UNIT-008-drain-00020`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-008-label-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-008.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-008.json`.

- [x] `DV2-UNIT-009` Label-generation failure and recovery.
  - Status: `FAIL`
  - Procedure: use an isolated controlled failure around label evidence/generation.
  - Expected: unit becomes `LABEL_PENDING`, is unavailable, retains recoverable identity, and retry with evidence completes once without double consumption.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-009-20260821201944098-DV2-UNIT-009-drain-00021` through `DV2-UNIT-009-20260821202950412-DV2-UNIT-009-drain-00002`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-009-label-pending-row.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-009-retry-submit-failure-replacement.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-009.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-009.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab on `PB-20260821-0039`, a QA-only transaction temporarily blanked the recipe item name, then restored the exact master value after the API seal returned `LABEL_PENDING` with barcode `PKU-PB-20260821-0039-L1-U0001` and one consumed source. The visible Containers row exposed Retry label; after entering `QA label master restored after controlled failure` and clicking the visible Retry label submit, the UI displayed Illegal invocation and remained Label Pending. The authorized API recovery then produced AVAILABLE once, labelPrintCount 1, exactly one UNIT_SEALED plus one recovered UNIT_LABEL_REPRINTED event, and an idempotent replay with no additional consumption. The Browser-visible retry defect blocks the expected user workflow even though the controlled API recovery path is consistent.

- [x] `DV2-UNIT-010` Label reprint.
  - Status: `FAIL`
  - Expected: mandatory reason/evidence as implemented, same identity, incremented print count, one `UNIT_LABEL_REPRINTED` event, no stock change, idempotent replay.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-UNIT-010-20260821205753755-DV2-UNIT-010-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-010-packed-stock-view-bounded-replacement.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-010.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-010.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab as Packing WRITE, open `/app/stock` and select Packed Stock while attempting the UNIT-010 label reprint action. The visible route retains the legacy Stock surface without a Packed Stock row or row-level reprint control, so the expected reasoned reprint workflow fails at the product UI.

- [x] `DV2-UNIT-011` Barcode replacement.
  - Status: `FAIL`
  - Expected: reason and valid print confirmation required; old/new identity linkage retained; uniqueness enforced; no count/weight change.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-011-20260821210322264-DV2-UNIT-011-drain-00002`, `DV2-UNIT-011-20260821210336082-DV2-UNIT-011-drain-00003`, and `DV2-UNIT-011-20260821210402710-DV2-UNIT-011-drain-00004`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-011-container-actions.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-011.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-011.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab on the completed UNIT-011 Packing batch, open the unit Actions menu and attempt barcode replacement. The visible menu exposes Damage and Write off only, with no barcode replacement or reprint control, so the expected reasoned replacement workflow fails at the product UI.

- [x] `DV2-UNIT-012` Quality-hold recipe sealing.
  - Status: `PASS`
  - Expected: sealed unit enters `QUALITY_HOLD`, is absent from dispatchable stock, and emits one exception notification.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-012-20260821211638638-DV2-UNIT-012-drain-00002` and `DV2-UNIT-012-20260821211845209-DV2-UNIT-012-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-012-quality-hold-containers.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-012.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-012.json`.

- [x] `DV2-UNIT-013` Quality release.
  - Status: `FAIL`
  - Expected: only Packing WRITE, mandatory reason, release timestamp/event, status `AVAILABLE` or `RESERVED` based on customer, idempotent.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-013-20260821211955113-DV2-UNIT-013-drain-00002`, `DV2-UNIT-013-20260821212019460-DV2-UNIT-013-drain-00002`, `DV2-UNIT-013-20260821212603015-DV2-UNIT-013-drain-00002`, and `DV2-UNIT-013-20260821212624699-DV2-UNIT-013-drain-00002`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-013-quality-release-containers.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-013-quality-release-submit.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-013.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-013.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab on `PB-20260821-0030`, open Containers, open the QUALITY_HOLD unit Actions menu, enter `QA quality check completed`, and click the visible Release quality submit control. The visible result is `Illegal invocation`; the form remains open and the unit stays QUALITY_HOLD. API and direct QA-database proof record the independent service result and no duplicate release event.

- [x] `DV2-UNIT-014` Customer copy at sealing.
  - Status: `PASS`
  - Expected: neutral batch -> AVAILABLE neutral unit; customer batch -> RESERVED unit for that customer.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-014-20260821212709986-DV2-UNIT-014-drain-00002` and `DV2-UNIT-014-20260821212726117-DV2-UNIT-014-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-014-customer-container.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-014.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-014.json`.

- [x] `DV2-UNIT-015` Completed-unit immutability.
  - Status: `PASS`
  - Expected: direct physical field/status mutation through service/API is unavailable; inventory-affecting changes create events/new identities.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-015-20260821212758667-DV2-UNIT-015-drain-00002` and `DV2-UNIT-015-20260821212822196-DV2-UNIT-015-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-015-immutable-container.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-015.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-015.json`.

- [x] `DV2-UNIT-016` Seal concurrency and idempotency.
  - Status: `FAIL`
  - Procedure: simultaneous same-key and distinct-key seals against one unit.
  - Expected: one physical seal/consumption; replay is stable; competing invalid call fails with no duplicate barcode/event.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-016-20260821212855791-DV2-UNIT-016-drain-00002`, `DV2-UNIT-016-20260821213327134-DV2-UNIT-016-drain-00002`, `DV2-UNIT-016-20260821213406242-DV2-UNIT-016-drain-00002`, and `DV2-UNIT-016-20260821213440545-DV2-UNIT-016-drain-00002`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-016-seal-form.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-016-seal-submit.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-016.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-016.json`.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab on PB-20260821-0033, open the In Progress unit's Containers Actions menu, click Seal, accept the displayed actual values 10 base, gross 1.375 kg, tare 0.125 kg, net 1.25 kg, and click Seal and print label. The visible result is Packing request failed / Illegal invocation and the batch remains In Progress. Independent API/DB reconciliation completed one seal with one source consumption and stable same-key replay, but the required visible workflow failed.

- [x] `DV2-UNIT-017` Unit detail and history pagination.
  - Status: `PASS`
  - Expected: full hierarchy/master/customer snapshots and chronological append-only events load without unbounded fetch.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-017-20260821213535654-DV2-UNIT-017-drain-00002`, `DV2-UNIT-017-20260821213553764-DV2-UNIT-017-drain-00002`, and `DV2-UNIT-017-20260821213623861-DV2-UNIT-017-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-017-history-payload.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-017.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-017.json`.

- [x] `DV2-UNIT-018` Parent barcode rules.
  - Status: `PASS`
  - Expected: parent receives barcode only when recipe enables it; actionable stock children always receive their required barcode.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-UNIT-018-20260821213658114-DV2-UNIT-018-drain-00002` and `DV2-UNIT-018-20260821213716359-DV2-UNIT-018-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-UNIT-018-containers.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-UNIT-018.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-UNIT-018.json`.

## 15. Phase H: Packed Stock UI, filters, and customer reservation

- [x] `DV2-STK-001` Packed Stock is listed only in Stock.
  - Status: `FAIL`
  - Expected: one list/action surface under Stock; Packing owns batches but does not duplicate the Packed Stock list.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-001-20260821214116847-DV2-STK-001-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-001-packed-stock-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-001.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-001.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab on `/app/stock`, click the visible Packed Stock button. The button becomes active but the legacy Stock filters/table remain and the table stays Loading; no Packed Stock list/action surface renders despite direct `/api/packed-stock` rows.

- [x] `DV2-STK-002` Packed Stock list filters and cursor pagination.
  - Status: `FAIL`
  - Procedure: status, customer, barcode, item, text search, batch kind, opening/damaged/returned/repacked/voided filters, and load more.
  - Expected: bounded stable pages with no duplicates/omissions and correct totals for the fixture set.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-002-20260821214233316-DV2-STK-002-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-002-filters-replacement.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-002.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-002.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: Navigate visibly to `/app/stock?view=packed` and inspect the route. It renders the legacy Stock filters and Loading table, with no Packed Stock status/customer/batch-kind filters, stable pages, or cursor list; the direct Packed Stock API also returned a repeated first page when its next cursor was requested (`nextPageRepeatedFirstItems=true`).

- [x] `DV2-STK-003` Exact server-authoritative barcode lookup.
  - Status: `FAIL`
  - Expected: exact active identity resolves; case/whitespace normalization follows code; unknown/ambiguous identity fails stably; no notes/lot/browser array lookup.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-003-20260821214313298-DV2-STK-003-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-003-lookup.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-003.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-003.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: Enter exact barcode `PKU-PB-20260821-0027-L1-U0001` in the visible Stock search. The legacy Stock table remains Loading and no server-authoritative Packed Stock identity lookup or detail appears, although the direct Packed Stock API resolves the identity.

- [x] `DV2-STK-004` Unit detail, parent/children, and history.
  - Status: `FAIL`
  - Expected: package, count, weight, customer, batch, status, hierarchy, replacement/split lineage, and events are correct.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-004-20260821214331921-DV2-STK-004-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-004-detail.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-004.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-004.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: Click Packed Stock while attempting to inspect the residual parent/child unit. The control toggles but the legacy Stock filters/table remain Loading; no unit detail, hierarchy, or history control appears, while direct API/DB reads show the parent and children.

- [x] `DV2-STK-005` Reserve AVAILABLE neutral stock to `CUST-A`.
  - Status: `FAIL`
  - Expected: status `RESERVED`, customer set, reason/event/actor recorded, idempotent, no physical field changes.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-005-20260821214352989-DV2-STK-005-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-005-reservation-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-005.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-005.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab on `/app/stock`, select Packed Stock and attempt to reserve the named AVAILABLE neutral unit to CUST-A. The visible route renders no Packed Stock row, Reserve action, customer selector, reason field, or submit control, so the expected reservation workflow fails at the product UI.

- [x] `DV2-STK-006` Reject invalid reservation.
  - Status: `FAIL`
  - Procedure: inactive/missing customer, wrong unit state, non-stock unit, quality hold, unit reserved as Packing source, customer-restricted mismatch.
  - Expected: atomic stable errors.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-006-20260821214410855-DV2-STK-006-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-006-invalid-reservation.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-006.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-006.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: Enter the Quality Hold barcode in the visible Stock search while attempting the invalid-reservation cases. Only the legacy Stock search remains; no Packed Stock reservation form is available to submit or validate non-stock, wrong-state, or customer-restriction errors, despite direct API errors being stable.

- [x] `DV2-STK-007` Release reservation.
  - Status: `FAIL`
  - Expected: mandatory reason, customer cleared, status AVAILABLE, event/actor preserved, no automatic expiry.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-007-20260821214432044-DV2-STK-007-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-007-release-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-007.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-007.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab on `/app/stock`, select Packed Stock and attempt to release the named Reserved unit with a reason. The visible route renders no Reserved Packed Stock row, Release action, reason field, or submit control, so the expected release workflow fails at the product UI.

- [x] `DV2-STK-008` Reassign reservation from `CUST-A` to `CUST-B`.
  - Status: `FAIL`
  - Expected: mandatory reason, compatibility enforced, one reassignment event with before/after customer.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-008-20260821214458093-DV2-STK-008-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-008-reassign-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-008.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-008.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab on `/app/stock`, select Packed Stock and attempt to reassign the named Reserved unit from CUST-A to CUST-B with a reason. The visible route renders no Reserved row, target-customer selector, reason field, or reassignment submit control, so the expected reassignment workflow fails at the product UI.

- [x] `DV2-STK-009` Reject reassignment when physical composition/customer recipe is incompatible.
  - Status: `FAIL`
  - Expected: `repacking_required` or customer mismatch; existing reservation unchanged.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-009-20260821214516603-DV2-STK-009-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-009-incompatible-reassign.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-009.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-009.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: Enter the customer-restricted unit barcode in the visible Stock search. The legacy table remains Loading and no reassignment form is available to exercise the expected customer-mismatch error; direct API/DB proof shows the existing CUST-A reservation remains unchanged.

- [x] `DV2-STK-010` Reservation concurrency.
  - Status: `FAIL`
  - Procedure: two customers reserve the same AVAILABLE unit concurrently.
  - Expected: exactly one succeeds; final event/customer/status are coherent.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-010-20260821214536789-DV2-STK-010-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-010-concurrency-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-010.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-010.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: Click Packed Stock while attempting the two-customer reservation race. No Packed Stock row or reservation control renders, so two visible competing submissions cannot be made; direct API/DB proof shows exactly one reservation winner.

- [x] `DV2-STK-011` Stock label reprint/replacement actions.
  - Status: `FAIL`
  - Expected: UI exposes them only with Packing WRITE and preserves pending/confirmed print semantics.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-011-20260821214554112-DV2-STK-011-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-011-label-surface.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-011.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-011.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In authenticated iab as Packing WRITE on `/app/stock`, select Packed Stock and attempt the stock label reprint/replacement actions. The visible route renders no Packed Stock row, reprint or replacement control, reason field, or print confirmation, so the expected label workflow fails at the product UI.

- [x] `DV2-STK-012` Read-only Stock presentation.
  - Status: `FAIL`
  - Expected: READ user can inspect/filter/history but cannot reserve, release, reassign, reprint, or replace.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-STK-012-20260821215253229-DV2-STK-012-drain-00002`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-03-DV2-STK-012-read-only.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-03-DV2-STK-012.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-03-DV2-STK-012.json`.
  - Defect: `DV2-DEF-007`
  - Reproduction: In a separately authenticated Packing READ iab tab, open Stock and click Packed Stock. The button becomes active but the legacy Stock filters/table remain Loading, so the required inspect/filter/history presentation is unavailable; the direct READ API returns 200 for reads and 403 for a write attempt without DB drift.

## 16. Phase I: Dispatch V2 source adapters and unified workflow

- [x] `DV2-DSP-001` Unified responsive Dispatch route and controller.
  - Status: `FAIL`
  - Procedure: test desktop, narrow mobile, and intermediate width.
  - Expected: one shared queue/customer/draft mutation state; no duplicated desktop/mobile business logic or divergent results.
  - Evidence: Original responsive route actions `DV2-DSP-001-20260822055222321-DV2-DSP-001-drain-00002`, `DV2-DSP-001-20260822055243924-DV2-DSP-001-drain-00003`, and `DV2-DSP-001-20260822055257727-DV2-DSP-001-drain-00004` prove one shared route at desktop, phone, and intermediate widths. Correction actions `DV2-DSP-001-20260822095629151-DV2-DSP-001-drain-00002`, `DV2-DSP-001-20260822095658839-DV2-DSP-001-drain-00003`, `DV2-DSP-001-20260822095707883-DV2-DSP-001-drain-00004`, decisive submitted mutation `DV2-DSP-001-20260822095742450-DV2-DSP-001-drain-00005`, and cleanup `DV2-DSP-001-20260822095813172-DV2-DSP-001-drain-00006` show the same shared form, exact QA source staging, customer selection, visible submit failure, and empty-queue cleanup. Screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-001-*`; API/DB before-after `qa-evidence/DV2-20260821T123729Z/api/QP-04-DSP-001-visible-pre.json`, `.../api/QP-04-DSP-001-visible-after.json`, `.../db/QP-04-DSP-001-visible-pre.json`, and `.../db/QP-04-DSP-001-visible-after.json` prove the source/challan state did not drift; the original summary contract remains in `api/QP-04-DSP-001.json` and `db/QP-04-DSP-001.json`.
  - Defect: `DV2-DEF-009`
  - Reproduction: On the same responsive `/app/dispatch` controller, add QA source PKU-PB-20260821-0028-L1-U0002 at 10/1.250 kg, select +916353131826, and click visible Create Dispatch Challan. The real submitted mutation returns `residualBaseCount must be a positive integer`, retains the line, and creates no challan; clearing the queue returns the shared draft to zero lines.

- [x] `DV2-DSP-002` Lightweight source summary.
  - Status: `PASS`
  - Expected: counts for `INBOUND`, `CUTTER`, `HOLO`, `PACKED` match independent eligible counts; no complete source arrays are downloaded.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-DSP-002-20260822060640565-DV2-DSP-002-drain-00005`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-002-summary.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DSP-002.json` reports 200 summary and limit-1 source responses; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DSP-002-independent-counts.json` reconciles independent counts 20/404/492/16 to the summary.

- [x] `DV2-DSP-003` Coning is absent from new Dispatch selection.
  - Status: `FAIL`
  - Expected: no selectable Coning adapter in UI/API; historical Coning Dispatch remains readable through compatibility/history.
  - Procedure: Browser actions `DV2-DSP-003-20260822095939431-DV2-DSP-003-drain-00007`, `DV2-DSP-003-20260822095954270-DV2-DSP-003-drain-00008`, `DV2-DSP-003-20260822100649104-DV2-DSP-003-drain-00002`, decisive submitted mutation `DV2-DSP-003-20260822100708589-DV2-DSP-003-drain-00003`, and cleanup `DV2-DSP-003-20260822100725175-DV2-DSP-003-drain-00004` prove exact QA source staging, customer selection, visible submit failure, and empty-queue cleanup. Screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-003-correction-customer-recovered.png.png`, `.../screenshots/QP-04-DV2-DSP-003-correction-visible-submit.png.png`, and `.../screenshots/QP-04-DV2-DSP-003-correction-cleanup.png.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-003-visible-pre.json` and `.../api/QP-04-DV2-DSP-003-visible-after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-003-visible-pre.json` and `.../db/QP-04-DV2-DSP-003-visible-after.json` prove no source/challan/line drift after the visible failure.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-DSP-003-20260822061211301-DV2-DSP-003-drain-00006`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-003-no-coning.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-003.json` records 400 invalid_source_type for CONING and 200 compatibility history; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DSP-003.json` records historical legacy reconstructions without a Coning selection source.

  - Defect: `DV2-DEF-009`
  - Reproduction: In authenticated iab on `/app/dispatch`, stage exact QA PACKED source `PKU-PB-20260821-0028-L1-U0002` at 10/1.250 kg, select `+916353131826`, and click the visible Create Dispatch Challan control. The recorded mutation submission returns `residualBaseCount must be a positive integer`, retains the line, and creates no challan; clearing the queue removes the stranded line. The same page exposes no selectable Coning source.

- [x] `DV2-DSP-004` Inbound adapter list/search/pagination/barcode lookup.
  - Status: `PASS`
  - Expected: current legacy availability/count/weight semantics preserved and server-authoritative.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-004-20260822061354784-DV2-DSP-004-drain-00007` and `DV2-DSP-004-20260822061357298-DV2-DSP-004-drain-00008`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-004-inbound-list.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-004-inbound-search.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-004.json` records limited list, exact search, and authoritative barcode lookup; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-004.json` records the matched source and unchanged counters.

- [x] `DV2-DSP-005` Cutter adapter list/search/pagination/barcode lookup.
  - Status: `PASS`
  - Expected: same contract with Cutter semantics and exact availability.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-005-20260822061443745-DV2-DSP-005-drain-00009` and `DV2-DSP-005-20260822061445456-DV2-DSP-005-drain-00010`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-005-cutter-list.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-005-cutter-search.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-005.json` records limited list, exact search, and barcode lookup; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-005.json` records the matched Cutter row and unchanged dispatch counters.

- [x] `DV2-DSP-006` Holo adapter list/search/pagination/barcode lookup.
  - Status: `PASS`
  - Expected: downstream Coning consumption is accounted; only eligible Holo balance is dispatchable.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-006-20260822061529732-DV2-DSP-006-drain-00011` and `DV2-DSP-006-20260822061531358-DV2-DSP-006-drain-00012`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-006-holo-list.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-006-holo-search.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-006.json` records limited list, exact search, and authoritative barcode lookup; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-006.json` records Holo availability and downstream event inputs.

- [x] `DV2-DSP-007` Packed adapter list/search/pagination/barcode lookup.
  - Status: `PASS`
  - Expected: only eligible whole stock units/groups appear; count/weight/customer/parent details are exact.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-007-20260822061613035-DV2-DSP-007-drain-00013` and `DV2-DSP-007-20260822061614355-DV2-DSP-007-drain-00014`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-007-packed-list.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-007-packed-search.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-007.json` records limited list, exact search, and barcode lookup; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-007.json` records the exact Packed Unit identity, Decimal weight, status, and customer/parent fields.

- [x] `DV2-DSP-008` Mixed-source scan queue and duplicate prevention.
  - Status: `PASS`
  - Expected: exact sources from multiple supported adapters can enter one draft; duplicate source identity is rejected client-side and server-side.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-008-20260822061710799-DV2-DSP-008-drain-00015`, `DV2-DSP-008-20260822061714298-DV2-DSP-008-drain-00016`, `DV2-DSP-008-20260822061717044-DV2-DSP-008-drain-00017`, `DV2-DSP-008-20260822061718492-DV2-DSP-008-drain-00018`, and `DV2-DSP-008-20260822061735766-DV2-DSP-008-drain-00019`; screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-008-*`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-008.json` records the three exact source lookups and `api/QP-04-DV2-DSP-008-post.json` records server-side duplicate rejection; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-008.json` records no challan or source-counter drift.

- [x] `DV2-DSP-009` Customer lock in queue.
  - Status: `FAIL`
  - Expected: reserved Packed Unit establishes/obeys customer compatibility; conflicting source/customer cannot be added or submitted.
  - Evidence: Browser actions `DV2-DSP-009-20260822061943154-DV2-DSP-009-drain-00020` and `DV2-DSP-009-20260822061945410-DV2-DSP-009-drain-00021` show CUST-A reserved source PKU-PB-20260821-0032-L1-U0002 establishing the +916353131826 lock, followed by conflicting K J E source PKU-PB-20260821-0034-L1-U0001 being admitted to the visible queue; `DV2-DSP-009-20260822062018479-DV2-DSP-009-drain-00022` records cleanup. Screenshots: `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-009-customer-lock.png`, `.../QP-04-DV2-DSP-009-conflict-attempt.png`, and `.../QP-04-DV2-DSP-009-cleanup.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-009-post.json` returns the authoritative customer-reservation conflict, and DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-009.json` proves no challan or source-counter drift.
  - Defect: `DV2-DEF-008`
  - Reproduction: Add reserved `PKU-PB-20260821-0032-L1-U0002` for +916353131826, then add conflicting reserved `PKU-PB-20260821-0034-L1-U0001` for K J E. The visible queue admits both sources even though the customer selector is locked; the API rejects the conflicting payload with `customer_reservation_mismatch` and DB evidence shows no server mutation.

- [x] `DV2-DSP-010` Create Inbound-only challan.
  - Status: `FAIL`
  - Expected: unique fiscal challan, DATE business date, immutable company/customer snapshots, exact line/counters/event/document snapshot, replay-safe.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-010-20260822062137081-DV2-DSP-010-drain-00023`, `DV2-DSP-010-20260822062138100-DV2-DSP-010-drain-00024`, `DV2-DSP-010-20260822062148807-DV2-DSP-010-drain-00025`, and `DV2-DSP-010-20260822062219588-DV2-DSP-010-drain-00026`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-010-submit-result.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-010-pre-api.json`, `QP-04-DV2-DSP-010-api-contract-post.json`, and `QP-04-DV2-DSP-010-after-api.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-010-pre-api.json` and `QP-04-DV2-DSP-010-after-api.json`.
  - Defect: `DV2-DEF-009`
  - Reproduction: Add full Inbound `INB-124-001`, select `+916353131826`, and click the visible Create Dispatch Challan control. The Browser action records `mutationSubmitted: true`, but the page shows `residualBaseCount must be a positive integer` and retains the draft. The API succeeds only when optional partial fields are omitted, so the visible valid full-line workflow fails at its submit payload.

- [x] `DV2-DSP-011` Create Cutter-only challan.
  - Status: `FAIL`
  - Expected: legacy source counter changes once and V2 line/event/history are correct.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-011-20260822062350742-DV2-DSP-011-drain-00027`, `DV2-DSP-011-20260822062351713-DV2-DSP-011-drain-00028`, `DV2-DSP-011-20260822062401735-DV2-DSP-011-drain-00029`, and `DV2-DSP-011-20260822062410794-DV2-DSP-011-drain-00030`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-011-submit-result.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-011-pre-api.json`, `QP-04-DV2-DSP-011-api-contract-post.json`, and `QP-04-DV2-DSP-011-after-api.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-011-pre-api.json` and `QP-04-DV2-DSP-011-after-api.json`.
  - Defect: `DV2-DEF-009`
  - Reproduction: Add full Cutter `RCU-102-002-C004`, select `+916353131826`, and click Create Dispatch Challan. The Browser action records `mutationSubmitted: true`, but the visible submit returns `residualBaseCount must be a positive integer` and leaves the line staged. A supplemental API call with optional partial fields omitted succeeds and changes the counter once, isolating the UI payload defect.

- [x] `DV2-DSP-012` Create Holo-only challan.
  - Status: `FAIL`
  - Expected: available Holo balance changes once, downstream constraints respected.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-012-20260822062508315-DV2-DSP-012-drain-00031`, `DV2-DSP-012-20260822062509318-DV2-DSP-012-drain-00032`, `DV2-DSP-012-20260822062522036-DV2-DSP-012-drain-00033`, and `DV2-DSP-012-20260822062523522-DV2-DSP-012-drain-00034`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-012-submit-result.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-012-pre-api.json`, `QP-04-DV2-DSP-012-api-contract-post.json`, and `QP-04-DV2-DSP-012-after-api.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-012-pre-api.json` and `QP-04-DV2-DSP-012-after-api.json`.
  - Defect: `DV2-DEF-009`
  - Reproduction: Add full Holo `RHO-10419-C002`, select `+916353131826`, and click Create Dispatch Challan. The visible submit records `mutationSubmitted: true` but returns `residualBaseCount must be a positive integer` and leaves the line staged; a supplemental API call omitting optional partial fields succeeds and changes the Holo balance once.

- [x] `DV2-DSP-013` Create mixed Inbound/Cutter/Holo challan.
  - Status: `FAIL`
  - Expected: deterministic locking, one atomic challan, all source updates, no partial success.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-013-20260822062633779-DV2-DSP-013-drain-00035`, `DV2-DSP-013-20260822062637222-DV2-DSP-013-drain-00036`, `DV2-DSP-013-20260822062640437-DV2-DSP-013-drain-00037`, `DV2-DSP-013-20260822062641795-DV2-DSP-013-drain-00038`, `DV2-DSP-013-20260822062654401-DV2-DSP-013-drain-00039`, and `DV2-DSP-013-20260822062655732-DV2-DSP-013-drain-00040`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-013-submit-result.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-013-pre-api.json`, `QP-04-DV2-DSP-013-api-contract-post.json`, and `QP-04-DV2-DSP-013-after-api.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-013-pre-api.json` and `QP-04-DSP-013-after-api.json`.
  - Defect: `DV2-DEF-009`
  - Reproduction: Stage full Inbound `INB-124-002`, Cutter `RCU-102-002-C006`, and Holo `RHO-10135-C001`, select `+916353131826`, and click Create Dispatch Challan. The Browser mutation submission returns `residualBaseCount must be a positive integer` before any source changes; a supplemental API call with omitted optional partial fields succeeds atomically for all three sources.

- [x] `DV2-DSP-014` Reject malformed or excessive challan payloads.
  - Status: `PASS`
  - Procedure: missing/invalid customer/date/lines/source, inactive customer, duplicate source, too many lines, invalid counts/weights, unavailable source.
  - Expected: stable error and complete rollback.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-014-20260822062813572-DV2-DSP-014-drain-00041`, `DV2-DSP-014-20260822062814731-DV2-DSP-014-drain-00042`, `DV2-DSP-014-20260822062816250-DV2-DSP-014-drain-00043`, and `DV2-DSP-014-20260822062817859-DV2-DSP-014-drain-00044`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-014-missing-customer-result.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-014-malformed-suite.json` records stable 400 errors for missing customer, invalid source type, and 201-line payload; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-014-pre.json` and `QP-04-DV2-DSP-014-after.json` show no challan/source drift.

- [x] `DV2-DSP-015` Challan creation idempotency.
  - Status: `PASS`
  - Expected: identical key replays same challan; no second source consumption, event, document, or sequence allocation.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-015-20260822063013337-DV2-DSP-015-drain-00045` and `DV2-DSP-015-20260822063046276-DV2-DSP-015-drain-00046`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-015-history-replay.png` and `QP-04-DV2-DSP-015-history-filtered.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-015-idempotency.json` records first response `replay:false` and second response `replay:true` with the same challan ID/number; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-015-pre.json` and `QP-04-DV2-DSP-015-after.json` reconcile one source consumption, one challan, one document, and one event path.

- [x] `DV2-DSP-016` Challan creation concurrency on one source.
  - Status: `PASS`
  - Expected: at most available quantity is dispatched; losing request fails; no negative/duplicate counter.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-DSP-016-20260822063130162-DV2-DSP-016-drain-00047`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-016-concurrency-target.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-016-concurrency.json` records one 200 winner and one 409 `dispatch_source_unavailable`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-016-pre.json` and `QP-04-DV2-DSP-016-after.json` reconcile one source dispatch, one challan, and no negative counter.

- [x] `DV2-DSP-017` Challan headers, filters, cursor pagination, and lazy detail.
  - Status: `PASS`
  - Expected: customer/status/from/to/search/includeLegacy work; page load does not fetch all details or all history.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-017-20260822063609317-DV2-DSP-017-drain-00002`, `DV2-DSP-017-20260822063619056-DV2-DSP-017-drain-00003`, and `DV2-DSP-017-20260822063630629-DV2-DSP-017-drain-00004`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-017-history-headers-recovered.png`, `QP-04-DV2-DSP-017-history-filter-recovered.png`, and `QP-04-DV2-DSP-017-lazy-detail-recovered.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DSP-017.json` and `QP-04-DV2-DSP-017-cursor-filters.json` record bounded headers, nextCursor advancement, customer/status/date/search/includeLegacy filters, and separate detail response; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-017.json` records header/detail row separation.

- [x] `DV2-DSP-018` Business-date semantics.
  - Status: `PASS`
  - Expected: PostgreSQL DATE preserves selected business date across IST/UTC boundaries and UI/API/export/PDF.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-018-20260822063837365-DV2-DSP-018-drain-00005` and `DV2-DSP-018-20260822063848155-DV2-DSP-018-drain-00006`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-018-business-date-form.png` and `QP-04-DV2-DSP-018-date-cleanup.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-018-api-contract-post.json`, `QP-04-DV2-DSP-018-document-date.json`, and `QP-04-DV2-DSP-018-after.json` preserve 2026-08-21 through detail, export, and PDF; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-018-pre.json` and `QP-04-DV2-DSP-018-after.json` record the DATE value and source transition.

## 17. Phase J: whole, partial, and parent Packed Dispatch

- [x] `DV2-PACKDSP-001` Whole AVAILABLE generic Packed Unit Dispatch.
  - Status: `FAIL`
  - Expected: exact unit count/weight, status `DISPATCHED`, line source `PACKED`, immutable identity, one event path.
  - Evidence: Browser actions `DV2-PACKDSP-001-20260822065006916-DV2-PACKDSP-001-drain-00007`, `DV2-PACKDSP-001-20260822065017559-DV2-PACKDSP-001-drain-00008`, and decisive visible submit `DV2-PACKDSP-001-20260822065027971-DV2-PACKDSP-001-drain-00009` show exact barcode PKU-PB-20260821-0039-L1-U0001, 10/1.250 kg, queue admission, and the submitted whole Dispatch failure. Recovery action `DV2-PACKDSP-001-20260822065836427-DV2-PACKDSP-001-drain-00002` shows no staged orphan line. Screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-PACKDSP-001-*`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-001-pre.json`, `.../post.json`, and `.../after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-001-pre.json` and `.../after.json` prove no UI-created challan or source transition.
  - Defect: `DV2-DEF-009`
  - Reproduction: Filter exact AVAILABLE generic Packed Unit PKU-PB-20260821-0039-L1-U0001, add its 10/1.250 kg line, and click the visible Create Dispatch Challan control. The submitted UI request fails with `residualBaseCount must be a positive integer`, leaving the line staged; no visible whole Dispatch is created although a full source should be accepted.

- [x] `DV2-PACKDSP-002` Whole `CUST-A` RESERVED unit to `CUST-A`.
  - Status: `FAIL`
  - Expected: succeeds and preserves customer evidence.
  - Evidence: Browser actions `DV2-PACKDSP-002-20260822070013286-DV2-PACKDSP-002-drain-00003`, `DV2-PACKDSP-002-20260822070023998-DV2-PACKDSP-002-drain-00004`, and decisive visible submit `DV2-PACKDSP-002-20260822070031506-DV2-PACKDSP-002-drain-00005` show exact CUST-A reserved barcode PKU-PB-20260821-0032-L1-U0002, 10/1.250 kg, customer lock, and submitted whole Dispatch failure; cleanup `DV2-PACKDSP-002-20260822070050654-DV2-PACKDSP-002-drain-00006` leaves the visible queue empty. Screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-PACKDSP-002-*`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-002-pre.json`, `.../post.json`, and `.../after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-002-pre.json` and `.../after.json` prove no UI-created challan and preserved source/customer state.
  - Defect: `DV2-DEF-009`
  - Reproduction: Filter reserved CUST-A unit PKU-PB-20260821-0032-L1-U0002, add the exact full line, and click the visible Create Dispatch Challan control with CUST-A selected. The submitted visible workflow returns `residualBaseCount must be a positive integer` and retains the line instead of dispatching it.

- [x] `DV2-PACKDSP-003` Reject `CUST-A` RESERVED unit to `CUST-B`.
  - Status: `PASS`
  - Expected: customer mismatch, no challan/line/status change.
  - Evidence: Browser actions `DV2-PACKDSP-003-20260822070134028-DV2-PACKDSP-003-drain-00007`, `DV2-PACKDSP-003-20260822070144154-DV2-PACKDSP-003-drain-00008`, `DV2-PACKDSP-003-20260822070224880-DV2-PACKDSP-003-drain-00009`, and cleanup `DV2-PACKDSP-003-20260822070329354-DV2-PACKDSP-003-drain-00010` show the CUST-A reserved source, its visible customer lock, and the disabled CUST-B selector that prevents a conflicting customer from being chosen. Screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-PACKDSP-003-*`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-003.json`, `.../post.json`, and `.../after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-003.json` and `.../after.json` prove no challan, line, or source-state mutation.

- [x] `DV2-PACKDSP-004` Reject non-dispatchable Packed states.
  - Status: `PASS`
  - Procedure: quality hold, label pending, damaged, repacked, split-consumed, opened parent, voided, returned-pending-inspection, already dispatched, in-progress.
  - Expected: stable state-specific rejection.
  - Evidence: Browser actions `DV2-PACKDSP-004-20260822070401931-DV2-PACKDSP-004-drain-00011`, `DV2-PACKDSP-004-20260822070413403-DV2-PACKDSP-004-drain-00012`, and `DV2-PACKDSP-004-20260822070454268-DV2-PACKDSP-004-drain-00013` show the QUALITY_HOLD source omitted from the visible candidate list, its exact barcode lookup rejected, and the queue cleared. API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-004-state-suite.json` records stable state-specific 409 responses for QUALITY_HOLD, VOIDED, DISPATCHED, barcode-pending IN_PROGRESS, and an ineligible parent; API pre/after `.../api/QP-04-DV2-PACKDSP-004-pre.json` and `.../after.json` plus DB pre/after `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-004-pre.json` and `.../after.json` prove no source or challan drift.

- [x] `DV2-PACKDSP-005` Reject partial request when recipe disables partial.
  - Status: `PASS`
  - Expected: source remains whole and unchanged.
  - Evidence: Browser actions `DV2-PACKDSP-005-20260822070513400-DV2-PACKDSP-005-drain-00014`, `DV2-PACKDSP-005-20260822070520899-DV2-PACKDSP-005-drain-00015`, `DV2-PACKDSP-005-20260822070541793-DV2-PACKDSP-005-drain-00016`, and cleanup `DV2-PACKDSP-005-20260822070603181-DV2-PACKDSP-005-drain-00017` show generic source PKU-PB-20260821-0037-L1-U0001 at 10/1.275 kg, no partial option, disabled count/weight controls, and unchanged empty queue after the attempt. API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-005-pre.json`, `.../post.json`, and `.../after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-005-pre.json` and `.../after.json` prove the recipe-disabled source stayed AVAILABLE and no challan or child was created.

- [x] `DV2-PACKDSP-006` Valid partial Dispatch.
  - Status: `PASS`
  - Expected: one transaction retires source as `SPLIT_CONSUMED`, creates dispatched child identity and newly barcoded residual child, retains residual customer, creates line/events, and conserves exact count/weight.
  - Evidence: Browser actions `DV2-PACKDSP-006-20260822071212768-DV2-PACKDSP-006-drain-00002`, `DV2-PACKDSP-006-20260822071231690-DV2-PACKDSP-006-drain-00003`, `DV2-PACKDSP-006-20260822071254819-DV2-PACKDSP-006-drain-00004`, `DV2-PACKDSP-006-20260822071306824-DV2-PACKDSP-006-drain-00005`, `DV2-PACKDSP-006-20260822071346802-DV2-PACKDSP-006-drain-00006`, and `DV2-PACKDSP-006-20260822071414257-DV2-PACKDSP-006-drain-00007` prove exact source lookup, partial mode, conservation inputs, and submitted result. Screenshots: `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-PACKDSP-006-filter-gap-recovered.png`, `.../QP-04-DV2-PACKDSP-006-filter-replacement.png`, `.../QP-04-DV2-PACKDSP-006-partial-source-added.png`, `.../QP-04-DV2-PACKDSP-006-partial-enabled.png`, `.../QP-04-DV2-PACKDSP-006-values-entered.png`, `.../QP-04-DV2-PACKDSP-006-submit-result.png`. API/DB before-after: `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-006-after.json`, `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-006-pre.json`, and `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-006-after.json`; DB shows source `PKU-PB-20260821-0030-L1-U0001` as `SPLIT_CONSUMED`, dispatched child `...U0002` as `DISPATCHED` at 4/0.5, residual child `...U0003` as `RESERVED` at 6/0.75 with customer retained, a `UNIT_SPLIT` event, challan `DC/26-27/140`, and exact 10/1.25 conservation.

- [x] `DV2-PACKDSP-007` Partial reason, counts, and weights validation.
  - Status: `FAIL`
  - Procedure: missing reason, zero/negative/excess count, missing residual, mismatched total count, mismatched weight, and ambiguous damaged/lost values.
  - Expected: each fails atomically; no child/barcode/line.
  - Evidence: Screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-PACKDSP-007-filtered-residual.png`, `.../QP-04-DV2-PACKDSP-007-residual-staged.png`, `.../QP-04-DV2-PACKDSP-007-partial-controls.png`, `.../QP-04-DV2-PACKDSP-007-missing-residual-rejected.png`, and `.../QP-04-DV2-PACKDSP-007-excess-conservation-rejected.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-007-pre.json`, `.../QP-04-DV2-PACKDSP-007-validation-suite.json`, and `.../QP-04-DV2-PACKDSP-007-after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-007-pre.json` and `.../QP-04-DV2-PACKDSP-007-after.json`. The validation suite records the other malformed cases as 400 or stable post-consumption conflicts; the after snapshot proves the invalid excess request consumed the residual whole at 6/0.75 with no residual child, so the required atomic rejection and conservation invariant failed.
  - Evidence: Screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-PACKDSP-007-filtered-residual.png`, `.../QP-04-DV2-PACKDSP-007-residual-staged.png`, `.../QP-04-DV2-PACKDSP-007-partial-controls.png`, `.../QP-04-DV2-PACKDSP-007-missing-residual-rejected.png`, and `.../QP-04-DV2-PACKDSP-007-excess-conservation-rejected.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-007-pre.json`, `.../QP-04-DV2-PACKDSP-007-validation-suite.json`, and `.../QP-04-DV2-PACKDSP-007-after.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-007-pre.json` and `.../QP-04-DV2-PACKDSP-007-after.json`. The validation suite records the other malformed cases as 400 or stable post-consumption conflicts; the after snapshot proves the invalid excess request consumed the residual whole at 6/0.75 with no residual child, so the required atomic rejection and conservation invariant failed.
  - Defect: `DV2-DEF-010`
  - Reproduction: Browser actions `DV2-PACKDSP-007-20260822072046533-DV2-PACKDSP-007-drain-00008`, `DV2-PACKDSP-007-20260822072142327-DV2-PACKDSP-007-drain-00009`, `DV2-PACKDSP-007-20260822072208551-DV2-PACKDSP-007-drain-00010`, `DV2-PACKDSP-007-20260822072244195-DV2-PACKDSP-007-drain-00011`, and `DV2-PACKDSP-007-20260822072309559-DV2-PACKDSP-007-drain-00012` prove the residual source was filtered, staged, partial mode enabled, and missing/excess values were rejected visibly without submission. The direct validation suite then submitted the exact excess-count case `baseCount=6`, `netWeightKg=0.75`, `residualBaseCount=7`, `residualNetWeightKg=0.875` against source `PKU-PB-20260821-0030-L1-U0003`; the API returned 200 and created `DC/26-27/141` instead of rejecting the invalid conservation.

- [x] `DV2-PACKDSP-008` Partial Dispatch with explicit damaged/lost count.
  - Status: `PASS`
  - Expected: dispatched + residual + damaged/lost count and weight conservation is exact; loss identity/event is explicit.
  - Evidence: Supported fixture `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-008-fixture.json` and `.../db/QP-04-DV2-PACKDSP-008-fixture.json` established reserved source `RCO-3487-C002` with exact 10/1.25 conservation. Browser actions `DV2-PACKDSP-008-20260822073113636-DV2-PACKDSP-008-drain-00013`, `DV2-PACKDSP-008-20260822073125973-DV2-PACKDSP-008-drain-00014`, `DV2-PACKDSP-008-20260822073540614-DV2-PACKDSP-008-drain-00015`, replacement `DV2-PACKDSP-008-20260822073635730-DV2-PACKDSP-008-drain-00017` after the truncated capture, `DV2-PACKDSP-008-20260822073716814-DV2-PACKDSP-008-drain-00018`, `DV2-PACKDSP-008-20260822073728028-DV2-PACKDSP-008-drain-00019`, `DV2-PACKDSP-008-20260822073744007-DV2-PACKDSP-008-drain-00020`, and submitted mutation `DV2-PACKDSP-008-20260822073902002-DV2-PACKDSP-008-drain-00021` prove exact parent/child lookup, partial values, damaged/lost reason, and visible submission; the replacement drain resolves the capture gap. API/DB before-after `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-008-pre.json`, `.../api/QP-04-DV2-PACKDSP-008-after.json`, `.../db/QP-04-DV2-PACKDSP-008-pre.json`, and `.../db/QP-04-DV2-PACKDSP-008-after.json` prove challan `DC/26-27/142`, dispatched child 3/0.375, damaged/lost child 1/0.125 with explicit loss event, and reserved residual child 6/0.75, preserving exact count/weight and event lineage.

- [x] `DV2-PACKDSP-009` Partial residual label failure atomicity.
  - Status: `PASS`
  - Procedure: controlled failure before residual label evidence completes.
  - Expected: entire Dispatch fails; source remains dispatchable whole; no challan/line/orphan child/consumption.
  - Evidence: Browser actions `DV2-PACKDSP-009-20260822074544516-DV2-PACKDSP-009-drain-00024`, `DV2-PACKDSP-009-20260822074557155-DV2-PACKDSP-009-drain-00025`, `DV2-PACKDSP-009-20260822074612026-DV2-PACKDSP-009-drain-00026`, `DV2-PACKDSP-009-20260822074629260-DV2-PACKDSP-009-drain-00027`, and `DV2-PACKDSP-009-20260822075000199-DV2-PACKDSP-009-drain-00028` prove exact residual lookup, staging, partial values, marked reason, and submitted visible failure. The final action records `mutationSubmitted:true`; the UI displayed `The Packing operation could not be completed` and retained the exact line. API/DB before-after: `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-009-pre.json`, `.../api/QP-04-DV2-PACKDSP-009-after.json`, `.../db/QP-04-DV2-PACKDSP-009-pre.json`, and `.../db/QP-04-DV2-PACKDSP-009-after.json`; the source remained RESERVED at 6/0.75, no marked UNIT_SPLIT event, challan, line, child, or consumption was added. Temporary hook SQL and proofs: `qa-evidence/DV2-20260821T123729Z/sql/QP-04-DV2-PACKDSP-009-hook-create.sql`, `.../hook-created.json`, `.../hook-fired.json`, `.../hook-drop.sql`, `.../hook-removed.json`, and `.../post-removal-schema-check.json`; `hook-fired.json` records fireCount 1 and zero matching committed events/challans, while post-removal schema proof records zero trigger/function/sequence objects.

- [x] `DV2-PACKDSP-010` Sealed parent Parcel atomic Dispatch.
  - Status: `FAIL`
  - Expected: scan expands all active stock-unit children, validates all, creates attached child detail, and transitions them atomically.
  - Evidence: Supported QA Packing API fixture `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-010-fixture.json` and direct reconciliation `.../db/QP-04-DV2-PACKDSP-010-fixture-reconciliation.json` created parent `PKU-PB-20260822-0002-L2-U0001` as RESERVED Parcel with two active RESERVED Packet children, 20/2.5 parent totals, 10/1.25 per child, matching customer, active package types, barcodes, source reservation/consumption, and seal/release event lineage. Browser actions `DV2-PACKDSP-010-20260822080307102-DV2-PACKDSP-010-drain-00029`, `DV2-PACKDSP-010-20260822080320121-DV2-PACKDSP-010-drain-00030`, `DV2-PACKDSP-010-20260822080333020-DV2-PACKDSP-010-drain-00031`, and `DV2-PACKDSP-010-20260822080350581-DV2-PACKDSP-010-drain-00032` prove clean reset, exact parent filtering, Parent Parcel staging with 2 active children, and a visible submitted failure. API/DB before-after `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-010-pre.json`, `.../api/QP-04-DV2-PACKDSP-010-after.json`, `.../db/QP-04-DV2-PACKDSP-010-pre.json`, and `.../db/QP-04-DV2-PACKDSP-010-after.json` show the parent and both children remained RESERVED, no challan/line/consumption/dispatch event was added, and the exact source stayed listed. The UI returned `residualBaseCount must be a positive integer` after the visible submit and retained the line.
  - Defect: `DV2-DEF-009`
  - Reproduction: With the eligible RESERVED parent Parcel staged and whole-parent values 20 / 2.5 kg, click the visible Create Dispatch Challan control. Browser action `DV2-PACKDSP-010-20260822080350581-DV2-PACKDSP-010-drain-00032` records `mutationSubmitted:true`; the UI sends zero-valued partial fields, returns `residualBaseCount must be a positive integer`, retains the parent line, and creates no challan. The same fixture was API/DB-reconciled before and after with no state drift.

- [x] `DV2-PACKDSP-011` Parent Parcel customer conflict.
  - Status: `PASS`
  - Expected: one incompatible child rejects the entire parent; no child dispatches.
  - Evidence: Supported API fixture `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-remaining-fixtures.json` created parent `PKU-PB-20260822-0003-L2-U0001` with two active children RESERVED to different Customers. Browser actions `DV2-PACKDSP-011-20260822081052202-DV2-PACKDSP-011-drain-00033`, `DV2-PACKDSP-011-20260822081126749-DV2-PACKDSP-011-drain-00034`, and `DV2-PACKDSP-011-20260822081141939-DV2-PACKDSP-011-drain-00035` prove a clean draft, filtered no-eligible state, and exact barcode lookup returning “A parent Parcel contains units reserved to different Customers.” API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-011-pre.json`, `.../api/QP-04-DV2-PACKDSP-011-post.json`, and `.../api/QP-04-DV2-PACKDSP-011-after.json` show the authoritative POST returned 409 `packed_customer_mismatch`. DB `.../db/QP-04-DV2-PACKDSP-011-pre.json` and `.../db/QP-04-DV2-PACKDSP-011-after.json` show both child reservations and no new challan, line, consumption, or dispatch event.

- [x] `DV2-PACKDSP-012` Parent Parcel ineligible child.
  - Status: `PASS`
  - Expected: held/damaged/reserved-for-packing/already-dispatched child rejects whole parent atomically.
  - Evidence: Supported fixture `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-remaining-fixtures.json` created parent `PKU-PB-20260822-0004-L2-U0001` with one RESERVED child and one DAMAGED child. Browser actions `DV2-PACKDSP-012-20260822081306441-DV2-PACKDSP-012-drain-00036`, `DV2-PACKDSP-012-20260822081319282-DV2-PACKDSP-012-drain-00037`, and `DV2-PACKDSP-012-20260822081332271-DV2-PACKDSP-012-drain-00038` prove a clean draft, filtered no-eligible state, and exact lookup returning “Every active child of the parent Parcel must be eligible for Dispatch.” API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-012-pre.json`, `.../api/QP-04-DV2-PACKDSP-012-post.json`, and `.../api/QP-04-DV2-PACKDSP-012-after.json` show 409 `parent_parcel_not_dispatchable`. DB before-after show the DAMAGED/RESERVED child states, no challan/line/consumption, and no dispatch mutation.

- [x] `DV2-PACKDSP-013` Dispatch subset by scanning children.
  - Status: `FAIL`
  - Expected: selected children dispatch; parent moves to `OPENED`; sealed parent barcode cannot be reused atomically.
  - Evidence: Supported fixture `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-remaining-fixtures.json` provided sealed parent `PKU-PB-20260822-0005-L2-U0001` with two RESERVED children. Browser actions `DV2-PACKDSP-013-20260822081444325-DV2-PACKDSP-013-drain-00039`, `DV2-PACKDSP-013-20260822081452435-DV2-PACKDSP-013-drain-00040`, `DV2-PACKDSP-013-20260822081500593-DV2-PACKDSP-013-drain-00041`, and `DV2-PACKDSP-013-20260822081514285-DV2-PACKDSP-013-drain-00042` prove clean reset, exact child scan, child-only staging, and visible submitted failure. The UI returned `residualBaseCount must be a positive integer` and retained the child line. API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-013-pre.json`, `.../api/QP-04-DV2-PACKDSP-013-post.json`, and `.../api/QP-04-DV2-PACKDSP-013-after.json` include the direct child-only API reconciliation. DB after shows the selected child DISPATCHED at 10/1.25, its parent OPENED, the unselected sibling still RESERVED, and one attached child line/event.
  - Defect: `DV2-DEF-009`
  - Reproduction: Stage only child `PKU-PB-20260822-0005-L1-U0001` and click the visible Create Dispatch Challan control. Browser action `DV2-PACKDSP-013-20260822081514285-DV2-PACKDSP-013-drain-00042` records `mutationSubmitted:true`; the UI sends zero-valued partial fields, returns `residualBaseCount must be a positive integer`, and leaves the child staged. The direct API with optional partial fields omitted succeeds and proves the intended parent OPENED/selected-child DISPATCHED/sibling-RESERVED transition.

- [x] `DV2-PACKDSP-014` Parent Parcel partial request rejection.
  - Status: `PASS`
  - Expected: partial parent request fails; operator must scan children.
  - Evidence: Supported fixture `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-remaining-fixtures.json` provided AVAILABLE parent `PKU-PB-20260822-0006-L2-U0001` with two AVAILABLE children. Browser actions `DV2-PACKDSP-014-20260822081627971-DV2-PACKDSP-014-drain-00043`, `DV2-PACKDSP-014-20260822081628389-DV2-PACKDSP-014-drain-00044`, `DV2-PACKDSP-014-20260822081629011-DV2-PACKDSP-014-drain-00045`, and `DV2-PACKDSP-014-20260822081646649-DV2-PACKDSP-014-drain-00046` prove clean reset, exact parent lookup, staging, and the visible partial controls without submitting a mutation. API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-014-pre.json`, `.../api/QP-04-DV2-PACKDSP-014-post.json`, and `.../api/QP-04-DV2-PACKDSP-014-after.json` show 400 `parent_parcel_partial_dispatch`. DB before-after show parent/children unchanged and no challan, line, child, or consumption.

- [x] `DV2-PACKDSP-015` Packed source concurrency.
  - Status: `PASS`
  - Procedure: whole vs partial, parent vs child, and two whole dispatches concurrently.
  - Expected: deterministic single winner/coherent conflict; no double Dispatch or hierarchy drift.
  - Evidence: Supported fixtures `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-remaining-fixtures.json` and `.../api/QP-04-DV2-PACKDSP-015-extra-fixture.json` plus DB reconciliation files provided two parent Parcels with exact 20/2.5 totals and 10/1.25 children. Browser actions `DV2-PACKDSP-015-20260822081924331-DV2-PACKDSP-015-drain-00047`, `DV2-PACKDSP-015-20260822081924785-DV2-PACKDSP-015-drain-00048`, and `DV2-PACKDSP-015-20260822081925496-DV2-PACKDSP-015-drain-00049` prove the visible parent source boundary and staged identity without a duplicate UI submit. API concurrency matrix `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-015-concurrency.json` ran parent-vs-child and two-whole requests concurrently: each case had exactly one 200 winner and one 409 `parent_parcel_not_dispatchable` conflict. API/DB before-after `.../api/QP-04-DV2-PACKDSP-015-pre.json`, `.../api/QP-04-DV2-PACKDSP-015-after.json`, `.../db/QP-04-DV2-PACKDSP-015-pre.json`, and `.../db/QP-04-DV2-PACKDSP-015-after.json` show one coherent selected-child/OPENED-parent result and one coherent whole-parent result, with no double Dispatch or hierarchy drift.

## 18. Phase K: challan actions, returns, reversals, PDF, and export

- [x] `DV2-CHL-001` Correct a non-PACKED legacy source line.
  - Status: `PASS`
  - Expected: mandatory reason, validated new count/weight, source counter delta, `LINE_CORRECTED` event with before/after; original line identity retained.
  - Evidence: API fixture creation and pre-state `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-001-post.json`, `.../api/QP-04-CHL-001-pre.json`, and `.../db/QP-04-CHL-001-pre.json` established active challan `DC/26-27/146` with CUTTER line `RCU-102-002-C001` at 180/24.12. Browser actions `DV2-CHL-001-20260822082859674-DV2-CHL-001-drain-00050`, `...82912604...00051`, `...82930032...00052`, `...82937426...00053`, `...82945264...00054`, and submitted `...82953729...00055` prove visible history/detail navigation, corrected count and weight entry, required reason, and visible Save correction submission with `mutationSubmitted:true`. API/DB after `qa-evidence/DV2-20260821T123729Z/api/QP-04-CHL-001-after.json` and `.../db/QP-04-CHL-001-after.json` retain the same line identity at 180/23.12, record `LINE_CORRECTED` with before/after and reason, and show source counter 180/23.12.

- [x] `DV2-CHL-002` Reject direct correction of Packed line.
  - Status: `PASS`
  - Expected: Packed line is immutable; physical return/repacking/split workflow required.
  - Evidence: API/DB pre-state `qa-evidence/DV2-20260821T123729Z/api/QP-04-CHL-002-pre.json` and `.../db/QP-04-CHL-002-pre.json` identify active Packed challan `DC/26-27/145`, line `cmt43ywrp01sovzj6uk08irb6`, barcode `PKU-PB-20260822-0008-L1-U0002`. Browser actions `DV2-CHL-002-20260822083040792-DV2-CHL-002-drain-00056` and `DV2-CHL-002-20260822083049481-DV2-CHL-002-drain-00057` prove visible history search and detail rendering; the detail rendered Return but no Correct control for the Packed line. Direct API correction attempt `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-002-post.json` returned 409 `packed_line_immutable` with the required return/repacking guidance. API/DB after `.../api/QP-04-CHL-002-after.json` and `.../db/QP-04-CHL-002-after.json` show unchanged Packed line, unit state, counters, and event history.

- [x] `DV2-CHL-003` Return Inbound/Cutter/Holo line.
  - Status: `PASS`
  - Expected: exact legacy counter restoration once, `LINE_RETURNED`, challan status updates to partially/fully returned.
  - Evidence: API fixture creation and pre-state `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-003-post.json`, `.../api/QP-04-CHL-003-pre.json`, and `.../db/QP-04-CHL-003-pre.json` established HOLO challan `DC/26-27/147` with line `RHO-10548-C001` at 50/14.7. Browser actions `DV2-CHL-003-20260822083149355-DV2-CHL-003-drain-00058`, `...83157249...00059`, `...83211475...00060`, `...83217747...00061`, and submitted `...83225880...00062` prove visible search/detail, return form, required reason, and visible Record return with `mutationSubmitted:true`. API/DB after `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-003-after.json` and `.../db/QP-04-CHL-003-after.json` show `LINE_RETURNED`, reason and actor, challan status `RETURNED`, original line identity at 50/14.7, and HOLO counters restored exactly to zero dispatched count/weight.

- [x] `DV2-CHL-004` Return sealed unchanged Packed line.
  - Status: `PASS`
  - Expected: status enters inspection path and resolves to AVAILABLE/RESERVED only from explicit current assignment; old reservation is not automatically restored.
  - Evidence: API fixture and pre-state `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-004-post.json`, `.../api/QP-04-CHL-004-pre.json`, and `.../db/QP-04-CHL-004-pre.json` established sealed Packed unit `PKU-PB-20260821-0016-L1-U0001` and challan `DC/26-27/148`. Browser actions `DV2-CHL-004-20260822083341158-DV2-CHL-004-drain-00063`, `...83349138...00064`, `...83356446...00065`, `...83402742...00066`, and submitted `...83413091...00067` prove visible exact history/detail, sealed unchanged condition, required reason, and Record return with `mutationSubmitted:true`. The authorized API inspection supplement `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-004-inspect-post.json` explicitly resolved `RETURNED_PENDING_INSPECTION` to `AVAILABLE` with no customer. API/DB after `.../api/QP-04-CHL-004-after.json` and `.../db/QP-04-CHL-004-after.json` show challan `RETURNED`, `UNIT_RETURNED` then `UNIT_RETURN_INSPECTED`, unchanged 10/1.25 content, and no automatic old reservation restoration.

- [x] `DV2-CHL-005` Return opened or physically changed Packed line.
  - Status: `PASS`
  - Expected: cannot reactivate original; inspection requires repacking path.
  - Evidence: API fixture and pre-state `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-005-post.json`, `.../api/QP-04-CHL-005-pre.json`, and `.../db/QP-04-CHL-005-pre.json` established active Packed challan `DC/26-27/149` for `PKU-PB-20260821-0017-L1-U0001`. Browser actions `DV2-CHL-005-20260822083534706-DV2-CHL-005-drain-00068`, `...83542640...00069`, `...83555748...00070`, `...83703406...00071`, `...83743728...00072`, `...83750408...00073`, and submitted `...83758512...00074` prove visible detail, Opened and Physically changed selections, required reason, and Record return with `mutationSubmitted:true`. The inspection supplement `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-005-inspect-post.json` returned 400 `repacking_required`; API/DB after `.../api/QP-04-CHL-005-after.json` and `.../db/QP-04-CHL-005-after.json` preserve the original unit at `RETURNED_PENDING_INSPECTION` with `UNIT_RETURNED` condition payload showing both flags, so the original cannot be reactivated without repacking.

- [x] `DV2-CHL-006` Return damaged Packed line.
  - Status: `PASS`
  - Expected: unit resolves to DAMAGED with reason/evidence; not dispatchable.
  - Evidence: Primary fixture API/DB pre-state `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-006-post.json`, `.../api/QP-04-CHL-006-pre.json`, and `.../db/QP-04-CHL-006-pre.json` established Packed challan `DC/26-27/150` for `PKU-PB-20260821-0004-L1-U0001`. Browser actions `DV2-CHL-006-20260822084002493-DV2-CHL-006-drain-00075`, `...84109291...00076`, `...84117174...00077`, `...84125440...00078`, and `...84148943...00080` prove visible return and physical-change submission with `mutationSubmitted:true`; its inspection attempt `.../api/QP-04-DV2-CHL-006-inspect-post.json` correctly returned 400 `repacking_required`, preventing an invalid damaged transition. A second uniquely marked sealed-return fixture was then exercised through the same visible route: Browser actions `DV2-CHL-006-20260822084246223-DV2-CHL-006-drain-00081`, `...84253813...00082`, `...84302875...00083`, `...84313137...00084`, and submitted `...84314891...00085` prove visible return of `PKU-PB-20260821-0018-L1-U0001` on `DC/26-27/151`. Supported inspection API proof `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-006-secondary-inspect-post.json` and final `.../api/QP-04-CHL-006-after.json`, `.../db/QP-04-CHL-006-after.json` show `UNIT_RETURN_INSPECTED` then `UNIT_DAMAGED` with reason, zero salvage, full write-off evidence, exact 10/1.25 content, and terminal non-dispatchable `DAMAGED` status.

- [x] `DV2-CHL-007` Void active challan.
  - Status: `FAIL`
  - Expected: mandatory reason, all eligible source effects reversed exactly, status VOIDED, append-only event; document/history remain.
  - Evidence: Browser action `DV2-CHL-007-20260822090923054-DV2-CHL-007-drain-00002` proves the authenticated GLINTEX detail visibly rendered ACTIVE `DC/26-27/152` and the Void control, but no reason dialog or visible submit result appeared because the page reports `typeof window.prompt === \"undefined\"`; `mutationSubmitted:false` is retained and the visible mutation is not claimed. The direct backend fallback was used only to complete the isolated fixture and verify the server path: `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-007-post.json`, `.../api/QP-04-CHL-007-after.json`, and `.../db/QP-04-CHL-007-after.json` show HTTP 200, VOIDED status, CHALLAN_VOIDED event, restored HOLO source counters, and unchanged line identity. The visible-submit failure is `DV2-DEF-011`.
  - Defect: `DV2-DEF-011`
  - Reproduction: In authenticated iab on `/app/dispatch`, open `DC/26-27/152`, click the visible Void challan control, and attempt the required reason step. No prompt or submit result appears; Browser evaluation reports `typeof window.prompt` as `undefined`, so the required visible mutation cannot be submitted.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-CHL-008` Reject void/correct/return against terminal or already-returned state.
  - Status: `FAIL`
  - Expected: stable conflict and no counter/event drift.
  - Evidence: Fresh marker fixture `DC/26-27/153`, line `cmt45u03f01ztvzj6ezewo8nt`, was created and captured in `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-008-post.json`, `.../api/QP-04-CHL-008-pre.json`, and `.../db/QP-04-CHL-008-pre.json`. Direct first-return proof `.../api/QP-04-DV2-CHL-008-first-return-post.json` established the authoritative already-RETURNED state while the loaded detail still visibly rendered Return. Browser action `DV2-CHL-008-20260822091414140-DV2-CHL-008-drain-00012` proves the real visible Return form submission with `mutationSubmitted:true`; the UI showed `A returned Dispatch line cannot be changed.` Direct correct and duplicate-return probes returned stable 409 `dispatch_line_returned` in `.../api/QP-04-DV2-CHL-008-correct-reject-post.json` and `.../api/QP-04-DV2-CHL-008-return-reject-post.json`, but the direct void probe unexpectedly returned 200 and changed the already-returned challan to VOIDED, adding CHALLAN_VOIDED and restoring the source. Final reconciliation is in `.../api/QP-04-CHL-008-after.json` and `.../db/QP-04-CHL-008-after.json`; the unexpected void behavior is `DV2-DEF-012`.
  - Defect: `DV2-DEF-012`
  - Reproduction: Create active marker challan `DC/26-27/153`, return its line once, then send the void request against the already-returned challan. Correct and duplicate-return requests return 409, but void returns 200, changes status to VOIDED, appends CHALLAN_VOIDED, and restores source counters instead of rejecting the terminal/already-returned state.

- [x] `DV2-CHL-009` Reverse a reversible correction/return event.
  - Status: `FAIL`
  - Expected: reason, reversal link, exact restored state/counter, one reversal event, idempotent replay.
  - Evidence: Marker fixture `DC/26-27/154`, line `cmt45z2vq020zvzj6che9mnwm`, and correction event `cmt45zjts021evzj64dbde5j9` are captured in `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-009-post.json`, `.../api/QP-04-CHL-009-pre.json`, `.../db/QP-04-CHL-009-pre.json`, `.../api/QP-04-CHL-009-correct-post.json`, and `.../api/QP-04-CHL-009-pre-reverse.json`. Browser action `DV2-CHL-009-20260822091826702-DV2-CHL-009-drain-00016` proves the corrected detail rendered without any Reverse control; `mutationSubmitted:false` records the prevented visible mutation. The direct reverse endpoint then returned 200 with `DISPATCH_EVENT_REVERSED`, `reversalOfEventId` set to the correction event, and restored 50/14.05 values. Final API/DB proof `.../api/QP-04-CHL-009-reverse-post.json`, `.../api/QP-04-CHL-009-after.json`, and `.../db/QP-04-CHL-009-after.json` reconciles one reversal event, actor/reason, source counters, and restored Decimal line state. The missing visible reverse control is `DV2-DEF-013`.
  - Defect: `DV2-DEF-013`
  - Reproduction: In authenticated iab, open corrected `DC/26-27/154` and inspect the visible detail actions. Preview, print, download, Correct, and Return render, but no Reverse action/form renders, so the required reverse mutation cannot be submitted visibly.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-CHL-010` Reject non-reversible or already reversed event.
  - Status: `PASS`
  - Expected: stable error; no additional reversal.
  - Evidence: Browser action `DV2-CHL-010-20260822091954115-DV2-CHL-010-drain-00019` proves the refreshed authenticated detail for `DC/26-27/154` shows the restored 50/14.050 line and no additional reverse control. Replaying the exact already-reversed correction event `cmt45zjts021evzj64dbde5j9` returned stable 409 `duplicate_resource` in `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-010-reverse-replay-post.json`; final `.../api/QP-04-CHL-010-after.json` and `.../db/QP-04-CHL-010-after.json` show one `DISPATCH_EVENT_REVERSED` link only, restored 50/14.05 Decimal state, and unchanged source counters.

- [x] `DV2-CHL-011` Authoritative ORIGINAL PDF.
  - Status: `PASS`
  - Expected: immutable stored snapshot, valid PDF, header SHA equals actual SHA-256, customer/company snapshot does not change after master edits, packed lines show item/barcode/package/count/net weight.
  - Evidence: Direct API/PDF proof `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-011-pdf-proof.json` and `.../pdf/QP-04-DV2-CHL-011-original.pdf` show HTTP 200, valid PDF bytes, 6,859 bytes, and header SHA equal to the actual SHA-256; detail proof identifies ORIGINAL and the exact `RHO-10623-C001` line at 50/14.05. Browser action `DV2-CHL-011-20260822092059456-DV2-CHL-011-drain-00020` preserves the original visible Preview PDF click and truthfully records the Codex iab blob/PDF navigation policy rejection. The approved QA evidence-only viewer action `DV2-CHL-011-20260822111919083-DV2-CHL-011-drain-00002` visibly renders Page 1 of 1 from the same stored PDF at loopback `http://localhost:59344/`, showing KJ ENTERPRISE, DC/26-27/154, customer `+916353131826`, barcode `RHO-10623-C001`, package `HOLO`, count `50`, net weight `14.05 kg`, and the matching SHA. Viewer manifest `qa-evidence/DV2-20260821T123729Z/document-viewer/DV2-CHL-011/manifest.json`, HTML, rendered PNG, server start/stop proofs, and recorder segment `qa-evidence/DV2-20260821T123729Z/browser-recording/DV2-20260821T123729Z-app-80` reconcile the exact PDF and complete visible render. This approved surface is evidence-only and does not claim blob navigation succeeded.

- [x] `DV2-CHL-012` PDF escaping and hostile dynamic values.
  - Status: `PASS`
  - Expected: special markup/control characters do not execute or corrupt output; rendered text is safe.
  - Evidence: Marker challan `DC/26-27/155` with notes containing literal `<script>`, `<img onerror>`, ampersand, quotes, and a newline is captured in `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-012-post.json`, `.../api/QP-04-CHL-012-pre.json`, and `.../db/QP-04-CHL-012-pre.json`. Browser action `DV2-CHL-012-20260822092913772-DV2-CHL-012-drain-00023` shows the hostile values rendered as literal text in the authenticated detail, with no JavaScript dialog present and no executable element in the visible result. PDF proof `.../api/QP-04-DV2-CHL-012-pdf-proof.json` and `.../pdf/QP-04-DV2-CHL-012-original.pdf` show HTTP 200, 6,910 bytes, and matching header/actual SHA-256; the document remained valid despite hostile dynamic values.

- [x] `DV2-CHL-013` Multi-challan preview and print.
  - Status: `FAIL`
  - Expected: every selected challan renders on a distinct page; no iframe/object URL overwrite; ordering is deterministic.
  - Evidence: Browser actions `DV2-CHL-013-20260822093035564-DV2-CHL-013-drain-00026` and `...93037833...00027` prove the visible selection of exact `DC/26-27/155` and `DC/26-27/154`; `...93050547...00028`, `...93100369...00029`, and `...93114435...00030` prove visible Preview selected and Print selected clicks, but no preview or print surface appeared and no second in-app Browser tab was created. Direct PDF proofs `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-013-155-pdf-proof.json`, `.../api/QP-04-DV2-CHL-013-154-pdf-proof.json`, and PDFs under `.../pdf/` show each selected document independently returns HTTP 200, one page, and matching header/actual SHA-256; `.../api/QP-04-CHL-013-after.json` and `.../db/QP-04-CHL-013-after.json` show no data mutation. The missing visible preview/print surface is `DV2-DEF-014`.
  - Defect: `DV2-DEF-014`
  - Reproduction: In authenticated iab history, select DC/26-27/155 and DC/26-27/154, click Preview selected and Print selected, and observe that the controls remain on the history page with no visible preview/print document surface or second Browser tab.

- [x] `DV2-CHL-014` Server-side CSV export.
  - Status: `PASS`
  - Expected: filters match history; headers/escaping/date/count/Decimal values are correct; output streams without loading full history into browser.
  - Evidence: Browser route `/app/dispatch`, authenticated history filter `DC/26-27/15`, two selected rows, and visible Export click recorded as `DV2-CHL-014-20260822093644702-DV2-CHL-014-drain-00031`; history remained stable after the download action. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-014-csv-proof.json` records HTTP 200 `text/csv`, attachment filename, two streamed chunks, six filtered rows, exact ten-column header, date `2026-08-22`, quoted CSV cells, `DC/26-27/155` and `DC/26-27/154`, and Decimal weights `14.7` and `14.05`; bytes are in `qa-evidence/DV2-20260821T123729Z/csv/QP-04-DV2-CHL-014-export.csv`.

- [x] `DV2-CHL-015` Append-only challan history.
  - Status: `PASS`
  - Expected: create/correct/return/void/reversal events preserve actor, reason, before/after, timestamps, and source snapshots; no hard deletion.
  - Evidence: Browser route `/app/dispatch` opened exact DC/26-27/154 detail and recorded as `DV2-CHL-015-20260822094122378-DV2-CHL-015-drain-00002`; the visible detail retained ACTIVE status, QA CHL-009 note, source barcode, count 50, net 14.050 kg, Correct/Return controls, and no delete control. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-04-CHL-015-history-proof.json` and direct QA DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-04-CHL-015-history-proof.json` retain both DC/26-27/153 and DC/26-27/154 with their event histories, actor IDs, reasons, timestamps, payload snapshots, and reversal lineage; assertions prove both challans retained, no hard deletion, append-only events, and `DISPATCH_EVENT_REVERSED.reversalOfEventId` linkage.

## 19. Phase L: damage, write-off, return inspection, and repacking

- [x] `DV2-EXC-001` Mark eligible Packed Unit damaged with no salvage.
  - Status: `FAIL`
  - Expected: DAMAGED state/event, mandatory reason, exact content evidence, notification once, non-dispatchable.
  - Evidence: Browser actions `DV2-EXC-001-20260822141925034-DV2-EXC-001-drain-00025`, `DV2-EXC-001-20260822141926554-DV2-EXC-001-drain-00026`, `DV2-EXC-001-20260822141927687-DV2-EXC-001-drain-00027`, `DV2-EXC-001-20260822141929000-DV2-EXC-001-drain-00028`, `DV2-EXC-001-20260822141954398-DV2-EXC-001-drain-00029`, `DV2-EXC-001-20260822141955006-DV2-EXC-001-drain-00030`, `DV2-EXC-001-20260822141955502-DV2-EXC-001-drain-00031`, `DV2-EXC-001-20260822141957017-DV2-EXC-001-drain-00032`, and `DV2-EXC-001-20260822142038933-DV2-EXC-001-drain-00033` show the exact visible damage form, zero-salvage inputs, mandatory reason, submit click, and Illegal invocation alert. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-001.json` records the direct accepted zero-salvage request. DB proofs `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-001.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-001-ui-attempt.json` reconcile the successful API events and the unchanged visible-attempt fixture.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260821-0028 Containers, expand the exact AVAILABLE unit Actions disclosure, choose Damage, keep salvage at 0/0, enter a reason, and click Record damage. The visible form remains open with alert `Illegal invocation`; the UI mutation does not reach the API, while the direct API contract succeeds for the separate evidence fixture.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-002` Damage with salvageable content.
  - Status: `FAIL`
  - Expected: source DAMAGED, salvage identity created for repacking, exact count/weight conservation and lineage.
  - Evidence: Browser actions `DV2-EXC-002-20260822142149908-DV2-EXC-002-drain-00034`, `DV2-EXC-002-20260822142151526-DV2-EXC-002-drain-00035`, `DV2-EXC-002-20260822142152838-DV2-EXC-002-drain-00036`, `DV2-EXC-002-20260822142154064-DV2-EXC-002-drain-00037`, `DV2-EXC-002-20260822142207478-DV2-EXC-002-drain-00038`, `DV2-EXC-002-20260822142208246-DV2-EXC-002-drain-00039`, `DV2-EXC-002-20260822142208996-DV2-EXC-002-drain-00040`, and `DV2-EXC-002-20260822142210622-DV2-EXC-002-drain-00041` show the exact authenticated form, 6/.75 inputs, reason, and submit click; the UI displays Illegal invocation and does not submit a backend mutation. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-002.json` records the direct accepted salvage request and exact conservation values. DB proofs `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-002.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-002-ui-attempt.json` reconcile the successful API lineage and the unchanged visible-attempt fixture.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260822-0007 Containers, expand the exact RESERVED unit Actions disclosure, choose Damage, enter salvage 6 and 0.75 kg plus a reason, and click Record damage. The visible form remains open with alert `Illegal invocation`; the UI mutation does not reach the API, while the same API contract succeeds for the separate evidence fixture.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-003` Reject invalid damage conservation.
  - Status: `FAIL`
  - Expected: salvage cannot exceed source and count/weight must reconcile; atomic failure.
  - Evidence: Browser actions `DV2-EXC-003-20260822142450662-DV2-EXC-003-drain-00042`, `DV2-EXC-003-20260822142452386-DV2-EXC-003-drain-00043`, `DV2-EXC-003-20260822142454125-DV2-EXC-003-drain-00044`, `DV2-EXC-003-20260822142456470-DV2-EXC-003-drain-00045`, `DV2-EXC-003-20260822142509270-DV2-EXC-003-drain-00046`, `DV2-EXC-003-20260822142509911-DV2-EXC-003-drain-00047`, `DV2-EXC-003-20260822142510800-DV2-EXC-003-drain-00048`, and `DV2-EXC-003-20260822142512732-DV2-EXC-003-drain-00049` show the exact visible invalid form, 11/1.25 inputs, reason, and submit click; the UI displays Illegal invocation before the API conservation error. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-003.json` records stable HTTP 400 `damage_exceeds_content` for salvage count 11. DB proofs `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-003.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-003-ui-attempt.json` prove both the direct API rejection and unchanged visible-attempt source.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260822-0006 Containers, expand the exact AVAILABLE unit Actions disclosure, choose Damage, enter invalid salvage 11 and 1.25 kg plus a reason, and click Record damage. The visible form remains open with alert `Illegal invocation`, preventing the server-side `damage_exceeds_content` response from the real visible journey.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-004` Write off eligible damaged content.
  - Status: `FAIL`
  - Expected: mandatory reason, exact count/weight, append-only write-off event, notification once, no in-place silent reduction.
  - Evidence: Browser actions `DV2-EXC-004-20260822142633588-DV2-EXC-004-drain-00050`, `DV2-EXC-004-20260822142635419-DV2-EXC-004-drain-00051`, and `DV2-EXC-004-20260822142637661-DV2-EXC-004-drain-00052` show the authenticated PB-20260821-0018 workflow, Containers panel, and expanded exact DAMAGED unit Actions disclosure; no Write off button or form is rendered. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-004.json` records HTTP 200 for the exact full write-off. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-004.json` reconciles the unchanged DAMAGED 10/1.250 unit with exactly the EXC-004 damage and write-off events.
  - Defect: `DV2-DEF-015`
  - Reproduction: In authenticated iab on `/app/packing`, open PB-20260821-0018, select Containers, and expand the exact DAMAGED unit Actions disclosure. The disclosure renders no Write off action or form for the DAMAGED status, so the required visible mutation cannot be submitted. The direct API and QA DB evidence show the write-off path itself accepts the exact content and appends the expected events.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-005` Reject write-off of wrong state/excess content.
  - Status: `PASS`
  - Expected: stable error and unchanged source.
  - Evidence: Browser actions `DV2-EXC-005-20260822142726780-DV2-EXC-005-drain-00053`, `DV2-EXC-005-20260822142728505-DV2-EXC-005-drain-00054`, and `DV2-EXC-005-20260822142730335-DV2-EXC-005-drain-00055` show the authenticated PB-20260821-0029 workflow and expanded QUALITY_HOLD Actions disclosure; the UI correctly exposes only Release quality and does not offer an invalid Write off action. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-005.json` records stable HTTP 409 `unit_not_writable_off` for the same QUALITY_HOLD fixture. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-005.json` proves the source remained QUALITY_HOLD with unchanged content/version/event count.

- [x] `DV2-EXC-006` Return inspection: sealed unchanged.
  - Status: `FAIL`
  - Expected: same barcode becomes AVAILABLE or explicitly RESERVED based on current assignment; inspection event is complete.
  - Evidence: Browser actions `DV2-EXC-006-20260822142854080-DV2-EXC-006-drain-00056`, `DV2-EXC-006-20260822142856230-DV2-EXC-006-drain-00057`, `DV2-EXC-006-20260822142858499-DV2-EXC-006-drain-00058`, `DV2-EXC-006-20260822142900139-DV2-EXC-006-drain-00059`, `DV2-EXC-006-20260822142902130-DV2-EXC-006-drain-00060`, and `DV2-EXC-006-20260822142904168-DV2-EXC-006-drain-00061` show the exact visible Return action, sealed-unchanged form, reason, submit click, and Illegal invocation alert. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-006.json` records the direct return and inspection transitions. DB proofs `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-006.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-006-ui-attempt.json` reconcile the successful API path and unchanged visible-attempt fixture.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260822-0007 Containers, expand the exact DISPATCHED unit Actions disclosure, choose Return, leave both condition flags clear, enter a reason, and click Record return. The visible form remains open with alert `Illegal invocation`; the UI mutation does not reach the API, while the direct API contract succeeds for the separate evidence fixture.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-007` Return inspection: opened/changed.
  - Status: `FAIL`
  - Expected: result requires Repacking; original cannot directly become available.
  - Evidence: Browser actions `DV2-EXC-007-20260822143120219-DV2-EXC-007-drain-00062`, `DV2-EXC-007-20260822143123076-DV2-EXC-007-drain-00063`, `DV2-EXC-007-20260822143125888-DV2-EXC-007-drain-00064`, `DV2-EXC-007-20260822143128047-DV2-EXC-007-drain-00065`, `DV2-EXC-007-20260822143129538-DV2-EXC-007-drain-00066`, `DV2-EXC-007-20260822143130950-DV2-EXC-007-drain-00067`, `DV2-EXC-007-20260822143132010-DV2-EXC-007-drain-00068`, and `DV2-EXC-007-20260822143134152-DV2-EXC-007-drain-00069` show the exact visible Return form, both opened/changed flags, reason, submit click, and Illegal invocation alert. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-007.json` records the direct return and stable `repacking_required` inspection rejection. DB proofs `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-007.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-007-ui-attempt.json` reconcile the direct API rule and unchanged visible-attempt fixture.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260821-0030 Containers, expand the exact DISPATCHED unit Actions disclosure, choose Return, select both opened/changed flags, enter a reason, and click Record return. The visible form remains open with alert `Illegal invocation`; the UI mutation does not reach the API, while the direct API contract correctly requires Repacking.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-008` Return inspection: damaged.
  - Status: `FAIL`
  - Expected: DAMAGED state, salvage/write-off options, no Dispatch eligibility.
  - Evidence: Browser actions `DV2-EXC-008-20260822143247131-DV2-EXC-008-drain-00070`, `DV2-EXC-008-20260822143248897-DV2-EXC-008-drain-00071`, `DV2-EXC-008-20260822143250933-DV2-EXC-008-drain-00072`, `DV2-EXC-008-20260822143252567-DV2-EXC-008-drain-00073`, `DV2-EXC-008-20260822143254058-DV2-EXC-008-drain-00074`, and `DV2-EXC-008-20260822143256067-DV2-EXC-008-drain-00075` show the exact visible Return form, reason, submit click, and Illegal invocation alert. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-008.json` records the direct successful damaged inspection with zero salvage and full write-off. DB proofs `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-008.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-008-ui-attempt.json` reconcile the direct append-only events and unchanged visible-attempt fixture.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260822-0001 Containers, expand the exact DISPATCHED unit Actions disclosure, choose Return, leave both condition flags clear, enter a reason, and click Record return. The visible form remains open with alert `Illegal invocation`; the UI mutation does not reach the API, while the direct API contract succeeds for the separate evidence fixture.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-009` Create one-to-one repacking batch.
  - Status: `FAIL`
  - Expected: compatible source becomes REPACKED only through transactional batch creation; new batch kind REPACKING and full source snapshot.
  - Evidence: Browser actions `DV2-EXC-009-20260822143436374-DV2-EXC-009-drain-00076`, `DV2-EXC-009-20260822143438966-DV2-EXC-009-drain-00077`, `DV2-EXC-009-20260822143455894-DV2-EXC-009-drain-00078`, `DV2-EXC-009-20260822143458925-DV2-EXC-009-drain-00079`, `DV2-EXC-009-20260822143500296-DV2-EXC-009-drain-00080`, and `DV2-EXC-009-20260822143502526-DV2-EXC-009-drain-00081` show the visible Repacking form, exact source selection, reason, submit click, and Illegal invocation alert; the UI did not submit a batch. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-009.json` records the direct one-to-one batch, start, output, and seal path. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-009.json` reconciles source REPACKED state, consumed reservation, completed REPACKING batch, new barcode, and one-to-one Decimal lineage.
  - Defect: `DV2-DEF-004`
  - Reproduction: In authenticated iab, open PB-20260821-0034 Repacking, select PKU-PB-20260821-0034-L1-U0001, enter the QA reason, and click Create repacking batch. The visible form remains populated with alert `Illegal invocation`; the UI mutation does not reach the API, while the direct API path completes the exact one-to-one repacking.
  - mutationPreventedByProductDefect: `true`

- [x] `DV2-EXC-010` Many-to-many repacking.
  - Status: `PASS`
  - Expected: multiple compatible sources and outputs conserve count/weight, create new barcodes, and retain every ancestry edge.
  - Evidence: Browser actions `DV2-EXC-010-20260822144325923-DV2-EXC-010-drain-00082`, `DV2-EXC-010-20260822144341645-DV2-EXC-010-drain-00083`, `DV2-EXC-010-20260822144358707-DV2-EXC-010-drain-00084`, `DV2-EXC-010-20260822144434877-DV2-EXC-010-drain-00085`, `DV2-EXC-010-20260822144437827-DV2-EXC-010-drain-00086`, `DV2-EXC-010-20260822144440046-DV2-EXC-010-drain-00087`, `DV2-EXC-010-20260822144448208-DV2-EXC-010-drain-00088`, `DV2-EXC-010-20260822144506210-DV2-EXC-010-drain-00089`, and `DV2-EXC-010-20260822144507754-DV2-EXC-010-drain-00090` show the authenticated batch-list search, source-batch selection, Repacking tab, reason, and both source identities staged without claiming a visible submit. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-010.json` records the two-source batch, two outputs, exact seals, new barcodes, and completion. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-010.json` reconciles both source transitions, Decimal reservations/consumption, append-only events, and distinct output identities.

- [x] `DV2-EXC-011` Reject incompatible or ineligible repacking source set.
  - Status: `PASS`
  - Expected: item/recipe/customer/state/hierarchy incompatibility fails atomically; no source becomes REPACKED.
  - Evidence: Browser actions `DV2-EXC-011-20260822145359804-DV2-EXC-011-drain-00002`, `DV2-EXC-011-20260822145422672-DV2-EXC-011-drain-00003`, `DV2-EXC-011-20260822145426454-DV2-EXC-011-drain-00004`, and `DV2-EXC-011-20260822145430343-DV2-EXC-011-drain-00005` show the authenticated Repacking form reset, customer-restricted recipe selection, exact reason, and QUALITY_HOLD source identity staged as visible input without claiming a visible submit. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-011.json` records stable HTTP 409 `packed_source_ineligible`; DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-011.json` proves the source stayed QUALITY_HOLD with unchanged Decimal content/version/events and no marker batch.

- [x] `DV2-EXC-012` Repacking source reservation concurrency.
  - Status: `PASS`
  - Expected: a unit cannot simultaneously be a Packing source and reserve/dispatch/damage target.
  - Evidence: Browser actions `DV2-EXC-012-20260822145601205-DV2-EXC-012-drain-00006`, `DV2-EXC-012-20260822145617821-DV2-EXC-012-drain-00007`, `DV2-EXC-012-20260822145623165-DV2-EXC-012-drain-00008`, and `DV2-EXC-012-20260822145628707-DV2-EXC-012-drain-00009` show the authenticated Repacking form reset, compatible recipe selection, exact reason, and eligible source identity staged without claiming a visible submit. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-012.json` records one successful reservation and a distinct-key HTTP 409 `packed_source_reserved` replay attempt. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-012.json` reconciles one active reservation, unchanged source content/status, and no duplicate marker batch.

## 20. Phase M: reconciliation and opening balances

- [x] `DV2-ADJ-001` Create DRAFT manual correction batch.
  - Status: `FAIL`
  - Expected: `IAB-...`, kind/status/effectiveAt/reason/evidence/idempotency/actor and exact signed lines persist; availability unchanged while DRAFT.
  - Evidence: Browser action `DV2-ADJ-001-20260822170200142-DV2-ADJ-001-drain-00003` shows the authenticated `iab` Reports surface and visible read-only Reconciliation report; no create-adjustment or draft-submit control was present, so the required visible mutation was prevented by product defect `DV2-DEF-016`. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-001.json` records HTTP 200 creation of `IAB-20260822-0001` as a DRAFT with the exact signed Coning line. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-001.json` records the persisted batch/line and unchanged `RCO-021-C001` availability.

- [x] `DV2-ADJ-002` Validate adjustment lines.
  - Status: `PASS`
  - Procedure: empty, duplicate identity, zero/invalid delta, invalid kind/status/source, nonexistent source, and over-negative result.
  - Expected: stable atomic rejection.
  - Evidence: Browser action `DV2-ADJ-002-20260822170209385-DV2-ADJ-002-drain-00004` shows the authenticated Reconciliation report refreshed as a read-only table with no validation-submit control. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-002.json` records distinct-key atomic responses for duplicate identity, zero delta, invalid kind, nonexistent source apply, and over-negative apply. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-002.json` proves only the two intentionally created throwaway DRAFT batches exist and the Coning source row stayed unchanged.

- [x] `DV2-ADJ-003` Preview adjustment batch.
  - Status: `FAIL`
  - Expected: before/after exact count/weight and blockers are correct; preview is read-only and requires only Packing READ.
  - Evidence: Browser action `DV2-ADJ-003-20260822170219255-DV2-ADJ-003-drain-00005` shows the authenticated read-only Reconciliation report with no preview form. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-003.json` records the DRAFT and malformed Decimal preview. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-003.json` proves preview did not mutate the DRAFT or Coning source. Defect `DV2-DEF-006`: create DRAFT `IAB-20260822-0004` with a `CONING_RECEIVE` line of `countDelta=1` and `weightDeltaKg=0.1`, then POST the preview; the API returns `after.weight="160.1"` instead of numeric `16.1`.

- [x] `DV2-ADJ-004` Apply adjustment batch.
  - Status: `FAIL`
  - Expected: state APPLIED, timestamp/actor/audit, availability changes once, notification once, idempotent replay.
  - Evidence: Browser action `DV2-ADJ-004-20260822170240354-DV2-ADJ-004-drain-00006` records the visible read-only surface and `mutationSubmitted:false`. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-004.json` records create, one APPLIED response, same-key replay, and the distinct-key conflict. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-004.json` reconciles one line, one apply audit, and the exact signed +1/+0.100 delta with no duplicate adjustment line. Defect `DV2-DEF-016`: the authenticated Reconciliation report has no DRAFT-selection or Apply control, so the required visible mutation could not be submitted.

- [x] `DV2-ADJ-005` Reverse applied adjustment.
  - Status: `FAIL`
  - Expected: state REVERSED, reversal lines link originals, availability returns exactly, append-only history/notification.
  - Evidence: Browser action `DV2-ADJ-005-20260822170249973-DV2-ADJ-005-drain-00007` records the visible read-only surface and no reverse control. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-005.json` records the original/reversal response. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-005.json` reconciles the REVERSED original, APPLIED reversal, linked line, two append-only audits, and unchanged raw Coning source. Defect `DV2-DEF-016`: the authenticated Reconciliation report has no Reverse control, so the required visible mutation could not be submitted.

- [x] `DV2-ADJ-006` Reject apply/reverse invalid states and double reversal.
  - Status: `FAIL`
  - Expected: stable conflict and no duplicate lines/audit.
  - Evidence: Browser action `DV2-ADJ-006-20260822170259274-DV2-ADJ-006-drain-00008` records the visible read-only invalid-state surface. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-006.json` records both stable conflicts and the unexpected successful double reversal. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-006.json` reconciles the three linked batches, one extra APPLIED reversal, and the append-only audit counts. Defect `DV2-DEF-017`: direct API apply and reverse on the REVERSED original returned 409, but reversing the already-APPLIED reversal batch succeeded and created `IAB-20260822-0007`; the browser surface had no invalid-state controls because of `DV2-DEF-016`.

- [x] `DV2-ADJ-007` Create LEGACY_CUTOVER draft from audited balance.
  - Status: `PASS`
  - Expected: only negative availability deltas, complete source snapshots, no fake Dispatch rows or legacy row deletion.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-007.json` records the corrected complete-lineage LEGACY_CUTOVER DRAFT `IAB-20260822-0009` with a single -1/-0.100 signed line. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-007.json` proves both marker drafts are DRAFT, the selected line snapshots preserve item/lot/cone lineage, the raw source remains non-deleted, and Dispatch/DispatchChallan/legacy-link counts remain 2156/29/0.

- [x] `DV2-ADJ-008` Draft Coning settlement blocker.
  - Status: `PASS`
  - Procedure: establish at least one current draft Coning settlement in QA DB, then preview/apply cutover.
  - Expected: current count is queried and operation refuses; no hard-coded historical count.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-008.json` records the gated cutover apply refusing with live `draft_coning_settlements_exist` count 13. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-008.json` documents the existing current draft settlements, the temporary exact-QA launch-state gate and transaction-safe restoration to ACTIVE, and the cutover batch remaining DRAFT.

- [x] `DV2-ADJ-009` Dual-verification evidence.
  - Status: `PASS`
  - Expected: distinct valid preparer/verifier required; same/missing/invalid identity fails.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-009.json` records distinct missing-evidence, same-user, and inactive/unknown-user requests returning the exact dual-verification errors. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-009.json` proves all three failures left the linked OPENING_BALANCE batch DRAFT with zero lines and no opening inventory.

- [x] `DV2-ADJ-010` Import classified loose opening balance.
  - Status: `PASS`
  - Expected: explicit payment-exempt Coning opening source, cutover linkage, lineage masters/count/weight preserved, no contractor earnings.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-010.json` records the authenticated opening import of three cones at 0.750 kg through the linked cutover. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-010.json` reconciles the APPLIED OPENING_BALANCE line, cutover link, complete masters/lineage, `isOpeningStock=true`, `createdBy=OPENING_BALANCE`, and zero contractor settlement lines.

- [x] `DV2-ADJ-011` Import classified packed opening balance.
  - Status: `PASS`
  - Expected: OPENING Packing batch and Packed Units, new globally unique barcodes, exact hierarchy/stock level, payment exemption, cutover linkage.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-011.json` records the linked PACKED import with active recipe, stock level 1, count 10, and conserved 1.375/0.125/1.250 weights. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-011.json` reconciles the COMPLETED OPENING Packing batch, globally unique AVAILABLE unit/barcode, hierarchy fields, opening linkage, event, and zero contractor settlement lines.

- [x] `DV2-ADJ-012` Reject damaged, uncertain, or missing opening classification.
  - Status: `PASS`
  - Expected: entire invalid line/batch is rejected until classified; no ambiguous inventory.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-012.json` records atomic 400 responses for DAMAGED, UNCERTAIN, and missing classifications. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-012.json` proves the linked opening batch stayed DRAFT with zero lines and no marker inventory.

- [x] `DV2-ADJ-013` Opening importer duplicate protections.
  - Status: `PASS`
  - Expected: duplicate batch idempotency key and line-level source identity replay/refuse without duplicate source/unit/barcode.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-013.json` records same-key DRAFT creation replay, same-key import replay, and duplicate sourceIdentity rejection. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-013.json` proves the successful batch has one line/source and the duplicate-line batch remains DRAFT with zero lines and zero duplicate inventory.

- [x] `DV2-ADJ-014` Opening import transaction atomicity.
  - Status: `PASS`
  - Procedure: valid lines followed by one invalid/duplicate barcode line.
  - Expected: no partial sources, units, batches, lines, or contractor exclusions persist.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-014.json` records two valid PACKED lines sharing one barcode and the atomic `barcode_in_use` refusal. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-014.json` proves the opening batch stayed DRAFT with no lines, packing batches, units, or contractor rows.

- [x] `DV2-ADJ-015` Opening reversal constraints.
  - Status: `PASS`
  - Expected: pristine unused opening inventory reverses through append-only links; inventory already used in Packing/Dispatch/repacking is refused with precise blockers.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-015.json` records the successful pristine reversal and the precise `opening_unit_lineage_not_pristine` refusal after repacking use. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-015.json` reconciles the append-only reversal, soft-deleted opening source, and one downstream PackingBatchSource.

- [x] `DV2-ADJ-016` Contractor-payment exclusion regression.
  - Status: `PASS`
  - Expected: explicit opening marker excludes opening rows from contractor calculations/imports; normal production remains payable; no `createdBy` string inference.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-016.json` records the permission-boundary response and the exact opening source marker. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-016.json` proves zero opening settlement lines versus 1706 normal non-opening settlement lines without inferring from `createdBy`.

## 21. Phase N: historical Dispatch migration and compatibility

- [x] `DV2-LEG-001` Dry inventory of legacy Dispatch groups.
  - Status: `PASS`
  - Expected: row/group counts, supported stages, malformed challan numbers, and inconsistent groups are reported without mutation.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-001.json` records read-only source summary and compatibility history. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-001.json` reconciles 2,156 legacy rows, 255 groups, supported stages, zero malformed rows, and zero inconsistent groups.

- [x] `DV2-LEG-002` Migrate one consistent legacy challan group.
  - Status: `PASS`
  - Expected: one reconstruction challan, one line per legacy row, same challan/customer/date/stage/source/barcode/count/weight/actors/timestamps, unique `legacyDispatchId`.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-002.json` records the migration result and exact consistent target group. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-002.json` reconciles the legacy row to one historical V2 line and unique `legacyDispatchId`.

- [x] `DV2-LEG-003` Reject inconsistent legacy group.
  - Status: `PASS`
  - Procedure: disagreement on customer, date, or stage within one challan.
  - Expected: refusal with diagnostic; no partial representation for that group.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-003.json` records the expected `legacy_challan_inconsistent` refusal for a two-stage fixture. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-003.json` proves no partial V2 representation and exact fixture cleanup.

- [x] `DV2-LEG-004` Migration replay and resumability.
  - Status: `PASS`
  - Expected: same key/batch/cursor resumes safely; already represented rows are not duplicated; totals reconcile.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-004.json` records the identical completed summary on replay. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-004.json` proves unchanged V2 row and migration-audit counts.

- [x] `DV2-LEG-005` Legacy source counters remain unchanged by migration.
  - Status: `PASS`
  - Expected: migration represents history only and does not re-consume source balances.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-005.json` documents the history-only migration operation. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-005.json` compares the pre/post legacy row and stage counters and records zero legacy-source updates/deletes.

- [x] `DV2-LEG-006` Legacy table remains read-only evidence.
  - Status: `PASS`
  - Expected: no migration delete/update; correction/return is append-only through V2 compatibility infrastructure.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-006.json` records the historical read-only refusal. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-006.json` proves the legacy source row and V2 creation events remained unchanged.

- [x] `DV2-LEG-007` Old-browser response adapters.
  - Status: `PASS`
  - Expected: one-release legacy request/response paths continue for supported behavior while new Coning Dispatch creation remains disabled.
  - Evidence: Browser action `DV2-LEG-007-20260822170309509-DV2-LEG-007-drain-00009` shows the exact authenticated `iab` Dispatch route, visible Create dispatch surface without a Coning source selector, and legacy challan search for `DC/25-26/004` returning the historical header. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-001.json` records the compatibility-history response; DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-001.json` reconciles the unchanged 610-row legacy group.

- [x] `DV2-LEG-008` Historical Coning Dispatch readability.
  - Status: `PASS`
  - Expected: legacy Coning lines/details/history remain visible; Coning is never offered for a new Dispatch.
  - Evidence: Browser actions `DV2-LEG-008-20260822164912895-DV2-LEG-008-drain-00003`, `DV2-LEG-008-20260822164928268-DV2-LEG-008-drain-00004`, `DV2-LEG-008-20260822164939960-DV2-LEG-008-drain-00005`, `DV2-LEG-008-20260822164958801-DV2-LEG-008-drain-00006`, and decisive submitted mutation `DV2-LEG-008-20260822165012731-DV2-LEG-008-drain-00007` show the readable historical detail, absent Coning source selector, visible Return form, exact reason, and the submitted legacy read-only response. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-008.json` records HTTP 409 `legacy_dispatch_read_only`; DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-008.json` reconciles unchanged source values, one creation event, and zero reversal events.

- [x] `DV2-LEG-009` On-demand LEGACY_RECONSTRUCTION PDF.
  - Status: `PASS`
  - Expected: generated from historical snapshot, correctly marked, stored/hashed on demand, and does not alter original rows.
  - Evidence: Browser action `DV2-LEG-009-20260822170357229-DV2-LEG-009-drain-00012` records the visible historical detail and Preview PDF control. API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-009.json` records HTTP 200, PDF content type, filename, SHA-256, 41-page snapshot, and representative historical line. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-009.json` reconciles the stored `LEGACY_RECONSTRUCTION` document, byte length/hash, 610-line challan, and unchanged legacy source counters.

- [x] `DV2-LEG-010` Migration totals and per-row coverage.
  - Status: `PASS`
  - Expected: every supported legacy row represented exactly once or explicitly classified as historical-only per implementation contract; no silent gaps.
  - Evidence: API proof `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-LEG-010.json` records the completed migration totals of 2,156 scanned/represented rows, 255 reconstructed challans, 2,156 migrated lines, and supported stage counts. DB proof `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-LEG-010.json` proves every legacy ID has exactly one V2 line, with zero missing rows and zero duplicate/non-unit links, while separately accounting for 32 non-legacy V2 lines.

## 22. Phase O: reports, lineage, notifications, and scanner integration

- [x] `DV2-REP-001` Packing production report.
  - Status: `FAIL`
  - Expected: filters/pagination and batch/output/source totals match SQL across completed, short-closed, and opening batches.
  - Evidence: Browser actions `DV2-REP-001-20260822172200771-DV2-REP-001-drain-00002`, `DV2-REP-001-20260822172403233-DV2-REP-001-drain-00003`, `DV2-REP-001-20260822173405712-DV2-REP-001-drain-00013`, and `DV2-REP-001-20260822173251386-DV2-REP-001-drain-00012` show the authenticated Reports/Packing Reports route, visible date range, and Refresh submission. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-001-date-filter.json` records HTTP 200 with `filters.dateFrom` and `filters.dateTo` both null and 52 rows after the visible 2026-08-21 through 2026-08-22 submission. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-001.json` independently reconciles 52 batches, 479 actual pcs, 68.100 kg, and the batch status totals.
  - Defect: `DV2-DEF-018`
  - Reproduction: In authenticated iab on `/app/reports`, open Packing Reports, enter From `2026-08-21` and To `2026-08-22`, and click the visible Refresh button. The controls visibly retain the dates before submit, but the captured request is `/api/packing-reports/production?limit=100` with both date filters null and the unbounded 52-row report returns. The unbounded totals match the isolated QA SQL, but the required date-bounded report cannot be obtained through the visible workflow.

- [x] `DV2-REP-002` Packed Stock report.
  - Status: `PASS`
  - Expected: AVAILABLE/RESERVED/customer/opening and other status totals match exact units/count/weight.
  - Evidence: Browser action `DV2-REP-002-20260822173554735-DV2-REP-002-drain-00014` shows the authenticated Packed Stock tab and 16 visible rows. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-002.json` records HTTP 200 with the default AVAILABLE/RESERVED filters, 16 rows, and summary groups of AVAILABLE 7/70 pcs/8.775 kg and RESERVED 9/83 pcs/10.375 kg, including customer and opening-batch fields. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-002.json` independently matches the status, customer, unit, base-count, and Decimal weight aggregates.

- [x] `DV2-REP-003` Yield and variance report.
  - Status: `PASS`
  - Expected: planned/actual/source/output variances and threshold exceptions match event payloads and independent arithmetic.
  - Evidence: Browser action `DV2-REP-003-20260822173743618-DV2-REP-003-drain-00015` shows the authenticated Yield & Variance report with 48 visible rows. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-003.json` records HTTP 200, 48 `UNIT_SEALED` rows, and severity counts NORMAL 47, WARNING 0, APPROVAL_REQUIRED 1. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-003.json` independently derives planned/actual Decimal weight percentages and the same threshold classification, including the one approval-level event.

- [x] `DV2-REP-004` Exceptions report.
  - Status: `FAIL`
  - Expected: quality holds, variance, returns, damage, write-offs, repacking, label pending, and exceptional events are included without double counting.
  - Evidence: Browser action `DV2-REP-004-20260822173900318-DV2-REP-004-drain-00016` shows the authenticated Exceptions report. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-004.json` records HTTP 200 and 55 rows, exactly 39 packing exception events plus 16 Dispatch exception events, with no duplicate IDs. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-004.json` matches those 55 rows but also proves 6 current QUALITY_HOLD units and 48 UNIT_SEALED variance events are absent from this report.
  - Defect: `DV2-DEF-019`
  - Reproduction: In authenticated iab on `/app/reports`, open Packing Reports and select Exceptions. The report renders only the 39 packing exception events and 16 Dispatch exception events; it omits the isolated QA database's 6 QUALITY_HOLD units and 48 UNIT_SEALED variance events required by this test's exception coverage.

- [x] `DV2-REP-005` Reconciliation report.
  - Status: `PASS`
  - Expected: LEGACY_CUTOVER/manual/opening batches and lines show correct status, signed deltas, links, and reversals; never mislabeled customer Dispatch.
  - Evidence: Browser action `DV2-REP-005-20260822174051072-DV2-REP-005-drain-00017` shows the authenticated Reconciliation report with 20 visible batches. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-005.json` records HTTP 200, signed summary `-997` pcs/`-998.8` kg, and active launch state. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-005.json` reconciles LEGACY_CUTOVER, MANUAL_CORRECTION, and OPENING_BALANCE status groups, 15 signed lines, reversal/replacement links, Decimal totals, and zero Dispatch adjustment lines.

- [x] `DV2-REP-006` Report input validation and bounded pagination.
  - Status: `PASS`
  - Expected: invalid date/cursor/enum/limit returns stable error; maximum page bounded; cursors do not duplicate/omit rows.
  - Evidence: Browser action `DV2-REP-006-20260822174317018-DV2-REP-006-drain-00018` shows the authenticated Packing Production surface with 52 rows from the fixed `limit=100` request. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-006.json` records stable `invalid_report_request` errors for invalid date, cursor, enum, and limit; a requested limit of 999 remains bounded; and eight cursor pages traverse all 52 rows with zero duplicates or omissions. UI API proof is `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-006-ui.json`.

- [x] `DV2-LIN-001` Full upstream-to-Dispatch barcode lineage.
  - Status: `PASS`
  - Expected: Holo Receive -> Coning Issue -> Coning Receive -> Packing batch -> hierarchy -> reservation -> challan/line -> later events, with correct parent/child order.
  - Evidence: Browser actions `DV2-LIN-001-20260822174452273-DV2-LIN-001-drain-00019`, `DV2-LIN-001-20260822174515076-DV2-LIN-001-drain-00020`, `DV2-LIN-001-20260822174754779-DV2-LIN-001-drain-00023` show the authenticated Barcode History form, exact barcode submission, and decisive full-tree result. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-001.json` records the found 104-node tree across inbound, cutter, Holo, Coning, packing, packed-unit, event, and Dispatch V2 stages. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-001.json` reconciles the packed unit, CONING_RECEIVE source, Holo receive match, packed Dispatch line `DC/26-27/145`, and later unit events.

- [x] `DV2-LIN-002` Repacking/split/replacement lineage.
  - Status: `PASS`
  - Expected: old and new identities remain navigable in both directions; no lineage edge is lost.
  - Evidence: Browser actions `DV2-LIN-002-20260822174849692-DV2-LIN-002-drain-00025` and `DV2-LIN-002-20260822174934145-DV2-LIN-002-drain-00027` show visible traces for the old and new replacement barcodes, both found with HTTP 200. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-002.json` records both resolved identities and reciprocal replacement payloads. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-002.json` proves the old VOIDED unit points to the new AVAILABLE unit and both append-only replacement events preserve the old/new identities.

- [x] `DV2-LIN-003` Return/damage/write-off/reversal lineage.
  - Status: `FAIL`
  - Expected: append-only events appear once in correct sequence with reasons and actor.
  - Evidence: Browser actions `DV2-LIN-003-20260822175052463-DV2-LIN-003-drain-00029` and `DV2-LIN-003-20260822175126124-DV2-LIN-003-drain-00031` show the authenticated traces for the returned/damaged packed unit and the reversal-event source barcode. API/DB `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-003.json` and `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-003.json` prove the packed unit's single ordered return, damage, write-off, and inspection events with reasons/actors, plus one Dispatch reversal event, but the visible reversal trace returns HTTP 500 `Maximum call stack size exceeded`.
  - Defect: `DV2-DEF-020`
  - Reproduction: In authenticated iab Barcode History, enter `RHO-10623-C001`, the source barcode of `DC/26-27/154`'s `DISPATCH_EVENT_REVERSED` event, and submit Trace barcode. The authoritative endpoint returns HTTP 500 `packing_lineage_failed` with `Maximum call stack size exceeded`, so the reversal cannot be rendered in lineage.

- [x] `DV2-LIN-004` Legacy cutover/opening lineage.
  - Status: `PASS`
  - Expected: adjustment and replacement opening inventory appear as Inventory Adjustment/Opening Balance, never fake customer Dispatch.
  - Evidence: Browser action `DV2-LIN-004-20260822175247714-DV2-LIN-004-drain-00033` shows the authenticated trace for `PKU-QA-DV2-ADJ011-001`; the visible tree found the opening unit and rendered an Inventory Adjustment node without a customer Dispatch node. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-004.json` records the found tree stages. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-004.json` proves the OPENING batch, APPLIED OPENING_BALANCE line, signed delta, and zero Dispatch lines.

- [x] `DV2-LIN-005` Lineage limits and exact lookup.
  - Status: `FAIL`
  - Expected: exact barcode only; bounded tree/flattened result reports truncation honestly; unknown/ambiguous barcode fails stably.
  - Evidence: Browser actions `DV2-LIN-005-20260822175413332-DV2-LIN-005-drain-00035` and `DV2-LIN-005-20260822175443608-DV2-LIN-005-drain-00037` show the exact and unknown visible lookup journeys. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-005.json` records exact HTTP 200 resolution of a 172-node tree and stable unknown `found:false`; the isolated service probe with `maxNodes:40` instead raises `TypeError: Cannot read properties of undefined (reading length)` before it can report truncation. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-005.json` proves one exact row, zero unknown rows, and no ambiguous duplicate.
  - Defect: `DV2-DEF-021`
  - Reproduction: Invoke the authoritative lineage service for exact barcode `PKU-PB-20260822-0003-L1-U0001` with the bounded option `maxNodes:40`. When the node budget is reached, the traversal calls `addChild` on a truncation marker without children and throws `TypeError: Cannot read properties of undefined (reading length)` instead of returning an honest truncated tree.

- [x] `DV2-NOTIFY-001` Batch-level notification matrix.
  - Status: `FAIL`
  - Expected: completion, short-close, optional customer-ready, quality/variance exception, damage/write-off, and reconciliation apply/reverse notify once; routine unit seal does not.
  - Evidence: API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-NOTIFY-001.json` records the seven packing notification event contracts and sanitized formatter outputs without invoking a sender. DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-NOTIFY-001.json` records 0 `packing_%` delivery rows and 0 routine seal rows in the isolated NotificationDeliveryLog, despite the run-scoped completion, short-close, variance, damage/write-off, and reconciliation fixtures.
  - Defect: `DV2-DEF-022`
  - Reproduction: Inspect the isolated NotificationDeliveryLog after the run-scoped packing and reconciliation workflows. No delivery row exists for any `packing_batch_completed`, `packing_batch_short_closed`, `packing_quality_variance_exception`, `packing_damage_write_off`, `packing_reconciliation_applied`, `packing_reconciliation_reversed`, or `packing_customer_ready` event; the only observed packing notification contract is an unconnected pure formatter module.

- [x] `DV2-NOTIFY-002` Idempotent notification replay.
  - Status: `FAIL`
  - Expected: replayed mutation does not send a second notification.
  - Evidence: API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-NOTIFY-002.json` and DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-NOTIFY-002.json` reconcile 46 distinct replay-relevant idempotency audit keys with zero duplicate keys, but also zero packing notification rows and zero duplicate notification groups. The no-duplicate observation is therefore not a passing notification replay proof because no first packing notification was delivered.
  - Defect: `DV2-DEF-022`
  - Reproduction: For the existing completion, short-close, write-off, and reconciliation idempotency audit keys, query NotificationDeliveryLog by the seven packing event names. The replay-safe audit keys exist exactly once, but no corresponding first or replay notification row exists.

- [x] `DV2-SCAN-001` Shared scanner recognizes `PKU-` barcodes.
  - Status: `FAIL`
  - Expected: routes to authoritative lookup and correct feature context; legacy prefixes continue working.
  - Evidence: Browser actions `DV2-SCAN-001-20260822175914249-DV2-SCAN-001-drain-00038`, `DV2-SCAN-001-20260822175933809-DV2-SCAN-001-drain-00039`, `DV2-SCAN-001-20260822175950855-DV2-SCAN-001-drain-00040`, `DV2-SCAN-001-20260822180006797-DV2-SCAN-001-drain-00041`, `DV2-SCAN-001-20260822180032566-DV2-SCAN-001-drain-00042`, `DV2-SCAN-001-20260822180036013-DV2-SCAN-001-drain-00043`, `DV2-SCAN-001-20260822180106356-DV2-SCAN-001-drain-00044`, and `DV2-SCAN-001-20260822180110532-DV2-SCAN-001-drain-00045` show the authenticated Reports Barcode History route, visible Scanner toggle, Start Scanner attempt, Manual fallback, PKU- lookup, and legacy RHO- lookup. API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-SCAN-001.json` records the PKU- HTTP 200/found=true 104-node authoritative tree and legacy RHO- HTTP 500 `packing_lineage_failed`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-SCAN-001.json` reconciles the PKU packed unit and the existing non-deleted RHO source row.
  - Defect: `DV2-DEF-023`
  - Reproduction: In authenticated iab on `/app/reports`, open the visible Scanner, click Start Scanner, select the visible Manual fallback, enter `PKU-PB-20260822-0008-L1-U0002`, and click Search Barcode. The PKU- lookup returns HTTP 200 with the authoritative 104-node tree. Then enter legacy `RHO-10455-C001` in the same visible manual scanner input and click Search Barcode. The legacy lookup returns HTTP 500 `packing_lineage_failed` with `Maximum call stack size exceeded`, so legacy prefixes do not continue working through the shared scanner workflow.

## 23. Phase P: cutover tooling and deployment hardening rehearsal

All tests in this section are local or isolated rehearsal only. Do not deploy or contact production for writes.

- [x] `DV2-CUT-001` Cutover `status` and `preview` are read-only.
  - Status: `FAIL`
  - Expected: current launch state, batch, blockers, settlement count, and readiness evidence are accurate with no mutation.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-001.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-001.json`; exact isolated QA CLI status/preview commands were read-only.

- [x] `DV2-CUT-002` Apply requires idempotency, valid DRAFT LEGACY_CUTOVER, no blockers, and gated writes.
  - Status: `PASS`
  - Expected: each missing prerequisite fails; valid isolated apply reaches `CUTOVER_APPLIED` with writes paused and append-only audit.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-002.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-002.json`; exact QA CLI probes, valid apply, same-key replay, append-only reversal cleanup, and launch restoration are recorded.

- [x] `DV2-CUT-003` Apply failure state.
  - Status: `PASS`
  - Expected: controlled failure records `FAILED`, last error/diagnostics, leaves affected writes gated, and does not hide partial evidence.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-003.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-003.json`; exact isolated QA apply failure and post-failure state proof are recorded.

- [x] `DV2-CUT-004` Reverse cutover.
  - Status: `FAIL`
  - Expected: append-only reversal restores availability exactly and moves launch state coherently without deleting historical rows.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-004.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-004.json`; the supported reverse CLI error and exact QA append-only cleanup/restoration are recorded.

- [x] `DV2-CUT-005` Activation evidence contract.
  - Status: `FAIL`
  - Procedure: independently omit or falsify migration status, historical migration per-row proof, historical Coning compatibility, barcode uniqueness, owner snapshot references, packed Dispatch lineage, reconciliation totals, readiness/health, append-only acceptance, and owner acceptance.
  - Expected: each missing/failed evidence section blocks ACTIVE with precise stable diagnostics.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-005.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-005.json`; incomplete-evidence activation probe and exact QA prerequisite state are recorded.

- [x] `DV2-CUT-006` Valid activation.
  - Status: `FAIL`
  - Expected: only complete verified step-10 evidence and explicit owner acceptance move state to ACTIVE and release affected writes.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-006-evidence.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-006.json`; exact isolated QA activation attempt returned the linked-opening SQL error before ACTIVE transition.

- [x] `DV2-CUT-007` Recovery acceptance/resume workflow.
  - Status: `PASS`
  - Expected: supported recovery commands enforce evidence and state prerequisites; do not silently reactivate.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-007.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-007.json`; premature rejection, explicit recovery acceptance, append-only reversal, fixture cleanup, and ACTIVE runtime restoration are recorded.

- [x] `DV2-CUT-008` Exact deployed SHA contract in compose/workflow.
  - Status: `PASS`
  - Expected: `GLINTEX_DEPLOY_SHA` flows to readiness and verification; unknown/mismatch is visible and blocks evidence acceptance where required.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-CUT-008.json`; `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-008.json`; source/workflow inspection and local readiness output prove exact-SHA propagation and visible unknown state without deployment.

- [x] `DV2-CUT-009` Pre-deployment backup and migration separation in workflow.
  - Status: `PASS`
  - Expected: backup precedes live changes; additive migration is separate from long historical migration/cutover/import commands.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-CUT-009.json`; read-only workflow inspection proves backup ordering and command separation without executing deployment.

- [x] `DV2-CUT-010` Container health dependency.
  - Status: `PASS`
  - Expected: backend health checks readiness; frontend depends on backend health rather than container-start; local/public polling and expected-container verification are present.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-CUT-010.json`; read-only compose/workflow inspection proves readiness-based backend health and service_healthy deployment dependencies.

- [x] `DV2-CUT-011` Rehearsal from a fresh database copy.
  - Status: `FAIL`
  - Expected: migration -> writes gated -> historical migration -> cutover -> opening import -> evidence -> activation completes only in isolated rehearsal and produces a full timestamped artifact set.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-011-rehearsal.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-011-rehearsal.json`; exact dump restore, full migration, WRITES_GATED transition, historical migration totals, cutover availability delta, opening-import/activation/reversal failures, settlement-hook cleanup, and temporary-database absence are recorded.
  - Observed: the exact fresh-copy sequence completed migration and cutover, but the supported opening importer, activation command, and reverse command each returned Prisma P2010/PostgreSQL 42883 `operator does not exist: InventoryAdjustmentKind = text` before opening import, ACTIVE activation, or append-only reversal could complete.

- [x] `DV2-CUT-012` Rehearsal failure and rollback.
  - Status: `FAIL`
  - Expected: injected failure keeps writes gated, records FAILED, reverses append-only cutover changes where safe, preserves diagnostics, and retains legacy-readable operation.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-012.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-012.json`; exact isolated QA failure, supported reverse command error, append-only cleanup, and ACTIVE/false restoration are recorded.

## 24. Phase Q: nonfunctional, regression, and explicit exclusions

- [x] `DV2-NFR-001` Initial page-load network budget.
  - Status: `PASS`
  - Expected: Packing, Stock, Dispatch, and Reports use summary/cursor APIs and lazy detail; no complete source/history download.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-001-network.json`; Browser actions `DV2-NFR-001-20260822182414988-DV2-NFR-001-drain-00002`, `DV2-NFR-001-20260822182208923-DV2-NFR-001-drain-00002`, `DV2-NFR-001-20260822182251646-DV2-NFR-001-drain-00002`, and `DV2-NFR-001-20260822182337948-DV2-NFR-001-drain-00002`; decisive screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-NFR-001-packing-app93.png`, `QP-07-DV2-NFR-001-stock-app90.png`, `QP-07-DV2-NFR-001-dispatch-app91.png`, and `QP-07-DV2-NFR-001-reports-app92.png`; recorder gaps were repeated and resolved across app-88 through app-93.

- [x] `DV2-NFR-002` Large fixture pagination and response time.
  - Status: `PASS`
  - Procedure: generate a safe meaningful fixture volume in QA DB and measure source, stock, history, report, and export behavior.
  - Expected: bounded memory/response sizes, stable cursors, indexed plans, no unbounded synchronous bulk work.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-002-performance.json`; Browser actions `DV2-NFR-002-20260822182929201-DV2-NFR-002-drain-00003`, `DV2-NFR-002-20260822183024267-DV2-NFR-002-drain-00004`, `DV2-NFR-002-20260822183042657-DV2-NFR-002-drain-00005`, `DV2-NFR-002-20260822183055982-DV2-NFR-002-drain-00006`, `DV2-NFR-002-20260822183113906-DV2-NFR-002-drain-00007`, `DV2-NFR-002-20260822183130891-DV2-NFR-002-drain-00008`, and `DV2-NFR-002-20260822183144119-DV2-NFR-002-drain-00009`; decisive screenshots are under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-NFR-002-*.png`.

- [x] `DV2-NFR-003` Decimal and rounding consistency.
  - Status: `FAIL`
  - Expected: three-decimal weights and variances agree across DB/API/UI/PDF/CSV; no floating-point drift causes balance or conservation errors.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-003-decimal.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-NFR-003.json`; Browser actions `DV2-NFR-003-20260822183312981-DV2-NFR-003-drain-00010`, `DV2-NFR-003-20260822183403404-DV2-NFR-003-drain-00011`, `DV2-NFR-003-20260822183412339-DV2-NFR-003-drain-00012`, `DV2-NFR-003-20260822183421981-DV2-NFR-003-drain-00013`, `DV2-NFR-003-20260822183432079-DV2-NFR-003-drain-00014`, and `DV2-NFR-003-20260822183446113-DV2-NFR-003-drain-00015`; PDF `qa-evidence/DV2-20260821T123729Z/pdf/QP-07-DV2-NFR-003-DC_26-27_145.pdf`; CSV `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-003-DC_26-27_145.csv`.

- [x] `DV2-NFR-004` Responsive usability.
  - Status: `PASS`
  - Expected: critical Packing/Stock/Dispatch/Settings/Reports flows work at phone, tablet, and desktop widths with no unreachable control or clipped evidence.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-004-responsive.json`; Browser actions `DV2-NFR-004-20260822183839415-DV2-NFR-004-drain-00016` through `DV2-NFR-004-20260822184310672-DV2-NFR-004-drain-00038`; decisive screenshots are under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-NFR-004-*.png`; temporary viewport override was reset at recorder drain `DV2-NFR-004-drain-00039`.

- [x] `DV2-NFR-005` Keyboard and basic accessibility pass.
  - Status: `FAIL`
  - Expected: visible focus, labels, tab roles, dialog behavior, action names, error announcements, and no keyboard trap for critical flows.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-005-accessibility.json`; Browser actions `DV2-NFR-005-20260822184622993-DV2-NFR-005-drain-00040`, `DV2-NFR-005-20260822184700839-DV2-NFR-005-drain-00042`, `DV2-NFR-005-20260822184740040-DV2-NFR-005-drain-00045`, `DV2-NFR-005-20260822184836433-DV2-NFR-005-drain-00049`, and restoration `DV2-NFR-005-20260822184844775-DV2-NFR-005-drain-00050`; decisive screenshots are under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-NFR-005-*.png`.

- [x] `DV2-REG-001` Existing Inbound Dispatch regression.
  - Status: `FAIL`
  - Expected: source availability, create, detail, correction/return, historical display, and counters remain correct.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-001.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-001.json`; Browser actions `DV2-REG-001-20260822185005953-DV2-REG-001-drain-00051`, `DV2-REG-001-20260822185015731-DV2-REG-001-drain-00052`, `DV2-REG-001-20260822185026721-DV2-REG-001-drain-00053`, `DV2-REG-001-20260822185036694-DV2-REG-001-drain-00054`, and `DV2-REG-001-20260822185052765-DV2-REG-001-drain-00055`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-REG-001-inbound-submit-result.png`.

- [x] `DV2-REG-002` Existing Cutter Dispatch regression.
  - Status: `FAIL`
  - Expected: same legacy semantics, now through V2 infrastructure.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-002.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-002.json`; Browser actions `DV2-REG-002-20260822185150545-DV2-REG-002-drain-00056`, `DV2-REG-002-20260822185200088-DV2-REG-002-drain-00057`, `DV2-REG-002-20260822185210670-DV2-REG-002-drain-00058`, `DV2-REG-002-20260822185219213-DV2-REG-002-drain-00059`, and `DV2-REG-002-20260822185233442-DV2-REG-002-drain-00060`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-REG-002-cutter-submit-result.png`.

- [x] `DV2-REG-003` Existing Holo Dispatch regression.
  - Status: `FAIL`
  - Expected: same legacy semantics with downstream consumption respected.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-003.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-003.json`; Browser actions `DV2-REG-003-20260822185358509-DV2-REG-003-drain-00061`, `DV2-REG-003-20260822185359846-DV2-REG-003-drain-00062`, `DV2-REG-003-20260822185409108-DV2-REG-003-drain-00063`, `DV2-REG-003-20260822185417345-DV2-REG-003-drain-00064`, and `DV2-REG-003-20260822185432791-DV2-REG-003-drain-00065`; decisive screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-REG-003-holo-submit-result.png`.

- [x] `DV2-REG-004` Existing Coning Stock, re-Coning, and Box Transfer regression.
  - Status: `FAIL`
  - Expected: shared balance integration changes no valid behavior except preventing overuse and removing new Coning Dispatch.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-004.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-004.json`; retained-admin Browser actions `DV2-REG-004-20260822191835775-DV2-REG-004-drain-00005`, `DV2-REG-004-20260822192912804-DV2-REG-004-drain-00015`, and `DV2-REG-004-20260822193405615-DV2-REG-004-drain-00020`; decisive screenshots include `DV2-REG-004-admin-coning-stock-timeout.png`, `DV2-REG-004-admin-reconing-submit-success.png`, and `DV2-REG-004-admin-box-transfer-submit-success.png`.

- [x] `DV2-REG-005` Existing contractor settlement/payment regression.
  - Status: `PASS`
  - Expected: normal production calculations unchanged; only explicit opening sources are payment-exempt; no historical claims are altered.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-005.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-005.json`; visible legacy Contractor Payments workflow opened Draft History and the latest Coning draft, with exact-DB settlement/opening-source reconciliation and no payment or history mutation.

- [x] `DV2-REG-006` Historical barcode and audit regression.
  - Status: `FAIL`
  - Expected: existing barcodes/audit records remain resolvable and unchanged; new lineage extends rather than replaces evidence.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-006.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-006.json`; Browser actions `DV2-REG-006-20260822204728059-DV2-REG-006-drain-00002`, `DV2-REG-006-20260822204751771-DV2-REG-006-drain-00003`, `DV2-REG-006-20260822204809033-DV2-REG-006-drain-00004`, `DV2-REG-006-20260822204820176-DV2-REG-006-drain-00005`, `DV2-REG-006-20260822204833989-DV2-REG-006-drain-00006`, `DV2-REG-006-20260822204846987-DV2-REG-006-drain-00007`, `DV2-REG-006-20260822204905128-DV2-REG-006-drain-00008`, `DV2-REG-006-20260822204917778-DV2-REG-006-drain-00009`, `DV2-REG-006-20260822204930870-DV2-REG-006-drain-00010`, and `DV2-REG-006-20260822204946368-DV2-REG-006-drain-00011`; decisive screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-REG-006-pku-settled-result.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-REG-006-rho-settled-result.png`.

- [x] `DV2-EXCL-001` No Order Management or commercial accounting was introduced.
  - Status: `PASS`
  - Expected: no Sales Order, order line, requested/fulfilled, price, tax, invoice, receivable, or promised-date model/UI/API.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-EXCL-001.json`; complete scoped Prisma model, route/UI token, and exact isolated-QA information-schema absence checks are recorded.

- [x] `DV2-EXCL-002` No packaging-material inventory or location tracking was introduced.
  - Status: `PASS`
  - Expected: package types describe outbound containers only; no procurement/consumption/bin/location movement system.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-EXCL-002.json`; package-type schema/route inspection, enum values, exact QA aggregate, and dedicated location/procurement model absence are recorded.

- [x] `DV2-EXCL-003` No duplicate Packed Stock or Dispatch module.
  - Status: `PASS`
  - Expected: Stock is the sole Packed Stock list; existing Dispatch route presents V2 rather than adding a second business module.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-EXCL-003.json`; Browser action `DV2-EXCL-003-20260822205718344-DV2-EXCL-003-drain-00013` for the visible Packed Stock state transition; supplemental route action `DV2-EXCL-003-20260822205736130-DV2-EXCL-003-drain-00014`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-EXCL-003-packed-stock-control.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-EXCL-003-dispatch-route.png`.

- [x] `DV2-EXCL-004` No hard deletion path for inventory-affecting history.
  - Status: `PASS`
  - Expected: Packing, Packed Stock, Dispatch, reconciliation, return, damage, repacking, correction, and reversal history remain append-only.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-EXCL-004.json`; canonical contract, scoped source scan, exact isolated-QA event/status counts, reversal constraints, and legacy compatibility boundary are recorded.

- [x] `DV2-EXCL-005` No long-lived feature-flag product or extra Packing action permissions.
  - Status: `PASS`
  - Expected: singleton launch state/write gate only; Packing uses `NONE/READ/WRITE`.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/source/QP-07-DV2-EXCL-005.json`; singleton launch-state, write-gate source, permission-contract, exact QA role projection, and feature-flag absence checks are recorded.

## 25. Defect register

Add an entry immediately for every `FAIL`. Do not change product code during this QA run.

| Defect ID | Severity | Test ID | Summary | Reproduction | Expected | Observed | Source/DB/UI evidence | Blocks | Suggested owner |
|---|---|---|---|---|---|---|---|---|---|
| `DV2-DEF-001` | S2 | `DV2-AUTH-004` | Authenticated Packing WRITE session cannot save a new color from the visible Packing settings form. | In iab on `/app/settings/packing`, click Add color, enter `QA-DV2-DV2-20260821T123729Z Color`, and click Save. | WRITE should submit the authorized master mutation and show the created color. | The UI remains on the form and shows `Packing request failed` / `Illegal invocation`; no color or idempotency audit row is created. | `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` action `DV2-AUTH-004-20260821142348835-DV2-AUTH-004-drain-00005`; screenshot `qa-evidence/DV2-20260821T123729Z/ui/DV2-AUTH-004-packing-color-submit-result.png`; DB after `PackingColor=0`, marker row `0`, `AuditLog=21866`. | Packing master WRITE smoke path | Frontend/API request owner |
| `DV2-DEF-002` | S2 | `DV2-AUTH-002` | Packing NONE write probes are intercepted by the cutover write gate instead of returning the required 403 permission response. | Authenticated as reports-only identity `qa_dv2_reports_read_20260821t123729z`, GET `/api/packing/colors` and `/api/packed-stock`, then POST `/api/packing/colors` and `/api/packed-stock/not-a-real-unit/reserve` with the `QA-DV2-DV2-20260821T123729Z-AUTH-002-FORBIDDEN` marker. | Packing NONE reads and writes should return 403. | Reads returned 403, but both writes returned 423 `writes_gated` with launch state `PREPARATION`; no marker row or packed-stock row was created. | `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-002-none.json`; Browser actions `DV2-AUTH-002-20260821144828761-DV2-AUTH-002-drain-00010` and `DV2-AUTH-002-20260821144838282-DV2-AUTH-002-drain-00011`; DB proof records `PackingColor=0`, marker `0`, packed-stock mutation rows `0`. | Packing NONE write-permission boundary | Backend authorization/cutover owner |
| `DV2-DEF-003` | S2 | `DV2-AUTH-001` | Unauthenticated write probes are intercepted by the cutover write gate instead of returning the required 401 response. | Without a session, POST `/api/packing/colors`, `/api/packed-stock/not-real/reserve`, `/api/v2/dispatch/challans`, `/api/v2/dispatch/challans/not-real/void`, `/api/v2/dispatch/lines/not-real/correct`, `/api/v2/dispatch/lines/not-real/return`, and `/api/v2/dispatch/events/not-real/reverse`. | Every protected route, including writes, should return stable 401 unauthorized JSON; readiness remains public. | Protected reads returned 401, but every write probe returned 423 `writes_gated` with launch state `PREPARATION`; no mutation marker or V2 row was created. | `qa-evidence/DV2-20260821T123729Z/api/DV2-AUTH-001-unauthenticated.json`; Browser actions `DV2-AUTH-001-20260821145838978-DV2-AUTH-001-drain-00002` through `DV2-AUTH-001-20260821145905770-DV2-AUTH-001-drain-00005`; DB proof records no marker row. | Unauthenticated write response boundary | Backend authorization/cutover owner |
| `DV2-DEF-004` | S2 | `DV2-REC-001`, `DV2-REC-002`, `DV2-REC-003`, `DV2-REC-007`, `DV2-REC-010`, `DV2-REC-012`, `DV2-BAT-002`, `DV2-BAT-003`, `DV2-BAT-006`, `DV2-BAT-007`, `DV2-BAT-008`, `DV2-BAT-009`, `DV2-BAT-010`, `DV2-BAT-013`, `DV2-BAT-015`, `DV2-BAT-016`, `DV2-BAT-017`, `DV2-BAT-019` | Authenticated Packing master, recipe, and batch mutations fail in the visible UI before surfacing the server result. | In iab as the ordinary Packing WRITE identity, submit the named color/package/recipe/batch form mutations with the QA marker and valid fixture values. | Each affected form shows `Packing request failed` / `Illegal invocation` and retains its pre-mutation state, even where the API lane independently proves the valid mutation or stable domain rejection. | `qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json`; Browser ledger actions including `DV2-BAT-002-20260821184933145-DV2-BAT-002-drain-00003`; screenshot `qa-evidence/DV2-20260821T123729Z/ui/DV2-BAT-002-qp02-customer-create-error-app21.png`. | Authenticated Packing mutation smoke path | Frontend/API request owner |
| `DV2-DEF-005` | S1 | `DV2-BAL-011`, `DV2-BAL-012` | Shared Packing source reservation mutations are not deterministic under concurrent or replayed requests. | On the isolated QA database, concurrently confirm PB-20260821-0020 and PB-20260821-0021 against the same two sources in opposite order, then retry a fixed-key confirm replay. | The locking path should complete without deadlock, return a bounded valid result or stable conflict, and replay one idempotent result without source drift. | One concurrent request returned 500 `internal_error`, the other returned 423 `writes_gated` while launch reads were ACTIVE, and the replay request timed out; both batches remained DRAFT with zero sources and no matching mutation events. | `qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json`. | Source reservation/concurrency trust boundary | Packing reservation transaction owner |
| `DV2-DEF-006` | S2 | `DV2-BAL-008` | Reconciliation preview serializes Decimal weight addition as string concatenation. | Create a +1 count/+0.1 kg adjustment for RCO-021-C001 and inspect the DRAFT and APPLIED preview responses before and after reversal. | Preview weights should remain numeric and equal the authoritative Decimal balance after each signed state transition. | Preview returned `17.250.1` and `17.350.1` as strings, although the applied/reversed database deltas and final authoritative balance reconciled to 17.25 kg. | `qa-evidence/DV2-20260821T123729Z/api/QP-02-api-proof.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-02-db-proof.json`; Browser action `DV2-BAL-008-20260821174725252-DV2-BAL-008-drain-00002`. | Balance preview accuracy | Reconciliation serialization owner |
| `DV2-DEF-007` | S1 | `DV2-STK-001`, `DV2-STK-002`, `DV2-STK-003`, `DV2-STK-004`, `DV2-STK-005`, `DV2-STK-006`, `DV2-STK-007`, `DV2-STK-008`, `DV2-STK-009`, `DV2-STK-010`, `DV2-STK-011`, `DV2-STK-012` | Packed Stock is unusable from the visible Stock route even though the direct service returns active units. | In authenticated iab, open `/app/stock`, click Packed Stock, and exercise the listed filter, lookup, detail, history, reservation, and label-action journeys. | Stock should expose one Packed Stock list with bounded filters, unit detail/history, and role-appropriate row actions. | The Packed Stock button becomes active or the `view=packed` route is requested, but the legacy Stock filters/table remain and the table stays Loading; repeated app logs show `Maximum update depth exceeded` from `PackedStockView`/`Stock`, and no Packed Stock rows or actions render. Direct API/DB proof independently returns units, hierarchy, stable errors, reservation events, and READ write denial; the direct cursor probe also repeated the first page instead of advancing. | `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-STK-001-20260821214116847-DV2-STK-001-drain-00002`, `DV2-STK-002-20260821214233316-DV2-STK-002-drain-00002`, `DV2-STK-003-20260821214313298-DV2-STK-003-drain-00002`, `DV2-STK-004-20260821214331921-DV2-STK-004-drain-00002`, `DV2-STK-005-20260821214352989-DV2-STK-005-drain-00002`, `DV2-STK-006-20260821214410855-DV2-STK-006-drain-00002`, `DV2-STK-007-20260821214432044-DV2-STK-007-drain-00002`, `DV2-STK-008-20260821214458093-DV2-STK-008-drain-00002`, `DV2-STK-009-20260821214516603-DV2-STK-009-drain-00002`, `DV2-STK-010-20260821214536789-DV2-STK-010-drain-00002`, `DV2-STK-011-20260821214554112-DV2-STK-011-drain-00002`, and `DV2-STK-012-20260821215253229-DV2-STK-012-drain-00002`; API/DB files under `qa-evidence/DV2-20260821T123729Z/api/` and `db/`. | Entire Packed Stock user workflow and its dependent reservation/label operations | Frontend Stock/Packed Stock owner |
| `DV2-DEF-008` | S2 | `DV2-DSP-009` | Dispatch source selection does not enforce the customer lock at the visible queue boundary. | In authenticated iab on `/app/dispatch`, add reserved `PKU-PB-20260821-0032-L1-U0002` for `+916353131826`, then add reserved `PKU-PB-20260821-0034-L1-U0001` for `K J E`. | Once a reserved Packed Unit establishes a customer lock, a conflicting reserved source should be rejected before it enters the draft or submission. | The first source locked the Customer selector to `+916353131826`, but the conflicting `K J E` source was added as a second exact line. The API correctly rejected the same conflicting payload with 409 `customer_reservation_mismatch` and no database drift, so the defect is the visible queue admission boundary. | `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl` actions `DV2-DSP-009-20260822061943154-DV2-DSP-009-drain-00020`, `DV2-DSP-009-20260822061945410-DV2-DSP-009-drain-00021`, and cleanup action in the same test segment; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-DV2-DSP-009-customer-lock.png` and `QP-04-DV2-DSP-009-conflict-attempt.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-DSP-009-post.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-DSP-009.json`. | Customer-compatible Dispatch queue | Frontend Dispatch V2 source queue owner |
| `DV2-DEF-009` | S1 | `DV2-DSP-001`, `DV2-DSP-003`, `DV2-DSP-010`, `DV2-DSP-011`, `DV2-DSP-012`, `DV2-DSP-013`, `DV2-PACKDSP-001`, `DV2-PACKDSP-002`, `DV2-PACKDSP-010` | The visible Dispatch submit sends zero-valued partial fields that the API rejects. | In authenticated iab on `/app/dispatch`, add a valid full legacy or Packed source, select the locked customer when applicable, and click Create Dispatch Challan. | A valid full source line should create one atomic challan, consume exact source weight once, transition packed lineage when applicable, and refresh the draft/history. | The visible submit returns `residualBaseCount must be a positive integer`; the line remains staged and no UI-created challan is produced. Direct API calls succeed when optional partial fields are omitted, proving the failure is the frontend payload contract. | `qa-evidence/DV2-20260821T123729Z/browser-actions.jsonl`; decisive screenshots and exact API/DB before-after files are listed on each affected test row, including `DV2-PACKDSP-010-20260822080350581-DV2-PACKDSP-010-drain-00032`, `QP-04-DV2-PACKDSP-010-submit-error.png`, `api/QP-04-DV2-PACKDSP-010-pre.json`, `api/QP-04-DV2-PACKDSP-010-after.json`, `db/QP-04-DV2-PACKDSP-010-pre.json`, and `db/QP-04-DV2-PACKDSP-010-after.json`. | Visible Dispatch creation | Frontend Dispatch V2 submit owner |

| `DV2-DEF-010` | S1 | `DV2-PACKDSP-007` | The Packed partial Dispatch API accepts an invalid excess conservation request and dispatches the whole source. | Authenticated API POST `/api/v2/dispatch/challans` for `PKU-PB-20260821-0030-L1-U0003` with `baseCount=6`, `netWeightKg=0.75`, `residualBaseCount=7`, `residualNetWeightKg=0.875`, zero damaged/lost values, and a reason. | Invalid partial count/weight conservation must fail atomically with no challan, line, child, or source consumption. | The API returned 200, created `DC/26-27/141`, and consumed the source whole at 6/0.75; no residual child was created. Earlier UI validation rejected missing/excess inputs, but the authoritative API accepted the invalid request. | `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-007-validation-suite.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-007-pre.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-04-DV2-PACKDSP-007-after.json`; Browser ledger actions `DV2-PACKDSP-007-20260822072244195-DV2-PACKDSP-007-drain-00011` and `DV2-PACKDSP-007-20260822072309559-DV2-PACKDSP-007-drain-00012`. | Packed partial conservation and atomicity | Backend Packed dispatch validation owner |
| `DV2-DEF-011` | S2 | `DV2-CHL-007` | The visible Void challan flow depends on unavailable `window.prompt`, preventing the required reason submission in the authenticated in-app Browser. | In iab on `/app/dispatch`, open active `DC/26-27/152`, click the visible Void challan control, and attempt the mandatory reason step. | The reason prompt should render, accept the reason, and visibly submit the void mutation. | No reason dialog or visible submit result appears; Browser evaluation reports `typeof window.prompt` as `undefined`. The backend endpoint independently succeeds when invoked directly, but the Browser-required mutation was not submitted. | Browser action `DV2-CHL-007-20260822090923054-DV2-CHL-007-drain-00002`, screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-CHL-007-visible-submit-blocked.png`; API/DB `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-007-post.json`, `.../api/QP-04-CHL-007-after.json`, `.../db/QP-04-CHL-007-after.json`. | Visible challan void workflow | Frontend Dispatch V2 challan detail owner |

| `DV2-DEF-012` | S1 | `DV2-CHL-008` | The void endpoint accepts and mutates an already-returned challan instead of rejecting the terminal/already-returned state. | Create `DC/26-27/153`, return its line once, then invoke the void operation while the line is already RETURNED. | Void, correct, and duplicate return operations against terminal/already-returned state should return stable conflicts without counter or event drift. | Correct and duplicate-return returned 409 `dispatch_line_returned`, but void returned 200, changed the challan to VOIDED, appended CHALLAN_VOIDED, and restored the source counters. | API probes `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-008-first-return-post.json`, `.../api/QP-04-DV2-CHL-008-void-reject-post.json`, `.../api/QP-04-DV2-CHL-008-correct-reject-post.json`, and `.../api/QP-04-DV2-CHL-008-return-reject-post.json`; Browser action `DV2-CHL-008-20260822091414140-DV2-CHL-008-drain-00012`; final API/DB `.../api/QP-04-CHL-008-after.json`, `.../db/QP-04-CHL-008-after.json`. | Terminal challan state and source restoration boundary | Backend challan void/return transaction owner |
| `DV2-DEF-013` | S2 | `DV2-CHL-009` | The visible challan detail has no Reverse action for a reversible correction/return event. | Create a reversible correction event for marker `DC/26-27/154`, open its authenticated iab detail, and inspect the rendered actions. | A reversible event should expose a reasoned visible reverse action and submit the reversal. | The detail renders Preview, Print, Download, Correct, and Return but no Reverse control/form; direct API reverse succeeds, proving the missing control is the UI boundary. | Browser action `DV2-CHL-009-20260822091826702-DV2-CHL-009-drain-00016`, screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-CHL-009-missing-reverse-control.png`; API/DB `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-CHL-009-reverse-post.json`, `.../api/QP-04-CHL-009-after.json`, `.../db/QP-04-CHL-009-after.json`. | Visible event reversal workflow | Frontend Dispatch V2 challan detail owner |
| `DV2-DEF-014` | S2 | `DV2-CHL-013` | Visible multi-challan Preview selected and Print selected controls produce no visible document surface in iab. | In authenticated iab history, select DC/26-27/155 and DC/26-27/154, click Preview selected, then click Print selected. | Each selected challan should render on a distinct deterministic page in a visible preview or print surface. | Both controls leave the history page visible, create no second in-app Browser tab, and expose no preview/print document, even though each direct PDF is independently valid. | Browser actions `DV2-CHL-013-20260822093050547-DV2-CHL-013-drain-00028`, `...93100369...00029`, and `...93114435...00030`; screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-04-CHL-013-`; direct PDF proofs `.../api/QP-04-DV2-CHL-013-155-pdf-proof.json` and `.../api/QP-04-DV2-CHL-013-154-pdf-proof.json`. | Multi-document challan review and printing | Frontend dispatch document preview owner |

| `DV2-DEF-015` | S2 | `DV2-EXC-004` | Packing does not expose a Write off action for an eligible DAMAGED unit. | In authenticated iab on `/app/packing`, open PB-20260821-0018, select Containers, and expand the exact DAMAGED unit Actions disclosure. | A DAMAGED unit should expose a reasoned Write off form and visibly submit the exact count/weight mutation. | No Write off action or form is rendered, so the visible mutation cannot be submitted; direct API/DB proof accepts the exact full write-off and appends the expected events. | Browser actions and screenshot are recorded on the `DV2-EXC-004` runbook row; API `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-EXC-004.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-EXC-004.json`. | Damaged-content write-off workflow | Frontend Packing unit-actions owner |
| `DV2-DEF-016` | S2 | `DV2-ADJ-001`, `DV2-ADJ-004`, `DV2-ADJ-005`, `DV2-ADJ-006` | The authenticated Reconciliation report is read-only and omits required adjustment create, Apply, Reverse, and invalid-state controls. | In exact iab as the QA ordinary write identity, open Reports and the Reconciliation report, then attempt the required manual adjustment create/preview/apply/reverse journeys. | Authorized users should see the required forms and controls and be able to submit each supported adjustment mutation visibly. | The report renders data but no create-adjustment, DRAFT Apply, Reverse, or invalid-state action controls; the required visible mutations cannot be submitted, while direct API/DB lanes prove the corresponding state behavior. | Browser actions `DV2-ADJ-001-20260822170200142-DV2-ADJ-001-drain-00003`, `DV2-ADJ-004-20260822170240354-DV2-ADJ-004-drain-00006`, `DV2-ADJ-005-20260822170249973-DV2-ADJ-005-drain-00007`, and `DV2-ADJ-006-20260822170259274-DV2-ADJ-006-drain-00008`; phase `qa-evidence/DV2-20260821T123729Z/phases/QP-05.json`; related API/DB proofs under `qa-evidence/DV2-20260821T123729Z/api/` and `db/`. | Visible reconciliation adjustment workflow | Frontend Reconciliation/report owner |
| `DV2-DEF-017` | S1 | `DV2-ADJ-006` | The adjustment API permits a second reversal of an already APPLIED reversal batch. | Apply an adjustment, reverse it once, then submit a distinct-key reverse request against the already APPLIED linked reversal batch. | A second reversal must return a stable invalid-state conflict and create no duplicate line, audit, notification, or balance change. | The original invalid-state probes returned stable 409 conflicts, but the second reversal unexpectedly succeeded and created `IAB-20260822-0007` as another APPLIED reversal with an extra audit/line. | API `qa-evidence/DV2-20260821T123729Z/api/QP-05-DV2-ADJ-006.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-05-DV2-ADJ-006.json`; Browser action `DV2-ADJ-006-20260822170259274-DV2-ADJ-006-drain-00008`. | Adjustment reversal idempotency and state integrity | Backend reconciliation reversal owner |
| `DV2-DEF-018` | S2 | `DV2-REP-001` | The visible Packing Production date filters are omitted from the production-report request. | In authenticated iab on `/app/reports`, open Packing Reports, enter From `2026-08-21` and To `2026-08-22`, and click Refresh. | The request should carry the visible date bounds and return only batches inside the selected range. | The visible controls retain both dates before submit, but the captured request is `/api/packing-reports/production?limit=100` with `dateFrom` and `dateTo` null, returning the unbounded 52-row report. | Browser actions `DV2-REP-001-20260822173241485-DV2-REP-001-drain-00011`, `DV2-REP-001-20260822173251386-DV2-REP-001-drain-00012`, and `DV2-REP-001-20260822173405712-DV2-REP-001-drain-00013`; API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-001-date-filter.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-001.json`. | Report filter correctness and date-bounded auditability | Frontend Packing Reports filter owner |
| `DV2-DEF-019` | S2 | `DV2-REP-004` | The Exceptions report omits quality-hold units and variance events from its exception coverage. | In authenticated iab on `/app/reports`, open Packing Reports and select Exceptions. | Quality holds, variance, returns, damage, write-offs, repacking, label-pending, and other exceptional events should be represented once. | The report returns 55 rows from the defined packing and Dispatch exception event sets, while the same isolated QA database contains 6 QUALITY_HOLD units and 48 UNIT_SEALED variance events that are not represented. | Browser action `DV2-REP-004-20260822173900318-DV2-REP-004-drain-00016`; API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-REP-004.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-REP-004.json`. | Exception visibility and audit completeness | Backend Packing Reports exception aggregation owner |
| `DV2-DEF-020` | S2 | `DV2-LIN-003` | Barcode lineage crashes on the reversal-event source instead of rendering append-only reversal history. | In authenticated iab Barcode History, enter `RHO-10623-C001` and submit Trace barcode. | The authoritative lineage lookup should return a bounded tree containing the reversal event with its reason and actor. | The endpoint returns HTTP 500 `packing_lineage_failed` with `Maximum call stack size exceeded`; direct DB proof confirms the underlying `DISPATCH_EVENT_REVERSED` row exists for `DC/26-27/154`. | Browser action `DV2-LIN-003-20260822175126124-DV2-LIN-003-drain-00031`; API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-003.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-003.json`. | Reversal lineage visibility and bounded traversal | Backend packing lineage traversal owner |
| `DV2-DEF-021` | S2 | `DV2-LIN-005` | The bounded lineage traversal throws instead of returning an honest truncation marker. | Invoke the authoritative lineage service for `PKU-PB-20260822-0003-L1-U0001` with `maxNodes:40`. | Reaching the node budget should return a bounded tree with explicit truncation metadata and stable flattened output. | The traversal raises `TypeError: Cannot read properties of undefined (reading length)` when `addChild` receives a truncation marker without `children`; exact and unknown UI lookups otherwise remain stable. | Browser actions `DV2-LIN-005-20260822175413332-DV2-LIN-005-drain-00035` and `DV2-LIN-005-20260822175443608-DV2-LIN-005-drain-00037`; API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-LIN-005.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-LIN-005.json`. | Bounded lineage response integrity | Backend packing lineage traversal owner |
| `DV2-DEF-022` | S2 | `DV2-NOTIFY-001`, `DV2-NOTIFY-002` | Packing notification event formatters are not wired to delivery or replay handling. | Inspect the isolated NotificationDeliveryLog after run-scoped completion, short-close, quality/variance, damage/write-off, reconciliation, and idempotency workflows. | Each required batch/exception event should create exactly one isolated delivery record, and replay should not create a second. | The formatter contract exposes the seven event names, but NotificationDeliveryLog contains zero `packing_%` rows; 46 relevant idempotency audit keys are unique, yet no first or replay notification exists. | API/DB `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-NOTIFY-001.json`, `.../db/QP-06-DV2-NOTIFY-001.json`, `.../api/QP-06-DV2-NOTIFY-002.json`, and `.../db/QP-06-DV2-NOTIFY-002.json`. | Packing notification delivery and replay integrity | Backend packing notification integration owner |
| `DV2-DEF-023` | S2 | `DV2-SCAN-001` | Shared scanner legacy-prefix lookup crashes on a valid `RHO-` barcode. | In authenticated iab Reports Barcode History, use the visible Scanner Manual fallback to search `PKU-PB-20260822-0008-L1-U0002`, then search legacy `RHO-10455-C001`. | The scanner should route both the current `PKU-` barcode and legacy prefixes to the authoritative bounded lookup. | The PKU- lookup returns HTTP 200 with `found=true` and 104 nodes, but the valid non-deleted Holo Receive `RHO-10455-C001` lookup returns HTTP 500 `packing_lineage_failed` with `Maximum call stack size exceeded`; no legacy result renders. | Browser actions `DV2-SCAN-001-20260822180036013-DV2-SCAN-001-drain-00043` and `DV2-SCAN-001-20260822180110532-DV2-SCAN-001-drain-00045`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/QP-06-DV2-SCAN-001-pku-result.png` and `.../QP-06-DV2-SCAN-001-legacy-result.png`; API `qa-evidence/DV2-20260821T123729Z/api/QP-06-DV2-SCAN-001.json`; DB `qa-evidence/DV2-20260821T123729Z/db/QP-06-DV2-SCAN-001.json`. | Legacy barcode compatibility and scanner lookup trust | Backend packing lineage traversal owner |
| `DV2-DEF-024` | S2 | `DV2-NFR-003` | Dispatch PDF and CSV exports drop required trailing zeros from three-decimal weights. | In authenticated iab Reports, inspect a completed 1.250 kg production row; in Dispatch history search `DC/26-27/145`, open Details, click Download PDF, and retrieve the filtered CSV export. | The exact DB/API/UI/PDF/CSV weight should preserve the three-decimal `1.250` representation with no numeric drift. | The isolated DB and DispatchLine preserve `1.250`, and UI detail formats `1.250 kg`, but the authoritative PDF and CSV both emit `1.25` for both exact 1.250 kg lines. Numeric conservation remains equal, but the fixed three-decimal cross-surface contract fails. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-003-decimal.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-NFR-003.json`; Browser actions `DV2-NFR-003-20260822183312981-DV2-NFR-003-drain-00010` through `DV2-NFR-003-20260822183446113-DV2-NFR-003-drain-00015`; rendered PDF `qa-evidence/DV2-20260821T123729Z/pdf-render/QP-07-DV2-NFR-003-DC_26-27_145-1.png`; CSV `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-003-DC_26-27_145.csv`. | Decimal/document/export trust | Backend PDF/CSV serialization owner |
| `DV2-DEF-025` | S2 | `DV2-NFR-005` | Critical Settings controls are focusable but native keyboard activation does not perform the visible action. | In authenticated iab Settings, open an inline Edit form, focus Cancel, and press Enter or Space; then focus the Package types tab and press Enter. | Keyboard activation should close the form and activate the selected tab just as a visible click does, while retaining visible focus and stable roles. | Cancel remains open after both Enter and Space, and Package types remains unselected after Enter. A visible click closes the form, and Reports Barcode History does accept an Enter lookup and shows `No data found`, so the regression is specific to critical Settings keyboard controls. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-NFR-005-accessibility.json`; Browser actions `DV2-NFR-005-20260822184622993-DV2-NFR-005-drain-00040`, `DV2-NFR-005-20260822184700839-DV2-NFR-005-drain-00042`, `DV2-NFR-005-20260822184836433-DV2-NFR-005-drain-00049`, and visible restoration `DV2-NFR-005-20260822184844775-DV2-NFR-005-drain-00050`; screenshots under `qa-evidence/DV2-20260821T123729Z/screenshots/QP-07-DV2-NFR-005-*.png`. | Keyboard access to Packing Settings | Frontend Settings accessibility owner |
| `DV2-DEF-026` | S2 | `DV2-REG-006` | Legacy RHO barcode history lookup fails in the visible Reports scanner despite the source row remaining valid. | In authenticated iab `/app/reports`, select Scanner, choose Manual, submit current `PKU-PB-20260822-0008-L1-U0002`, then submit valid legacy `RHO-10455-C001`. | Existing current and legacy barcodes should both resolve to bounded authoritative history with unchanged audit lineage. | PKU visibly resolves to the 104-node current lineage, but the valid non-deleted RHO lookup settles to `No records found`; the authoritative legacy endpoint returns HTTP 500 `packing_lineage_failed` with `Maximum call stack size exceeded`. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-006.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-006.json`; Browser actions `DV2-REG-006-20260822204846987-DV2-REG-006-drain-00007`, `DV2-REG-006-20260822204905128-DV2-REG-006-drain-00008`, `DV2-REG-006-20260822204930870-DV2-REG-006-drain-00010`, and `DV2-REG-006-20260822204946368-DV2-REG-006-drain-00011`; screenshots `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-REG-006-pku-settled-result.png` and `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-REG-006-rho-settled-result.png`. | Historical barcode compatibility and audit lineage | Backend packing lineage traversal owner |

| `DV2-DEF-027` | S1 | `DV2-CUT-004` | Supported reversePackingCutover fails before append-only reversal because its linked-opening-batch SQL compares the InventoryAdjustmentKind enum to text. | In exact isolated QA, apply DRAFT LEGACY_CUTOVER `cmt4j6e1o02c7vzj609c5xefr` to `CUTOVER_APPLIED`, then run `reversePackingCutover.mjs --batch-id cmt4j6e1o02c7vzj609c5xefr --idempotency-key QA-DV2-DV2-20260821T123729Z-QP07-CUT004-REVERSE-001`. | Supported reversal should append a reversal batch/line, restore availability, and transition launch coherently to `REVERSED` while retaining diagnostics. | The command returns Prisma P2010 / PostgreSQL 42883 `operator does not exist: InventoryAdjustmentKind = text`, transitions the singleton to `FAILED`, leaves the original batch APPLIED, and does not append the required reversal. A separate exact-QA service cleanup restored the database and runtime after evidence capture. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-004.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-004.json`. | Cutover recovery and availability restoration | Backend cutover reversal owner |
| `DV2-DEF-028` | S1 | `DV2-CUT-005` | Activation evidence validation is preempted by the same linked-opening-batch enum comparison error, so omitted evidence does not receive the required stable diagnostic. | In exact isolated QA with an APPLIED LEGACY_CUTOVER and marker-owned APPLIED OPENING_BALANCE header, run `packingCutover.mjs activate` with `step10.complete=false` and missing evidence sections. | Each omitted or falsified evidence section should block activation with a precise `step10_evidence_incomplete` or `activation_evidence_incomplete` diagnostic while preserving the gated state. | The command returns Prisma P2010 / PostgreSQL 42883 `operator does not exist: InventoryAdjustmentKind = text` before it evaluates the incomplete evidence, so the activation contract is not reached. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-005.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-005.json`. | Activation safety and operator diagnostics | Backend cutover activation owner |
| `DV2-DEF-029` | S2 | `DV2-REG-004` | Legacy Coning Stock UI times out while the direct coning stock endpoint eventually returns 200. | In authenticated iab as retained admin, select Coning (Cones), open `/app/stock`, and wait for the list request to settle. | Existing Coning Stock should render the valid stock list within the visible workflow timeout. | The visible list settles to `Request timed out — check connection`, while direct `GET /api/v2/stock/coning/lots` returned 200 after approximately 18.5 seconds; re-Coning and Box Transfer remained visibly executable. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-REG-004.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-REG-004.json`; Browser actions `DV2-REG-004-20260822191835775-DV2-REG-004-drain-00005`, `DV2-REG-004-20260822192912804-DV2-REG-004-drain-00015`, and `DV2-REG-004-20260822193405615-DV2-REG-004-drain-00020`; screenshot `qa-evidence/DV2-20260821T123729Z/screenshots/DV2-REG-004-admin-coning-stock-timeout.png`. | Legacy Coning Stock regression availability | Backend Coning Stock query/timeout owner |
| `DV2-DEF-030` | S1 | `DV2-CUT-011` | Fresh-copy cutover cannot complete opening import, activation, or append-only reversal because the linked-opening-batch SQL compares the `InventoryAdjustmentKind` enum to text. | Restore the authorized exact dump into `glintex_dispatch_v2_qa_20260821t123729z_cut011_rehearsal`, apply the fresh-copy `LEGACY_CUTOVER`, then run `importPackingOpeningBalance.mjs`, `packingCutover.mjs activate`, and `reversePackingCutover.mjs` with the recorded marker keys. | The isolated rehearsal should import verified opening balances, validate step-10 evidence, transition to ACTIVE, and provide a safe append-only reversal path on failure. | All three supported commands return Prisma P2010/PostgreSQL 42883 `operator does not exist: InventoryAdjustmentKind = text`; no opening batch is created, ACTIVE is not reached, and no reversal batch is appended. The temporary database was dropped only after evidence persistence and absence proof. | `qa-evidence/DV2-20260821T123729Z/api/QP-07-DV2-CUT-011-rehearsal.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-07-DV2-CUT-011-rehearsal.json`. | Fresh-copy cutover safety, activation, and rollback | Backend cutover linked-opening query owner |
| `DV2-QA-DEF-001` | S2 | `DV2-CLOSE-002` | The canonical fixture ledger was not completed for the run-scoped created and mutated rows. | Inspect Section 6.5 after all QP-00 through QP-07 activity, then compare it with the run-scoped marker search and fixture snapshots. | Every QA-created or QA-mutated row should have one ledger entry with initial state, current state, event lineage, and cleanup/retention disposition. | Section 6.5 still contains only `NONE_YET`; snapshots and marker hits identify many exact fixture rows but do not form the required one-row-per-fixture ledger. | `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-002-fixture-reconciliation.json`; `qa-evidence/DV2-20260821T123729Z/db/QP-04-pre-mutation-fixtures.json`; `qa-evidence/DV2-20260821T123729Z/api/QP-04-DV2-PACKDSP-remaining-fixtures.json`. | Closure auditability and safe fixture retention | QA evidence owner |

Severity guide:

- `S0`: data loss/corruption, security bypass, production safety boundary failure.
- `S1`: core inventory conservation, double Dispatch, cutover, payment, or unusable primary workflow failure.
- `S2`: important workflow/permission/report/document/compatibility failure with a workaround.
- `S3`: minor UI, wording, low-risk edge, or evidence-quality issue.

## 26. Final reconciliation and closure

- [x] `DV2-CLOSE-001` Re-run the full orphan/duplicate/negative-balance assertion.
  - Status: `PASS`
  - Expected: zero unexplained integrity violations.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-001-integrity.json` records the live isolated-database rerun, row counts, launch state, and zero counts for every orphan, duplicate, negative-value, net-equation, and Coning-availability assertion.

- [x] `DV2-CLOSE-002` Reconcile every fixture's initial, mutated, and final state.
  - Status: `FAIL`
  - Expected: every row created or mutated by QA is listed in the fixture ledger and explainable by events.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-002-fixture-reconciliation.json` identifies the initial snapshot, current QA row counts, marker hits, fixture artifact index, and the exact Section 6.5 `NONE_YET` ledger gap.
  - Defect: `DV2-QA-DEF-001`
  - Reproduction: Inspect Section 6.5 after the run-scoped QA activity and compare it with the marker-owned fixture snapshots. The canonical table still has only `NONE_YET`, so not every created or mutated row has a single initial/current/event/cleanup ledger entry.

- [x] `DV2-CLOSE-003` Reconcile source count and weight across Packing, Dispatch, adjustments, returns, damage, write-off, and repacking.
  - Status: `FAIL`
  - Expected: all conservation equations close to exact count and three-decimal weight tolerance defined by implementation.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-003-conservation.json` records zero stored source-equation and batch-completion mismatches, exact damage/write-off event counts, four split payloads without a numeric before quantity, Dispatch event totals, and the non-zero active RCO-021-C001 adjustment delta.
  - Defect: `DV2-DEF-017`
  - Reproduction: Reconcile all applied adjustment lines for `RCO-021-C001` after QP-05 and QP-07. The distinct-key second reversal remains applied as `IAB-20260822-0007`, leaving +2 count/+0.200 kg active adjustment delta; four damage/repack split payloads also lack a numeric before quantity for a global closure proof.

- [x] `DV2-CLOSE-004` Reconcile idempotency and concurrency probes.
  - Status: `FAIL`
  - Expected: no probe caused duplicate rows/events/barcodes/counters or lost updates.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-004-idempotency-concurrency.json` reconciles global duplicate groups, successful Dispatch replay, Dispatch concurrency, packing reservation concurrency/replay, and the extra applied adjustment reversal.
  - Defect: `DV2-DEF-017`
  - Reproduction: Submit a distinct-key reverse request for the already-applied DV2-ADJ-006 reversal. The API returns 200 and creates `IAB-20260822-0007` with a new APPLIED line instead of a stable invalid-state conflict; the packing concurrency/replay probes also recorded `500 internal_error` and a timeout without state drift.

- [x] `DV2-CLOSE-005` Confirm original local database and unrelated worktree changes are preserved.
  - Status: `PASS`
  - Expected: original DB fingerprint/counts and unrelated files are unchanged except separately recorded pre-existing/runtime changes.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-005-preservation.json` records current read-only `glintex_dev` counts matching the pre-QA baseline, the retained original dump, the unchanged protected-source check, and exact unrelated tooling/worktree changes preserved without reversal.

- [x] `DV2-CLOSE-006` Validate all evidence files are sanitized and linked.
  - Status: `PASS`
  - Expected: no secrets/cookies/tokens; all paths exist; screenshots/PDFs/CSV/logs/SQL outputs open successfully; Browser recording manifests and frames are ordered and complete; every MP4 opens, has verified H.264 metadata, SHA-256, and a rendered sample frame; all recording gaps or multi-tab segments are explicitly indexed.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-006-evidence-integrity.json` records zero literal credential-value matches, zero missing Browser screenshots, successful typed-output checks, 77 playable H.264 replays with SHA-256 and rendered samples, 17 explicitly resolved capture gaps, and the two retired zero-frame recovery attempts.

- [x] `DV2-CLOSE-007` Calculate final test totals and update Section 4.
  - Status: `PASS`
  - Expected: totals equal the number of test IDs and no applicable case is nonterminal.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-007-final-totals.json` records the exact per-packet and all-249-ID status reconciliation used to update Section 4.

- [x] `DV2-CLOSE-008` Write the final QA verdict below.
  - Status: `PASS`
  - Expected: verdict distinguishes tested/passed behavior, known failures, blocked/unverified boundaries, and release risk.
  - Evidence: `qa-evidence/DV2-20260821T123729Z/artifacts/QP-08-DV2-CLOSE-008-final-verdict.json` records the terminal 249-test coverage calculation, 31-defect severity inventory, unchanged source baseline, preserved original database, complete replay index, and truthful NO-GO release recommendation.

### Final QA verdict

| Field | Final value |
|---|---|
| Verdict | `NO-GO` |
| Source tested | `main@ff1c04cd304e42da984b38f291ed6835b594fd05`; protected baseline unchanged |
| QA database | `glintex_dispatch_v2_qa_20260821t123729z`; marker `QA-DV2-DV2-20260821T123729Z` |
| Coverage summary | `249 total; 152 PASS, 97 FAIL, 0 BLOCKED, 0 SKIPPED, 0 NOT_RUN/IN_PROGRESS` |
| Passed | `152` |
| Failed | `97` |
| Skipped | `0` |
| Remaining blocked/not run | `0` |
| S0/S1 defects | `0 S0; 9 S1: DV2-DEF-005, DV2-DEF-007, DV2-DEF-009, DV2-DEF-010, DV2-DEF-012, DV2-DEF-017, DV2-DEF-027, DV2-DEF-028, DV2-DEF-030` |
| Release/cutover recommendation | `NO-GO` until the reproducible S1 defects and closure evidence gap `DV2-QA-DEF-001` are resolved |
| Original local DB preserved | `PASS`; read-only counts match the pre-QA baseline and the retained original dump is hashed |
| Browser recording coverage | `PASS`; 177/177 Browser-required tests represented by 731 exact action rows, 77 playable segments, 8352 frames, 928 drains, 17 resolved gaps, and zero unresolved required gaps |
| Browser replay path / index | `qa-evidence/DV2-20260821T123729Z/recording-index.json`; two zero-frame recovery attempts are explicitly retained and superseded |
| Product code modified by QA | `NO` |
| Commit/push/deploy/production writes | `NONE` |

Final narrative: `NO-GO. The run is terminal and fully evidenced with 152 PASS and 97 FAIL across all 249 IDs, with no blocked or unrun cases. Reproducible S1 failures remain in conservation, Dispatch, cutover, and primary workflows; QP-08 also records the missing canonical fixture ledger as DV2-QA-DEF-001. Source identity is unchanged, the original local database is preserved, Browser replay coverage is complete with zero unresolved required gaps, and no product or external state was modified by QA.`

## 27. Handoff checklist

- [ ] The QA file itself contains the latest status for every test.
- [ ] Evidence paths are clickable/resolvable and sanitized.
- [ ] Foreground-independent Browser replay MP4 files are playable, hashed, ordered, and linked.
- [ ] The defect register is complete and deduplicated.
- [ ] Every failure states whether later tests remain trustworthy.
- [ ] Every blocked test states exactly what unblocks it; no test remains BLOCKED.
- [ ] No product fix, commit, push, deploy, or production mutation was performed.
- [ ] The final response links this file and summarizes the verdict without overstating coverage.
