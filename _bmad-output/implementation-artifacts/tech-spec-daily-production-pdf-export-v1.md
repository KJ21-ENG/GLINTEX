---
title: 'Daily Production PDF Export (V1.1)'
slug: 'daily-production-pdf-export-v1-1'
created: '2026-03-09T14:26:13+0530'
status: 'Implementation Complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'React 18.3.1 + Vite 5 SPA frontend'
  - 'Tailwind-based local UI components including Dialog/Card/Table primitives'
  - 'Express 4.18 + Prisma 4.16 + PostgreSQL backend'
  - 'jsPDF 4.x server-side PDF utilities'
  - 'archiver ZIP packaging dependency for range export packaging in apps/backend'
files_to_modify:
  - 'apps/frontend/src/pages/Reports.jsx'
  - 'apps/frontend/src/api/client.js'
  - 'apps/backend/src/routes/index.js'
  - 'apps/backend/package.json'
  - 'apps/backend/src/utils/pdf/index.js'
  - 'apps/backend/src/utils/pdf/productionDailyExportSummary.js'
  - 'apps/backend/src/utils/pdf/productionDailyExportData.js'
  - 'apps/backend/src/utils/pdf/productionDailyExportPdf.js'
  - 'apps/backend/src/utils/__tests__/productionDailyExport.test.js'
code_patterns:
  - 'ProductionReport uses local state with useEffect-triggered reloads on filter changes'
  - 'Frontend blob downloads use raw fetch with credentials: include and Content-Disposition filename parsing'
  - 'Dialog components are imported directly from components/ui/Dialog because the ui barrel does not export Dialog'
  - 'Backend report and trace logic live in the monolithic apps/backend/src/routes/index.js router'
  - 'Holo/coning lineage resolution already exists via parseRefs, resolveHoloIssueDetails, resolveConingTraceDetails, and resolveLotNoFromPieceId'
  - 'PDF generators use shared jsPDF table/footer helpers, while the daily production export now applies a compact local header and tighter spacing'
test_patterns:
  - 'No broad report test suite exists'
  - 'Targeted node:test coverage validates export request rules, summary grouping, and PDF smoke output'
  - 'Manual validation still covers browser downloads and DB-backed spot checks'
---

# Tech-Spec: Daily Production PDF Export (V1.1)

**Created:** 2026-03-09T14:26:13+0530

## Overview

### Problem Statement

The Production Report screen can display filtered production data, but it cannot export a server-generated daily production report in PDF format or package multi-day exports as a ZIP containing one PDF per date.

### Solution

Add a dedicated Daily Export flow for Production Report with separate export filters (`process`, `from`, `to`), a new frontend download helper, and a new backend endpoint that builds daily report data from raw receive rows, renders one branded PDF per day on the server, and returns either a single PDF or a ZIP depending on the selected date range. V1.1 keeps that route/interface intact while refining the PDF format so the detail table starts with `YARN` and `ITEM`, the summary groups machines by prefix, `Machine Summary`, `Item Summary`, and `Yarn Summary` tables render together beneath the detail table, the overview block is removed, and the frontend range guard counts days in UTC so it matches backend validation.

### Scope

**In Scope:**
- Add a Daily Export action near the Production Report header/filters in the frontend.
- Add an export modal in `Reports.jsx` with `process`, `from`, and `to` fields.
- Default export values from the current Production Report state when valid.
- Block export for invalid dates, invalid ranges, and `process=all`.
- Add a new frontend download helper alongside the summary PDF download flow.
- Add `GET /api/reports/production/export/daily` with `reports` read permission.
- Generate daily PDFs for `cutter`, `holo`, and `coning`.
- Return a single PDF for one date and a ZIP for a multi-day range.
- Use sample-style daily detail columns plus a simplified machine summary block.
- Refine the daily PDF format to show `YARN` then `ITEM`, remove `COLOUR`, group machine totals by prefix, and render side-by-side machine/item/yarn summary tables.
- Build export data from raw daily receive rows rather than reusing aggregated table output.
- Generate an empty-state PDF for no-data days.

**Out of Scope:**
- Weekly or helper-table exports.
- Export support for `process=all`.
- Synthetic calculations for hour, ideal, wastage, or helper-table metrics.
- Changing the existing on-screen Production Report aggregation behavior.
- Changing the public export endpoint, attachment naming, or frontend download helper contract introduced in V1.

