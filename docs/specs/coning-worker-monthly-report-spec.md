# Coning Worker Monthly Report Specification

Status: Draft for implementation planning. No implementation or deployment is authorized by this document.

Prepared: 2026-09-06

## 1. Purpose and source of truth

Give each worker a downloadable statement of their recorded Coning work for a selected calendar month, with quality-wise monthly totals and date-wise details. The primary audience is the worker receiving the statement; office staff use the preview and Excel export to reconcile it.

This specification is derived from the GLINTEX VPS OpenClaw conversation:

- Session ID: `b5423ad1-f92d-45ca-be66-cae4b755a60c`.
- Retrieved title: **Worker-wise monthly report download**.
- Source messages: events 1–5 establish purpose and placement; event 67 summarizes the investigation; event 68 explicitly limits this release to Coning; event 69 proposes the revised Coning design.
- Supporting analysis: `/var/lib/openclaw/workspace/reports/worker-monthly-report-analysis-2026-09-06.md` on the VPS, based on production revision `ad8e29750a52b93d556f36e137bb38945696bbc4`.
- Local source cross-check: revision `984d936db801c73080c6b0e06434f7fb3c653f33`, including report navigation, permission guards, Coning models, and contractor lineage helpers.

The final Coning-only request supersedes earlier suggestions for multi-process reports and helper sections. Product details below that were not explicitly decided in the conversation are identified as proposed defaults. Historical database findings are evidence from the source investigation, not a new database audit or permanent acceptance counts.

## 2. Scope

### Required for the first version

- Add **Worker Monthly Report** within Reports & Analytics, beside Barcode History and Production Report.
- Enable Coning. Display Cutter and Holo as **Coming soon** and prevent selection or export for them.
- Offer month/year and one-worker/all-workers selection.
- Provide preview, PDF download, and Excel download.
- Give each worker a separate statement, titled **Coning — Monthly Work Statement**.
- Show monthly quality summaries, chronological work details, daily subtotals, and monthly cones/net-kg totals.
- Preserve work identity, worker privacy, and output reconciliation through every format.
- Provide office-only exceptions and detailed references for reconciliation.

### Out of scope

- Cutter/Holo statements and All Processes selection.
- Helper statements or allocation of operator production to helpers.
- Wages, rates, payments, settlement ownership, attendance, hours, efficiency, or inferred wastage.
- Automated WhatsApp, Telegram, or email sending.
- Production corrections, retrospective worker assignment, or guessed quality allocations.
- Immutable issued-statement storage, approval workflows, and a new reporting platform.

## 3. Navigation and interaction

1. Open Reports & Analytics → Worker Monthly Report.
2. Select the month and year. Coning is the enabled process.
3. Select one worker or All Workers.
4. Load the statement preview and review any office-only exceptions.
5. Download the selected statement(s) as PDF or Excel.

Proposed defaults:

- Default to the previous complete calendar month. Label the current month **Month to date**, including its effective cutoff; reject future months.
- Use addressable tab/filter state so the report can be linked and restored without altering existing report tabs.
- Populate workers from qualifying historical Coning receive records for the selected period, including workers no longer assigned to Coning. Identify selections by worker ID, with an office-visible distinguishing identifier for duplicate names.
- In All Workers mode, preview one worker at a time or use clearly separated worker sections. Never present a combined worker-facing statement.
- Default to dates with work recorded. If empty dates are later offered, label them **No work recorded**, never **Absent**.
- Show distinct loading, empty, failed, and unsupported-process states. A failed request must not appear as a zero-work month.
- Changes to filters invalidate the old preview. Downloads must correspond to the selected filters and identify their generation time.

## 4. Statement layout

### Header

Company name, worker name, selected month/year, process, generation timestamp, and month-to-date label when applicable. Office selection uses stable IDs; include a short worker reference where necessary to distinguish duplicate names.

### Monthly quality summary

| Field | Meaning |
|---|---|
| Item / quality | Item identity with side preserved where relevant |
| Yarn | Recorded/resolved yarn |
| Cut | Trace-first cut, with explicit unresolved/mixed status |
| Twist | Recorded/resolved twist |
| Cone details | Cone type and target cone size where recorded |
| Total cones | Sum of received physical cone counts |
| Net kg | Sum of resolved received net weight |

Keep different cone types and target sizes separate. Missing values must not make unrelated qualities collapse into a known-quality group.

### Date-wise ledger

| Date | Item / quality details | Machine | Cones | Net kg |
|---|---|---|---:|---:|
| Work date | Item, side, yarn, cut, twist and cone details | Recorded machine | Physical output | Received net kg |

Use a vertical ledger with multiple lines per day, not a wide calendar with one column per item. Sort chronologically, with stable ordering within each date. End each date with a subtotal and end the statement with monthly cones and net-kg totals.

