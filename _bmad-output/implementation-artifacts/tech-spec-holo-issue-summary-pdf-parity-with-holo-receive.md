---
title: 'Holo Issue Summary PDF Parity with Holo Receive'
slug: 'holo-issue-summary-pdf-parity-with-holo-receive'
created: '2026-02-20T09:41:17Z'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4, 5]
tech_stack: ['Node.js (ESM JavaScript)', 'Express backend', 'jsPDF']
files_to_modify: ['apps/backend/src/utils/pdf/holoIssuePdf.js']
code_patterns: ['Per-stage dedicated PDF generator modules under apps/backend/src/utils/pdf', 'Summary table construction via parallel headers/colWidths/rows arrays', 'Machine ordering parity implemented in holoReceivePdf.js using localeCompare with numeric option']
test_patterns: ['No automated tests configured; validate via manual PDF export and visual verification']
---

# Tech-Spec: Holo Issue Summary PDF Parity with Holo Receive

**Created:** 2026-02-20T09:41:17Z

## Overview

### Problem Statement

Holo Issue Summary PDF output is inconsistent with Holo Receive Summary PDF for detail row ordering and column sequence. Issue summary rows are not machine-sorted, and key columns do not follow the receive-summary reading order.

### Solution

Update the Holo Issue Summary PDF generator to sort detail rows by machine name using the same numeric-aware locale compare behavior as Holo Receive Summary, and reorder issue detail columns to match the requested sequence: Machine, Lot No, Yarn, Item, Cut, Twist.

### Scope

**In Scope:**
- Holo Issue Summary PDF detail-row sorting by machine name.
- Holo Issue Summary PDF column reorder to: Machine, Lot No, Yarn, Item, Cut, Twist.
- Keep totals and non-target columns functional after reorder.

**Out of Scope:**
- Holo Receive Summary PDF logic changes.
- Frontend export screens or report UI changes.
- Cutter/Coning PDF summary behavior changes.

## Context for Development

### Codebase Patterns

- Summary PDFs are generated in stage/type-specific backend modules under `apps/backend/src/utils/pdf/` and routed by `generateSummaryPDF` in `apps/backend/src/utils/pdf/index.js`.
- Each PDF generator follows a shared structure: `drawHeader` -> `drawOverview` -> table configuration (`headers`, `colWidths`) -> mapped `rows` -> totals row -> `drawFooter`.
- Holo Receive PDF applies pre-table sort on `data.details` by `machineName` using `localeCompare(..., { numeric: true, sensitivity: 'base' })`; this is the parity reference pattern.
- Holo Issue PDF currently has a static table layout with explicit cell mapping order and no pre-sort; ordering/column parity must be done by updating all related table config arrays together.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/backend/src/utils/pdf/holoIssuePdf.js` | Target file for sorting and column-order changes in Holo Issue Summary PDF generation. |
| `apps/backend/src/utils/pdf/holoReceivePdf.js` | Reference behavior for machine-based sorting and desired column sequence parity. |
| `apps/backend/src/utils/pdf/pdfHelpers.js` | Shared table rendering behavior and alignment/wrapping rules that constrain header and row updates. |
| `apps/backend/src/utils/pdf/index.js` | Stage/type dispatch entry point confirming Holo issue summary path uses `generateHoloIssuePdf`. |

### Technical Decisions

- Reuse existing receive-summary machine sorting approach for parity and predictable mixed alphanumeric machine ordering.
- Apply column reorder in all connected structures (`headers`, `colWidths`, and row cell mapping) to keep alignment and totals-row integrity.
- Preserve all existing numeric metric calculations and overview values.
- Keep changes isolated to `generateHoloIssuePdf` implementation only, so API payload contracts and summary dispatch behavior remain unchanged.

## Implementation Plan

### Tasks

- [x] Task 1: Add machine-based pre-sort for Holo issue details
  - File: `apps/backend/src/utils/pdf/holoIssuePdf.js`
  - Action: Before table header construction, sort `data.details` by `machineName` using `localeCompare` with `{ numeric: true, sensitivity: 'base' }`, matching the Holo receive pattern.
  - Notes: Keep null/empty machine names safe by defaulting to empty string during comparison; do not mutate behavior outside this function.

- [x] Task 2: Reorder Holo issue table headers to receive-parity order
  - File: `apps/backend/src/utils/pdf/holoIssuePdf.js`
  - Action: Update `headers` so the first six domain columns are exactly `Machine`, `Lot No`, `Yarn`, `Item`, `Cut`, `Twist`, while preserving remaining operational/numeric columns.
  - Notes: Keep `S.No` first and all existing numeric metric headers (`M. Bobbins`, `Bob Wt (kg)`, `Yarn (kg)`) present.

- [x] Task 3: Realign column widths and row cell mapping with reordered headers
  - File: `apps/backend/src/utils/pdf/holoIssuePdf.js`
  - Action: Update `colWidths`, detail-row `cells`, and totals-row placeholder cells so each value aligns with the newly ordered header positions.
  - Notes: Ensure totals are still emitted under their numeric columns and textual placeholder cells remain blank where expected.

- [x] Task 4: Validate generated output for ordering and data integrity
  - File: `apps/backend/src/utils/pdf/holoIssuePdf.js`
  - Action: Generate a Holo issue summary PDF from representative data and verify machine sort order, requested column order, placeholder behavior, and totals alignment.
  - Notes: Validation is manual (no test framework in repo for this path).

### Acceptance Criteria

- [x] AC 1: Given Holo issue details include machine names with numeric suffixes (for example `M2` and `M10`), when Holo Issue Summary PDF is generated, then rows appear in numeric-aware machine order (`M2` before `M10`).
- [x] AC 2: Given Holo Issue Summary PDF is generated, when reading the detail table headers left-to-right, then the key sequence is `Machine`, `Lot No`, `Yarn`, `Item`, `Cut`, `Twist`.
- [x] AC 3: Given the reordered detail table is generated, when totals are rendered, then `M. Bobbins`, `Bob Wt (kg)`, and `Yarn (kg)` totals match pre-change calculations and remain under their correct columns.
- [x] AC 4: Given one or more issue detail rows have missing text fields, when PDF rows are rendered, then missing values still display as `-` and PDF generation completes without errors.

## Additional Context

### Dependencies

- Existing jsPDF helper stack used by summary generators (`apps/backend/src/utils/pdf/pdfHelpers.js`).
- Existing Holo issue summary data shape passed to `generateHoloIssuePdf` via summary-report backend route flow.

### Testing Strategy

- Manual test 1: Generate Holo Issue Summary PDF with machine names that include numeric suffixes and confirm machine order matches numeric-aware sort.
- Manual test 2: Verify Holo Issue detail headers show `Machine, Lot No, Yarn, Item, Cut, Twist` in that exact order.
- Manual test 3: Compare total numeric values (`M. Bobbins`, `Bob Wt (kg)`, `Yarn (kg)`) against source totals to ensure unchanged calculations.
- Manual test 4: Include rows with missing machine/yarn/cut/twist/operator fields and verify placeholder `-` rendering and successful PDF generation.

### Notes

- User requested parity specifically for Holo Issue Summary PDF against Holo Receive Summary PDF.
- No API contract changes are required; this is a presentation-layer PDF ordering/layout update only.
## Review Notes
- Adversarial review completed
- Findings: 10 total, 5 fixed, 5 skipped (noise/architecture)
- Resolution approach: auto-fix
- Summary: Implemented machine-based sorting and column reordering for Holo Issue Summary PDF parity. Optimized row mapping and totals logic to resolve review findings.