## Context for Development

### Codebase Patterns

- `ProductionReport` in `apps/frontend/src/pages/Reports.jsx` owns its own `process`, `view`, `dateFrom`, and `dateTo` state and reloads automatically when those values change. Export state must remain separate so modal edits do not re-query the on-screen report.
- The Production Report filter card is the cleanest insertion point for the new action because it already houses the process/date controls; the table header is a secondary fallback action area.
- This page currently has no dialog implementation. Existing repo dialog usage relies on direct imports from `components/ui/Dialog`, and the shared UI barrel does not export `Dialog`.
- `apps/frontend/src/api/client.js` already contains an authenticated blob download path in `downloadSummaryPdf`, including `credentials: 'include'`, `Content-Disposition` filename parsing, blob URL creation, and DOM anchor download behavior.
- Backend report endpoints, lineage helpers, and summary builders are centralized in `apps/backend/src/routes/index.js`; new report export routing should extend that same block rather than creating a new router file.
- Existing backend logic already resolves upstream trace data:
  - holo cut fallback through cutter receive rows
  - coning cut/yarn/twist/roll-type fallback through recursive trace resolution
  - cutter lot fallback from `pieceId`
- Raw receive row schemas differ by process, so the daily export must normalize three source shapes into one PDF-ready row contract instead of reusing aggregated report rows.
- Shared PDF utilities under `apps/backend/src/utils/pdf` already provide the common table renderer, pagination handling, numeric/date formatting, and footer utilities; the daily production export can override header density locally without changing other PDFs.
- The active PDF integration path is the modular `apps/backend/src/utils/pdf/index.js` stack already imported by routes; `apps/backend/src/utils/pdfSummary.js` is legacy reference material only.
- Repo rules still apply: JavaScript only, ESM imports, workspace-scoped dependency installs, and manual verification instead of new automated tests.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/frontend/src/pages/Reports.jsx` | Production Report local state, filter card, table header, and export action/modal insertion point |
| `apps/frontend/src/api/client.js` | Existing summary PDF download helper and best place for a new production export download helper |
| `apps/frontend/src/components/ui/Dialog.jsx` | Existing modal component pattern used elsewhere in the repo |
| `apps/backend/src/routes/index.js` | Production report endpoints, trace helpers, summary builders, filename helpers, and response header patterns |
| `apps/backend/prisma/schema.prisma` | Raw receive-row and relation fields for cutter, holo, coning, operator, machine, box, bobbin, and roll type |
| `apps/backend/src/middleware/auth.js` | Permission middleware used by report routes |
| `apps/backend/src/utils/pdf/index.js` | Active modular PDF export surface already used by backend routes |
| `apps/backend/src/utils/pdf/pdfHelpers.js` | Shared PDF header, overview, table, formatting, and footer helpers |
| `apps/backend/src/utils/pdf/holoReceivePdf.js` | Example of summary receive PDF composition using shared helpers |
| `apps/backend/src/utils/pdf/coningReceivePdf.js` | Example of landscape table layout and secondary summary-block composition |
| `apps/backend/src/utils/pdfSummary.js` | Legacy PDF implementation kept only as reference, not the primary extension point |
| `apps/backend/package.json` | Backend dependency list including `archiver` for multi-day ZIP packaging |

### Technical Decisions

- V1 export remains daily-only even when a range is selected; multi-day export is delivered as a ZIP with one PDF per date.
- Export filter state is separate from the on-screen Production Report filter state, but defaults are derived from the current tab selection when valid.
- The export action will live inside `ProductionReport`, not the parent `Reports` tab shell, because the source defaults (`process`, `dateFrom`, `dateTo`) are local to that component.
- The export modal should use the existing `Dialog` / `DialogContent` component via direct import from `components/ui/Dialog`.
- `process` is limited to `cutter`, `holo`, or `coning`; `all` stays available only for the on-screen report.
- The frontend API layer should add a new production export helper alongside `downloadSummaryPdf` and internally reuse the same blob download mechanics rather than inventing a second download approach.
- The frontend export modal must count inclusive days in UTC so the 7-day UI guard matches the backend’s UTC date validation in all time zones, including DST transitions.
- Backend routing should add `GET /api/reports/production/export/daily` immediately after the existing production report endpoints and guard it with `requirePermission('reports', PERM_READ)`.
- The new endpoint must validate `process`, `from`, `to`, reject `process=all`, reject invalid ranges, and return:
  - `application/pdf` for a single date using `production_daily_<process>_<date>.pdf`
  - `application/zip` for a range using `production_daily_<process>_<from>_to_<to>.zip`
- Date strings in the export filenames must keep hyphens, so the summary helper `formatDateForFilename` should not be reused for export attachment names.
- Daily export data must be built from raw receive rows:
  - `ReceiveFromCutterMachineRow`
  - `ReceiveFromHoloMachineRow`
  - `ReceiveFromConingMachineRow`
- Create a dedicated builder module under backend PDF utilities to:
  - query raw rows for one process and one day
  - include the required relations
  - normalize each process into one shared row shape
  - compute grouped machine totals and item-wise summary totals
- Create a dedicated PDF generator under backend PDF utilities that accepts one normalized daily payload and returns a server-side PDF buffer.
- Export the new PDF generator through `apps/backend/src/utils/pdf/index.js` so route imports stay aligned with the active modular PDF stack.
- All process-specific sources should be normalized into one shared export row shape before PDF rendering.
- The PDF detail table uses these columns in order:
  - `YARN`, `ITEM`, `CUT`, `MACHINE`, `WORKER`, `CRATES`, `ROLL TYPE`, `QUANTITY`, `GROSS`, `TARE`, `NET`
- `YARN` is populated per process using existing row data and lineage fallbacks:
  - cutter: direct `row.yarnName`
  - holo: issue yarn name, then traced yarn name when needed
  - coning: traced yarn name, then direct issue yarn name
- The machine summary block groups machines by the prefix before the first hyphen (`H1-A1` and `H1-A2` => `H1`), keeps blank machines as `Unassigned`, still leaves detail rows on their full machine labels, and includes both grouped `QTY` and grouped `TOTAL NET PRODUCTION`.
- Add an item summary block with `ITEM`, `QTY`, and `TOTAL NET PRODUCTION`.
- Add a yarn summary block with `YARN`, `QTY`, and `TOTAL NET PRODUCTION`.
- Render the machine, item, and yarn summaries side-by-side below the detail table, or move all three to a new page if the remaining space is insufficient.
- Remove the overview section from the daily production PDF and use a compact daily-export-specific header plus tighter table spacing so more rows fit per page without changing page orientation.
- Empty-data days should still produce a branded PDF with the selected date and a clear no-data state rather than returning `404`.
- Field mapping should follow current schema and lineage rules:
  - cutter `ITEM`: `row.itemName`, then `pieceId -> inboundItem -> item.name`
  - cutter `YARN`: `row.yarnName`
  - cutter `CUT`: `row.cut`, then `cutMaster.name`
  - cutter `WORKER`: `operator.name`, then `employee`
  - cutter `CRATES`: `box.name`
  - cutter `ROLL TYPE`: `bobbin.name`, then packet/piece type fallback
  - holo `ITEM`: `issue.itemId -> item.name`
  - holo `YARN`: direct issue yarn, then cutter trace fallback through `receivedRowRefs`
  - holo `CUT`: direct issue cut, then cutter trace fallback through `receivedRowRefs`
  - holo `WORKER`: `operator.name`
  - holo `CRATES`: `box.name`
  - holo `ROLL TYPE`: `rollType.name`
  - coning `ITEM`: `issue.itemId -> item.name`
  - coning `YARN`: recursive coning/holo trace fallback, then direct issue yarn
  - coning `CUT`: direct issue cut, then recursive coning trace fallback
  - coning `WORKER`: `operator.name`
  - coning `CRATES`: `box.name`
  - coning `ROLL TYPE`: traced upstream roll type when available, otherwise `Cones`
- Reuse existing lineage helpers from `apps/backend/src/routes/index.js` instead of introducing new tracing rules:
  - `parseRefs`
  - `resolveHoloIssueDetails`
  - `resolveConingTraceDetails`
  - `resolveLotNoFromPieceId`
- Raw receive-row queries must explicitly exclude deleted rows and null dates because the schema stores `date` as nullable on receive models.
- Range export should iterate one day at a time, build one PDF per date, and stream/package them into a ZIP using `archiver`.
- Assumption: no sample daily-sheet artifact is currently present in the repo, so implementation should target the requested section/column structure with repo-native PDF styling unless a separate sample is later provided.
- V1.1 is a PDF-format refinement only; the public route `GET /api/reports/production/export/daily`, permissions, and download contract remain unchanged while the summary section expands from two tables to three.

## Implementation Plan

### Tasks

- [x] Task 1: Add backend export dependencies and modular PDF export wiring
  - File: `apps/backend/package.json`
  - Action: Add `archiver` to backend dependencies so the reports route can package multi-day exports as a ZIP stream.
  - Notes: No Prisma migration is required for this feature.
  - File: `apps/backend/src/utils/pdf/index.js`
  - Action: Export the new daily production PDF generator from the active modular PDF surface.
  - Notes: Keep `apps/backend/src/utils/pdfSummary.js` unchanged; it is legacy reference only.

- [x] Task 2: Build a dedicated daily export data-normalization module for one process and one day
  - File: `apps/backend/src/utils/pdf/productionDailyExportData.js`
  - Action: Create a builder module with a single dispatcher such as `buildProductionDailyExportData({ process, date })` plus internal process-specific loaders for `cutter`, `holo`, and `coning`.
  - Notes: Return one normalized payload shape containing `process`, `date`, `rows`, `machineSummary`, `itemSummary`, `yarnSummary`, and `meta.noData`; `machineSummary` rows include `machine`, `totalQuantity`, and `totalNetProduction`.
  - File: `apps/backend/src/utils/pdf/productionDailyExportData.js`
  - Action: Implement the cutter daily loader using `ReceiveFromCutterMachineRow` filtered by `{ date, isDeleted: false }`, including `box`, `bobbin`, `operator`, `cutMaster`, and `issue` where available.
  - Notes: Resolve `ITEM` from `row.itemName` first, then `pieceId -> inboundItem -> item.name`; resolve `YARN` from `row.yarnName`; resolve `CUT` from `row.cut` then `cutMaster.name`; resolve `WORKER` from `operator.name` then `employee`; resolve `ROLL TYPE` from `bobbin.name` then packet/piece type fallback; use `grossWt`, `tareWt`, `netWt`, and `bobbinQuantity` for weight/count columns.
  - File: `apps/backend/src/utils/pdf/productionDailyExportData.js`
  - Action: Implement the holo daily loader using `ReceiveFromHoloMachineRow` filtered by `{ date, isDeleted: false }`, including `box`, `rollType`, `operator`, and `issue` relations (`machine`, `cut`, `yarn`, `twist`).
  - Notes: Mirror the existing holo cut fallback rule from Production Report by tracing `issue.receivedRowRefs` back to cutter receive rows when direct issue cut data is missing; populate `YARN` from the issue yarn with trace fallback when needed; derive net from `rollWeight` with `grossWeight - tareWeight` fallback.
  - File: `apps/backend/src/utils/pdf/productionDailyExportData.js`
  - Action: Implement the coning daily loader using `ReceiveFromConingMachineRow` filtered by `{ date, isDeleted: false }`, including `box`, `operator`, and `issue` relations (`machine`, `cut`, `yarn`, `twist`, `receivedRowRefs`).
  - Notes: Mirror the existing coning trace rule by resolving upstream cut/yarn/twist/roll-type data through coning issue refs and holo lineage; prefer traced `YARN` before direct issue yarn; default `ROLL TYPE` to `Cones` when no traced roll type is available; use `coneCount`, `grossWeight`, `tareWeight`, and `netWeight`.
  - File: `apps/backend/src/utils/pdf/productionDailyExportData.js`
  - Action: Aggregate grouped machine-wise quantity/net totals plus item-wise and yarn-wise quantity/net totals from the normalized rows.
  - Notes: Machine summaries group by prefix before the first hyphen, while detail rows still retain their original machine names; blank item/yarn summary labels normalize to `Unassigned`.

- [x] Task 3: Create the dedicated server-side daily production PDF generator
  - File: `apps/backend/src/utils/pdf/productionDailyExportPdf.js`
  - Action: Create a new generator such as `generateProductionDailyExportPdf(data)` that accepts the normalized daily payload and returns a PDF buffer.
  - Notes: Use landscape A4 unless table fit proves impossible; reuse `drawHeader`, `drawTable`, `formatWeight`, `formatNumber`, and `drawFooter` from `pdfHelpers.js`.
  - File: `apps/backend/src/utils/pdf/productionDailyExportPdf.js`
  - Action: Render a branded daily-export header that includes GLINTEX branding, the selected process label, and the report date.
  - Notes: The header should read as a daily production sheet rather than a summary PDF.
  - File: `apps/backend/src/utils/pdf/productionDailyExportPdf.js`
  - Action: Render the main detail table with these exact columns in order: `YARN`, `ITEM`, `CUT`, `MACHINE`, `WORKER`, `CRATES`, `ROLL TYPE`, `QUANTITY`, `GROSS`, `TARE`, `NET`.
  - Notes: Right-align numeric columns; use wrapping/truncation rules from `drawTable`; size the first two columns so yarn/item labels fit without collapsing numeric readability.
  - File: `apps/backend/src/utils/pdf/productionDailyExportPdf.js`
  - Action: Render grouped `Machine Summary`, `Item Summary`, and `Yarn Summary` tables side-by-side beneath the detail table.
  - Notes: `Machine Summary` contains `MACHINE`, `QTY`, and `TOTAL NET PRODUCTION`; `Item Summary` contains `ITEM`, `QTY`, and `TOTAL NET PRODUCTION`; `Yarn Summary` contains `YARN`, `QTY`, and `TOTAL NET PRODUCTION`; move all three tables together to a new page if the remaining vertical space is insufficient.
  - File: `apps/backend/src/utils/pdf/productionDailyExportPdf.js`
  - Action: Render a branded empty state when `rows.length === 0`.
  - Notes: Return a valid PDF for empty days with the selected date and a clear `No data available` message.

- [x] Task 4: Add the backend download route for single-day PDF and range ZIP export
  - File: `apps/backend/src/routes/index.js`
  - Action: Add `GET /api/reports/production/export/daily` directly after the existing production report routes and guard it with `requirePermission('reports', PERM_READ)`.
  - Notes: Keep the endpoint inside the current monolithic reports block.
  - File: `apps/backend/src/routes/index.js`
  - Action: Validate `process`, `from`, and `to`; reject missing values, invalid process values, `process=all`, malformed date strings, and `from > to` with `400` responses.
  - Notes: Preserve current auth/permission behavior and return `403` when the user lacks report read access.
  - File: `apps/backend/src/routes/index.js`
  - Action: For a single selected date, call the new daily data builder and PDF generator, then send the resulting buffer with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="production_daily_<process>_<date>.pdf"`.
  - Notes: Do not return `404` for no-data days; return the empty-state PDF with HTTP `200`.
  - File: `apps/backend/src/routes/index.js`
  - Action: For a date range, iterate each date in inclusive order, generate one PDF per day, append it to an `archiver` ZIP, and stream the ZIP response.
  - Notes: Use the exact attachment filename `production_daily_<process>_<from>_to_<to>.zip`; include PDFs for empty-data dates as well.