Detailed office preview/Excel data must retain receive-row ID, issue ID, lot and available barcode references, resolved quality provenance, and data-quality flags. Keep the worker PDF compact; internal exception diagnostics and other workers' data do not belong in it.

## 5. Authoritative data rules

### 5.1 Accounting unit and attribution

- The accounting unit is one `ReceiveFromConingMachineRow.id`.
- Attribute its work to receive-row `operatorId`, not issue `operatorId`, name matching, contractor, or current master process assignment.
- Group workers by `Operator.id`. Duplicate display names remain distinct workers.
- A missing/unresolvable receive worker belongs in office exceptions and must not be assigned to the issue operator automatically.
- Do not credit `helperId` as an additional output. Helpers are outside this release even if newly populated records appear.

### 5.2 Dates and eligible production

- Filter by receive-row `date`, interpreted as the application's business calendar date. Use the inclusive first day through exclusive first day of the next month; handle leap years and year changes.
- Do not filter by `createdAt`, issue date, dispatch date, or record update date.
- Include output received during the selected month even when issued in a prior month or dispatched afterward. Later dispatch does not reduce work performed.
- Exclude soft-deleted receive rows and Coning opening-stock/non-production stock rows using stage-aware classification.
- Production performed in Coning using purchased or opening upstream inputs remains eligible. Do not exclude it merely because its input originated as purchased/opening stock.
- Proposed exception default: an active output linked to a deleted issue is held in office exceptions pending review, rather than silently treated as ordinary work.
- Missing/invalid work dates are office exceptions, never silently replaced. Undated rows must be shown as unassigned-period exceptions, not counted against an arbitrary selected month.

### 5.3 Quality and lineage

- Preserve item/side, yarn, cut, twist, cone type, and target cone size wherever available.
- Trace Cut through Coning issue → `receivedRowRefs` → Holo receive rows → Holo issue, following Cutter lineage or re-coning as necessary. Use receive `sourceRowRefs` to narrow actual consumed sources where reliably recorded.
- Fall back to `IssueToConingMachine.cutId` only when upstream trace data is unavailable. A conflicting or partially resolved trace is not permission to replace it with the issue cut.
- Handle re-coning, missing sources, cycles, and multiple sources with bounded, cached traversal.
- Keep a normalized output row intact while tracing sources. Eleven source references do not create eleven copies of its cones or weight.
- Do not infer an output allocation from input weight ratios. Unless explicit output allocations exist and reconcile, use a deterministic mixed/unresolved quality description and preserve the single output total.
- Use IDs and normalized dimension values for grouping, with names as display labels. Preserve distinct missing, mixed, and resolved states and enough provenance to avoid merging unrelated unresolved groups.

### 5.4 Quantities and totals

- Cones come from receive `coneCount`, not receive-row count, `expectedCones`, or remaining stock.
- Prefer recorded `netWeight`. Legacy fallback may use `coneWeight`, then `grossWeight - tareWeight`, only after verifying their meaning against the relevant writer paths. Record which fallback was used.
- Preserve explicit zero values; do not reuse payment helpers' positive-only filtering as the work-statement inclusion policy.
- Proposed default: negative/non-finite quantities are exceptions. Missing unresolved weight remains unknown, not zero; retain a valid cone count and clearly mark the net-kg total as incomplete where applicable.
- Display cones as whole counts and kg to three decimals. Normalize weight consistently once, then use the same values for daily, quality, monthly, preview, PDF, and Excel totals.
- For each worker, daily totals and quality totals must independently reconcile to the same monthly totals. Across workers, deduplicated eligible rows must reconcile to office totals, with excluded/exception quantities accounted for separately.

## 6. Export behavior

PDF is the primary worker deliverable. It must print legibly on A4, wrap long quality names, repeat table headings over page breaks, display units, and avoid clipped columns or orphaned subtotals. Verify the chosen font against actual worker and quality labels.

Proposed packaging defaults:

- One worker: one PDF and one Excel workbook.
- All Workers: ZIP containing one PDF per worker; Excel ZIP containing one workbook per worker, preserving privacy when files are handed out individually.
- Workbook tabs: Summary and Daily Details, plus detailed references for office reconciliation. Numeric quantities remain numeric cells.
- Use sanitized filenames containing process, month, and a stable worker discriminator; prevent duplicate-name collisions.
- A combined print PDF is optional future convenience and is not required for this first release.

All formats must use one normalization/aggregation service. Preview pagination must not truncate exports or summary totals. Each export must operate over a consistent set of source rows. Separate requests may reflect intervening edits; disclose generation timestamps and refresh the preview when appropriate. Immutable snapshots are outside scope.

## 7. Implementation contract

