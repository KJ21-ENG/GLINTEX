# P1 local evidence: Coning worker monthly report

Run: glintex-coning-monthly-20260906. Mode: thread-calling ONLY. Package: P1.
Executor native task: 01a077b2-1cd3-7473-b22b-d3f2221bcbdf.
Root: /Volumes/MacSSD/Development/CursorAI_Project/GLINTEX.
Ledger: .agent/sessions/20260906T170927Z-codex-718042711db0.json.
Capsule: 20260906T171037Z-coning-monthly-report-p1-service-api.

Backend-only evidence for shared UI/export criteria. No spec markers changed.

| Spec reference | Expected behavior | Implementation location | Validation evidence | Status |
|---|---|---|---|---|
| 1 §3 / AC-02,13 | Validate month/coning/worker-or-all, previous month, future rejection, current cutoff/generation | filters.js validateFilters | service.test.js calendar validation and boundary tests | PASS backend |
| 2 §3 / AC-04 | Historical workers by ID, duplicate names separate, no current process filter | service.js normalizeReport; repository.js operator include | receive ID/operator test includes reassigned w1 and same-name w2 | PASS |
| 3 §4 / AC-08 | Item/side/yarn/cut/twist/cone type/target size summary | service.js qualityFor and aggregate | quality IDs/target/type test; item/side/yarn/twist test; source twist test | PASS backend |
| 4 §4 / AC-09 | Chronological stable rows, recorded machine, daily/month totals | service.js detail sorting and statement aggregation | quality grouping test stable a,b,c,d,e,z; quantity reconciliation test | PASS backend |
| 5 §4 | Office IDs/issue/lot/barcodes/provenance/flags separate from worker diagnostics | service.js office details and workerQuality/toWorkerStatement | authoritative ID test and worker projection test | PASS backend |
| 6 §5.1 / AC-04,10 | Receive ID accounting and operator authoritative, no helper credit | service.js seen set and operator resolution | duplicate row/helper/issue-operator/dispatch synthetic fixture | PASS backend |
| 7 §5.1 / AC-05 | Missing or unresolvable operator exception without guesses | service.js exception reasons | stage-aware exception test covers missing/unresolvable operators | PASS |
| 8 §5.2 / AC-02,03 | Receive business date half-open month; leap/year/backdate/prior issue/later dispatch | filters.js; repository.js period query; service.js validDate filter | calendar/boundary and receive-authority tests | PASS |
| 9 §5.2 / AC-06 | Deleted receive and own-stage opening excluded; upstream OP/CP eligible | service.js openingReason | deleted/opening/bulk/OP-input/CP-input test | PASS |
| 10 §5.2 / AC-05 | Deleted issue exception; invalid dates unassigned period | repository.js slim date audit; service.js exception split | exception test plus null/garbage/February-30 test | PASS |
| 11 §5.3 / AC-07 | Trace-first cut, reliable receive refs, Cutter/reconing; fallback only unavailable | lineage.js sourceSelection/createCutResolver | mixed/partial/narrowing and reconing/Cutter tests; cycle 1 missing-ID regression | PASS |
| 12 §5.3 / AC-07 | Cached bounded cycle-safe traversal, output counted once | lineage.js depth 32/cache; repository.js batched graph | cycle/depth/shared-parent test; 26k benchmark with 11 sources | PASS |
| 13 §5.3 / AC-07 | No ratio allocation; mixed/partial/unresolved deterministic, no false override | lineage.js merged ID sets; service.js single detail row | mixed/partial/unreliable/deleted/malformed trace tests; missing-ID and exact metadata fallback regression | PASS |
| 14 §5.3 / AC-08 | IDs and normalized dimensions, distinct missing/mixed/resolved and unrelated unknowns | service.js dimension/quality keys | duplicate master names, missing contexts, target/type differences; cycle 1 distinct narrowed unknown yarn/twist regression | PASS backend |
| 15 §5.4 / AC-09 | coneCount/netWeight then verified coneWeight then gross-tare, explicit zero | quantities.js | quantity fallback test and writer source verification below | PASS |
| 16 §5.4 / AC-05,09 | Negative/nonfinite exceptions; unknown weight retained with incomplete total | quantities.js; service.js recordedQuantities | zero/null/negative/Infinity/fractional cone test | PASS |
| 17 §5.4 / AC-09 | Whole cones; kg normalized once to grams; all aggregations reconcile | quantities.js totals; service.js aggregate/reconciliation | row/daily/quality/month totals and excluded/exception count/quantity assertions | PASS backend |
| 18 §7 / AC-01,12 | Every workers/preview/details/exceptions route reports READ; unsupported process rejected | routes/workerMonthlyReport.js router-wide auth/permission | authorization.integration.test.js real middleware with synthetic session lookup, 401/403/200/400 all four routes | PASS backend; download guards P2 |
| 19 §6,7 / AC-12,14 | Full-source snapshot service; pagination never truncates totals; batched reads | service.js buildWorkerMonthlyReport; repository.js; focused router | 2500-row full service test; preview pageSize1 retains full totals; 26k benchmark | PASS backend; live DB plans and export behavior deferred |