- [x] Task 5: Add a dedicated frontend download helper for production daily export
  - File: `apps/frontend/src/api/client.js`
  - Action: Add a new helper such as `downloadProductionDailyExport({ process, from, to })` next to `downloadSummaryPdf`.
  - Notes: Use the same authenticated `fetch` flow with `credentials: 'include'`, unauthorized event dispatch, response-body error parsing, `Content-Disposition` filename extraction, and browser blob download behavior.
  - File: `apps/frontend/src/api/client.js`
  - Action: Support both `application/pdf` and `application/zip` responses in the helper and choose an appropriate fallback filename if the header is missing.
  - Notes: Keep the helper compatible with direct `import * as api` usage from `Reports.jsx`.

- [x] Task 6: Add the Daily Export UI flow inside Production Report
  - File: `apps/frontend/src/pages/Reports.jsx`
  - Action: Import `Dialog` / `DialogContent` directly from `../components/ui/Dialog` and add local export state: modal open flag, export process, export from/to dates, submitting flag, and validation error text.
  - Notes: Do not add export state to the parent `Reports` component.
  - File: `apps/frontend/src/pages/Reports.jsx`
  - Action: Add a `Daily Export` trigger near the existing Production Report filter controls, with a secondary placement option in the table header if the filter row becomes too crowded.
  - Notes: The trigger should be visible whenever the Production Report tab is active, regardless of whether the current on-screen process is `all`.
  - File: `apps/frontend/src/pages/Reports.jsx`
  - Action: When opening the export modal, prefill `process` from the current report process if it is `cutter`, `holo`, or `coning`; otherwise prefill `cutter`. Prefill `from` and `to` from the current Production Report date filters.
  - Notes: These export values must be decoupled from the on-screen report filter state so editing the modal does not trigger `loadReport()`.
  - File: `apps/frontend/src/pages/Reports.jsx`
  - Action: Validate missing dates, invalid ranges, and `process=all` before calling the API helper, block submission on invalid input, and show the validation error in the modal.
  - Notes: Preserve the page’s current simple error style for request failures, but prevent duplicate submissions with an `exporting` disabled state.
  - File: `apps/frontend/src/pages/Reports.jsx`
  - Action: Submit valid export requests through the new client helper and close or reset the modal only after a successful download trigger.
  - Notes: The existing Production Report table state, selected view, and current filters must remain unchanged during the export flow.