Reuse the existing Reports page and backend `requirePermission('reports', PERM_READ)` policy on every worker-list, preview, detail, exception, and download endpoint. Do not introduce unauthenticated export links or broaden permissions.

Proposed endpoint organization, subject to repository conventions:

- A Coning worker-monthly-report read service accepting a validated `YYYY-MM`, process `coning`, and worker ID or explicit all-workers selector.
- Thin routes for eligible worker options, paginated preview/details, and PDF/Excel downloads.
- Reject unsupported processes server-side as well as disabling them in the UI.
- Return period/cutoff, generation time, stable worker IDs, normalized detail rows, quality/daily/monthly totals, and office exceptions. Keep diagnostics separate from worker-facing export payloads.

Suggested source boundaries:

| Existing source | Reuse or caution |
|---|---|
| `apps/frontend/src/pages/Reports.jsx` | Add tab and filters; retain existing tabs and mobile behavior |
| `apps/backend/prisma/schema.prisma` | Existing receive, operator and issue models support the initial read-only feature |
| `apps/backend/src/routes/index.js` | Follow existing reports permission guards |
| `apps/backend/src/services/contractorPayments/service.js` | Review trace-first Cut, cone details, and re-coning helpers; do not inherit payment semantics |
| `apps/backend/src/services/contractorPayments/calc.js` | Review opening-stock classification and weight resolution; avoid positive-only filtering |
| `apps/backend/src/utils/pdf/productionDailyExportData.js` | Review normalization and trace-cache patterns |
| `apps/backend/src/utils/productionDailyExport.js` | Reuse bounded concurrency/date ideas; existing seven-day export cannot simply become monthly |

No new business table is expected. Batch reads and lineage resolution rather than issuing a query per output row. Measure query plans, duration, memory, and all-worker export behavior before deciding whether date/operator indexes or asynchronous generation are necessary. Do not silently truncate large results. Existing PDF, XLSX, and ZIP dependencies should be sufficient; confirm font/table support during implementation.

## 8. Acceptance criteria