## Validation

- `node --test apps/backend/src/services/workerMonthlyReport/__tests__/*.test.js`: 16/16 pass.
- `node --check apps/backend/src/routes/index.js` and focused router: pass.
- `git diff --check`: pass.
- `node apps/backend/src/services/workerMonthlyReport/__tests__/benchmark.mjs`: 26,000 rows, 26 workers, 11 source references per issue, ten synthetic reads, 315 ms, 74 MiB heap growth, 184 MiB RSS. Synthetic <5000 ms budget passed; no row-based database calls.
- Authorization integration uses actual requireAuth/requirePermission, substitutes only the Prisma session lookup, and restores it. It never connects to a database.
- No production/local DB SQL, query plans, browser/UI, PDF/XLSX/ZIP, full repository suite, or deployment validation performed. P2/P3 and independent verification remain separate.

## Source decisions and compatibility

- `routes/index.js` manual receive writer around 11018, edit around 11416, opening around 5119, and bulk opening around 6309 persist coneWeight as total net kg, matching netWeight. Import around 11687 preserves these fields independently. Use null-based precedence; never payment positive-only semantics.
- Receive manual writer stores `date || issue.date` at creation; import preserves null and edit stores selected date. Reporting uses the stored receive date only, never reconstructs it from creation/issue dates.
- Issue creation around 10888 uses target grams in expectedCones formula. Output field is explicitly targetSizeGrams. Zero default means target unrecorded.
- Bulk opening writer records own Coning issue note `Opening Stock Bulk` but omits row.createdBy. Exclude the exact own-stage opening notes as well as opening row markers. Upstream OP-/CP- prefixes never exclude Coning production.
- Source refs writer around 839 persists consumed source weights. Narrow only valid positive source refs belonging to the issue whose sum reconciles to normalized output within 0.001 kg. Never split output or allocate it by ratios. Invalid narrowing conservatively resolves the union with a partial/unresolved flag.
- Direct Cut fallback is used only when no trace is available; deleted, cyclic, malformed, and partial traces do not authorize replacement. Bounded trace limit is explicit and flagged rather than truncating output rows.
- Asia/Kolkata business cutoff follows existing backend date/scheduler conventions; stored receive dates remain calendar strings.
- `buildWorkerMonthlyReport` uses one RepeatableRead transaction and no row limit. Invalid nullable/string dates require a slim complete date audit before batch hydration. This is a potential large-history cost; no unsupported migration was added.
- Worker export projection strips internal trace keys and diagnostics. Office payload retains raw quantities (nonfinite values serialized as strings), receive/issue references, and flags. Totals with missing weights are known subtotals accompanied by `weightComplete:false` and unknown counts.
- Proposed defaults adopted. No schema/dependency changes. Router mounted before global auth but authenticates itself, consistent with existing focused routers.

## Preservation and bounded diff

Baseline HEAD: 984d936db801c73080c6b0e06434f7fb3c653f33, unchanged.
Before first source write, only untracked docs/specs/. Spec SHA256 remained 8f45c5325b9f5fbd6f9312f46190f72c49a51354e43745d880dd50ef21f7dd73 after implementation.
Tracked diff: routes/index.js adds one import and one mount only. New focused router, service modules, fixtures/tests/benchmark, and this evidence packet are task-owned. No historical qa-evidence or dispatch-v2 documentation files touched. No staging/commit/push/PR/deploy/external sends or database mutation.

## Reviewer correction cycle 1

Cumulative implementation correction count: 1 of 3, owned by Reviewer.

- Missing `rowId` entries, including `{}` and valid-ref-plus-empty-object arrays, now mark lineage unreliable. Direct fallback is prevented for malformed data. Only the exact single Coning metadata object with `coneTypeId` and optional `wrapperId`, as written by opening-stock writers, is accepted without a source identity. Empty/null refs retain legitimate no-trace fallback. Mixed source-and-metadata arrays remain conservative.
- Unresolved/partial yarn and twist grouping context now includes dimension-specific trace paths. Office provenance retains actual yarn/twist traces; worker projection keeps opaque keys and no trace diagnostics. Tests prove two distinct narrowed unknown sources remain separate while equal resolved quality combines.
- Focused cycle diff: lineage.js, service.js, service.test.js, EVIDENCE.md only. No route/mount/spec change during correction.
- Validation: 16/16 synthetic service/auth tests pass; 26k rows/26 workers/11 refs benchmark 315 ms, ten reads, 74 MiB heap growth, 184 MiB RSS; `git diff --check` passes. No database or external mutation.