### Acceptance Criteria

- [ ] AC 1: Given the Production Report tab is open with `process` set to `cutter`, `holo`, or `coning` and date filters already selected, when the user opens the Daily Export modal, then the modal defaults to that same process and the same `from` / `to` dates.
- [ ] AC 2: Given the Production Report tab is open with `process=all`, when the user opens the Daily Export modal, then the export process defaults to `cutter` while the modal still inherits the current `from` / `to` dates.
- [ ] AC 3: Given the user leaves `from` or `to` empty, chooses `process=all`, or sets `from` later than `to`, when they attempt to export, then the UI blocks the request and shows a validation error without changing the on-screen Production Report filters.
- [ ] AC 4: Given a valid single-day export request for `cutter`, `holo`, or `coning`, when `GET /api/reports/production/export/daily` is called with `from === to`, then the backend returns `200`, `Content-Type: application/pdf`, and `Content-Disposition` with the filename `production_daily_<process>_<date>.pdf`.
- [ ] AC 5: Given a valid multi-day export request for `cutter`, `holo`, or `coning`, when `GET /api/reports/production/export/daily` is called with `from < to`, then the backend returns `200`, `Content-Type: application/zip`, and `Content-Disposition` with the filename `production_daily_<process>_<from>_to_<to>.zip`.
- [ ] AC 6: Given a requested date has no receive rows for the selected process, when the daily export is generated, then the response still contains a branded PDF for that date with the correct header/date and a clear `No data available` state.
- [ ] AC 7: Given daily export data exists for a selected process/date, when the PDF is generated, then the detail table includes the columns `YARN`, `ITEM`, `CUT`, `MACHINE`, `WORKER`, `CRATES`, `ROLL TYPE`, `QUANTITY`, `GROSS`, `TARE`, and `NET`, with `YARN` and `ITEM` populated from the normalized process-specific mappings.
- [ ] AC 8: Given daily export data exists for a selected process/date, when the PDF is generated, then the machine summary block groups machine totals by the prefix before the first hyphen, blank machines render as `Unassigned`, detail rows still show the full machine labels from the normalized rows, and each grouped machine row includes both `QTY` and `TOTAL NET PRODUCTION`.
- [ ] AC 9: Given daily export data exists for a selected process/date, when the PDF is generated, then `Machine Summary`, `Item Summary`, and `Yarn Summary` appear together, and each summary table includes its label column plus `QTY` and `TOTAL NET PRODUCTION`, with totals that match the normalized rows.
- [ ] AC 10: Given the detail table leaves insufficient vertical space for the summary section, when the PDF is generated, then the `Machine Summary`, `Item Summary`, and `Yarn Summary` tables move together to a new page and remain side-by-side.
- [ ] AC 11: Given holo or coning export rows rely on upstream lineage for cut, yarn, or roll-type resolution, when the builder normalizes those rows, then it follows the same fallback order already used in the current report logic before leaving a value blank or using the `Cones` fallback for coning roll type.
- [ ] AC 12: Given the user lacks `reports` read permission or the backend rejects the request, when the export helper receives the error response, then the frontend surfaces the failure and no broken file download is triggered.