| ID | Scenario and required result |
|---|---|
| AC-01 | Worker Monthly Report opens beside existing reports; Coning works; Cutter/Holo show Coming soon; unsupported API requests fail clearly *P1 backend independently verified: unsupported-process rejection on four read endpoints ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); report UI remains pending.* *P3 locally independently verified: report tab, Coning, disabled Coming soon options, existing tabs and scanner navigation pass in the source-guarded fixture UI ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-02 | Previous complete month is the default; leap February, December/January and exact month boundaries include only intended work dates *P1 backend independently verified: service default, leap/year transitions and month boundaries in synthetic tests ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); UI default remains pending.* *P3 locally independently verified: UI previous-complete-month default and leap/year/future validation pass ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-03 | Backdated receives and prior-month issues are included by receive date, regardless of creation or dispatch date *P1 backend independently verified: receive-date attribution in synthetic fixtures ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); UI/export verification remains pending.* |
| AC-04 | Receive operator overrides issue operator; duplicate names and inactive/historically reassigned workers remain distinct and selectable *P1 backend independently verified: receive-operator attribution, stable IDs and historical-worker selection data ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); UI selection remains pending.* *P3 locally independently verified: actual browser selections distinguish historical duplicate-name workers by stable ID ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-05 | Missing worker/date and invalid quantities appear in office exceptions; no guessed worker/date or silent zero replacement *P1 backend independently verified: exception and unknown-quantity data, including undated hydration ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); office UI/export presentation remains pending.* *P3 locally independently verified: fixture office exceptions/references and explicit incomplete known-weight subtotals pass; no production exception audit ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-06 | Deleted rows and Coning opening stock are excluded; genuine Coning production on purchased/opening inputs is included *P1 backend independently verified: stage-aware exclusions and eligible upstream opening/purchased inputs in fixtures ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); UI/export verification remains pending.* |
| AC-07 | Multiple source refs and re-coning count each output once; cycles terminate; partial/mixed traces are visible without false allocation or direct-cut override *P1 backend independently verified: deduplication and bounded conservative lineage, including 1,101-source batching ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); UI/export trace presentation remains pending.* |
| AC-08 | Item/side, yarn, cut, twist, cone type and target-size differences remain separate; long descriptions remain readable *P1 backend independently verified: normalized quality grouping only ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); rendered readability remains pending.* *P2 local exports independently verified: rendered long quality descriptions and the 287-label local ASCII font sample are readable; production-label coverage remains unverified ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: desktop and 390px quality labels and long-label wrapping pass; production font coverage remains unverified ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-09 | Physical cones and kg reconcile across detail, daily, quality and monthly totals; zero/missing/legacy weight cases follow the defined policy *P1 backend independently verified: normalized detail/daily/quality/month totals and quantity policy in fixtures ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); cross-format reconciliation remains pending.* *P2 local exports independently verified: PDF/XLSX detail, daily, quality and monthly totals reconcile with shared normalization across 1,872 rows, 18,720 cones and 2,310.685 kg ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: preview and seven browser-saved files reconcile 126 archive rows, 1,260 cones, 153.140 known kg and one unknown; historical archives independently reconcile 1,428 rows, 132,245 cones and 19,803.934 kg ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-10 | One-worker exports contain only that worker; bulk archives contain separate collision-free files; helpers are not credited as extra production *P1 backend independently verified: helper exclusion and worker-only data projection ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); export files and bulk archives remain pending.* *P2 local exports independently verified: 26 private worker PDFs and 26 private workbooks, with separate collision-safe archive entries ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: separated worker previews and private one-worker/all-worker browser exports pass ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-11 | Multi-page PDF renders correctly, workbook cells preserve numeric types, and exports reconcile with the same normalized preview data *P2 local exports independently verified: 416 PDF pages checked, sampled rendered pages legible, workbooks independently opened/parsed with numeric cells and reconciled to normalized data; desktop Excel GUI and browser preview remain pending ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: actual one-worker/all-worker PDF/XLSX browser downloads, independent parsing, numeric workbook cells and normalized-preview reconciliation pass; desktop Excel GUI remains untested ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-12 | Report permission is enforced on every endpoint and download; loading/errors/empty results are distinguishable; preview pagination does not truncate totals *P1 backend independently verified: permissions on four read endpoints and pagination preserving full totals ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); downloads and UI states remain pending.* *P2 local exports independently verified: download authorization, unsupported-process rejection and complete export despite preview pagination pass; UI loading/error/empty states remain pending ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: browser loading/empty/failure/unsupported/race states, full pagination summaries and all six endpoints' 401/403 guards pass with synthetic sessions ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-13 | Current month is marked Month to date; regenerated exports identify generation time and do not claim immutable historical accuracy *P1 backend independently verified: current-month cutoff and generation metadata ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); UI/export labeling remains pending.* *P2 local exports independently verified: Month to date, cutoff, generation time and mutable-source disclosure appear in exports; UI labeling remains pending ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: Month to date cutoff, regenerated-read disclosure, all four download filenames and exact generation timestamps pass in credentialed split-origin browser tests ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |
| AC-14 | Representative full-month/all-worker data is measured without truncation or unbounded lineage work; narrow mobile preview remains usable *P1 backend independently verified: synthetic 26,000-row/26-worker benchmark, ten reads, 331 ms, 74 MiB heap growth, 185 MiB RSS, with batched lineage ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE.md)); live database/history cost, exports and mobile remain pending.* *P2 local exports independently verified: synthetic all-worker PDF ZIP 5,651 ms and XLSX ZIP 3,127 ms, 162 MiB RSS, within the 30-second per-format budget with no truncation; live database cost and mobile remain pending ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P2.md)).* *P3 locally independently verified: 390px usability and read-only historical July profile pass: 1,428 eligible rows/16 workers, source 240 ms, PDF ZIP 210 ms, XLSX ZIP 127 ms, 250 MiB RSS, within 5,000/30,000 ms and 512 MiB budgets. Profile omits only unused missing Holo isWastage; exact current-schema local DB and production runtime, deployment and user acceptance remain unverified ([evidence](../../apps/backend/src/services/workerMonthlyReport/EVIDENCE-P3.md)).* |

Use synthetic fixtures for edge cases and integration tests for authorization and service reconciliation. Visually inspect a real rendered PDF and open an exported workbook; successful generation alone does not prove export usability. Production data must not be changed to manufacture test cases.

## 9. Evidence, assumptions and remaining decisions

The source investigation reported 1,871 active August 2026 Coning receive rows before exclusions, 26 operator IDs, no missing receive operator IDs, and 20 opening-stock exclusions. It observed up to 29 preliminary monthly quality groups per worker, 12 daily groups, and 11 source references per Coning issue. Those observations motivate the vertical layout and deduplication rules; they are not fixed test expectations. Older Coning data had missing workers and source references.

The latest conversation accepted the Coning-only scope, but did not settle every export or exception detail. Proposed defaults in this document make the draft concrete and remain reviewable. Before implementation finalization:

1. Confirm net-weight fallback semantics against receive creation/edit/import paths, including explicit zero and null handling.
2. Confirm the complete quality key and cone type/target-size derivation, especially mixed sources and side representation.
3. Adopt or revise the proposed per-worker ZIP packaging and office exception behavior.
4. Confirm business-date/current-month cutoff conventions against existing app behavior and test data.
5. Set measurable performance budgets after a representative benchmark; do not assume an index migration is required.

This task recovered the requested conversation and its analysis and cross-checked relevant local source. It did not implement the report, run a fresh production database profile, restart services, send worker statements, commit, push, or deploy.