## Additional Context

### Dependencies

## V1.1 Addendum

- This V1.1 update is a post-launch PDF-format refinement only.
- The public route, query parameters, attachment naming, and frontend download contract remain unchanged from V1.
- The implementation focus is limited to backend daily-export normalization/rendering plus this artifact update.
- The latest refinement extends the summary payload and layout from machine/item totals to machine/item/yarn totals without changing the route or frontend request shape.

## Review Notes

- V1 review completed
- Findings: 13 total, 10 fixed, 3 skipped
- Resolution approach: auto-fix
- Fixed: bounded export range, safer ZIP preparation, client/server cancellation, process/range warnings, inline modal errors, lower ZIP compression, and targeted backend validation tests
- Skipped: fully replacing browser-side binary buffering for ZIP downloads, the undecided CSRF concern on authenticated `GET`, and full automated coverage for disconnect/mid-stream route behavior
- V1.1 follow-up review completed
- Findings: 10 total, 8 fixed, 2 undecided
- Resolution approach: auto-fix for real findings
- Fixed: Prisma-free summary helpers, injected-db builder coverage for cutter/holo/coning normalization, empty-state and paginated-summary PDF coverage, summary table grid lines, unassigned item fallback labels, yarn/item-first detail sorting, and null numeric fallback handling for holo net calculation
- Undecided and not auto-fixed: mandatory helper fail-fast for lineage-enabled exports, and any remaining visual tuning if summary headers need further width adjustments with real production data

- Add `archiver` to the backend workspace for ZIP packaging.
- Reuse the existing modular jsPDF helpers already shipped in `apps/backend/src/utils/pdf/pdfHelpers.js`; no new PDF library is needed.
- Reuse existing report permissions and authenticated frontend fetch behavior; no auth model or schema changes are required.

### Testing Strategy

- Manual validation: open Production Report, set each supported process (`cutter`, `holo`, `coning`), open the Daily Export modal, and verify default process/date values against the current tab state.
- Manual validation: submit single-day exports for `cutter`, `holo`, and `coning` and confirm browser download behavior, attachment filenames, and `application/pdf` responses.
- Manual validation: submit multi-day exports for `cutter`, `holo`, and `coning` and confirm ZIP download behavior, one PDF per date, and the exact ZIP filename format.
- Manual validation: test invalid UI cases for missing dates, `from > to`, and `process=all`; confirm the request is blocked before download.
- Manual validation: test invalid backend cases by calling the endpoint directly with malformed params and confirm `400` responses for invalid process and invalid ranges.
- Manual validation: verify one known data day per process against database rows for row counts, grouped machine totals, item totals, and the normalized mappings for yarn, item, cut, worker, crates, roll type, gross, tare, and net.
- Manual validation: verify an empty-data day still generates a branded no-data PDF and that ranged ZIP exports include empty-day PDFs instead of omitting those dates.
- Manual validation: verify the export modal does not mutate the on-screen report process/view/date filters or trigger a table reload while the user edits export-only values.
- Targeted validation: confirm the frontend UTC date-range helper still counts 8 days across the March DST boundary in `America/New_York`, machine summary groups quantity and net correctly by machine prefix, repeated yarn labels collapse into one yarn-summary row, blank summary labels normalize to `Unassigned`, and the compact PDF layout still paginates the three summary tables together.

### Notes

- Highest-risk implementation area: holo and coning trace fallback currently lives inside `apps/backend/src/routes/index.js`; the new daily builder must mirror those rules exactly or explicitly factor them into a reusable helper without changing report behavior.
- Highest-risk layout area: the requested detail table is wide, so the PDF generator should prefer landscape layout, remove unnecessary header/overview waste, and still keep the machine/item/yarn summaries side-by-side, moving all three together to a new page if the remaining space is insufficient.
- Range export performance risk: generating one PDF per day can amplify repeated lookups across long date ranges; keep date iteration incremental and avoid loading the entire ZIP payload in memory before streaming.
- No sample daily-sheet asset was found in the repo during investigation, so styling should aim for structural parity with the requested format rather than pixel-parity with an unavailable artifact.
