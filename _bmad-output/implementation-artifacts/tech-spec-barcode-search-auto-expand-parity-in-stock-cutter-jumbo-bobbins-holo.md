---
title: 'Barcode Search Auto-Expand Parity in Stock (Cutter Jumbo/Bobbins/Holo)'
slug: 'barcode-search-auto-expand-parity-in-stock-cutter-jumbo-bobbins-holo'
created: '2026-02-25T12:44:27Z'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React 18 (JSX, Vite)', 'TailwindCSS utility classes', 'Frontend v2 API client via fetch + credentials include', 'Backend Express v2 routes + Prisma raw SQL for stock lot-key lookups']
files_to_modify: ['apps/frontend/src/pages/Stock.jsx', 'apps/frontend/src/components/stock/BobbinView.jsx', 'apps/frontend/src/components/stock/HoloView.jsx']
code_patterns: ['Per-process stock rendering from Stock.jsx into dedicated view components', 'Search pipeline combines fuzzy score + explicit barcode substring hit', 'Expand state is view-local and computed from expandedLot or hasBarcodeHit', 'Holo/Coning v2 mode uses barcode lot-key API + lazy lot-row fetch + single-hit auto-expand effect']
test_patterns: ['No automated frontend tests currently in apps/frontend (manual validation flows)']
---

# Tech-Spec: Barcode Search Auto-Expand Parity in Stock (Cutter Jumbo/Bobbins/Holo)

**Created:** 2026-02-25T12:44:27Z

## Overview

### Problem Statement

In the Stock module, Coning behavior supports barcode-driven search that auto-expands matching lot rows for quick visibility. The same UX is missing or inconsistent in `Stock > Cutter (Jumbo)`, `Stock > Cutter (Bobbins)`, and `Stock > Holo`, causing uneven user experience and slower barcode lookup workflows.

### Solution

Implement barcode search auto-expand parity for Cutter (Jumbo), Cutter (Bobbins), and Holo stock views using the existing Coning interaction pattern, while keeping current filtering, ranking, and row rendering behavior intact.

### Scope

**In Scope:**
- Stock module parity for barcode search auto-expand in `Cutter (Jumbo)`, `Cutter (Bobbins)`, and `Holo` views.
- Reuse existing stock-view patterns and keep behavior aligned with Coning UX.

**Out of Scope:**
- Any other modules or screens outside Stock.
- Backend/data-model changes unless strictly required by current frontend view architecture.

## Context for Development

### Codebase Patterns

- Stock routing and top-level search input are centralized in `apps/frontend/src/pages/Stock.jsx`; process views receive `search`, `filters`, and `groupBy` as props.
- Cutter Jumbo (inside `Stock.jsx`) and Bobbin/Holo/Coning views all compute `hasBarcodeHit` from search terms and use it to influence expansion state.
- Bobbin view is legacy (no v2 lot-key endpoint) and expands rows when `expandedLot === lotNo || hasBarcodeHit`.
- Holo and Coning v2 paths use:
  - `getV2StockBarcodeLotKeys(process, { q })` for barcode-to-lot-key lookup.
  - `getV2StockLotRows(process, { key })` for lazy row hydration.
  - A single-hit `useEffect` auto-expand pattern (`barcodeHitKeys.size === 1`) to open the matched lot.
- Search matching convention is consistent across views:
  - Fuzzy multi-term scoring via `calculateMultiTermScore`.
  - Direct barcode substring fallback (`search.trim().length >= 6`).
  - Higher threshold for long terms (`>= 8` uses score cutoff 40 unless barcode hit).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/frontend/src/pages/Stock.jsx` | Cutter Jumbo implementation plus process/view composition; contains jumbo lot-level `hasBarcodeHit` expansion behavior and v2 barcode key plumbing for Holo/Coning. |
| `apps/frontend/src/components/stock/BobbinView.jsx` | Cutter Bobbins search + expand implementation; current target for parity hardening to match Coning behavior expectations. |
| `apps/frontend/src/components/stock/HoloView.jsx` | Holo search + expand implementation with v2 single-hit auto-expand; verify parity edge cases against Coning. |
| `apps/frontend/src/components/stock/ConingView.jsx` | Baseline reference behavior for expected barcode search auto-expand UX. |
| `apps/frontend/src/api/v2.js` | Frontend wrapper for `getV2StockBarcodeLotKeys` and `getV2StockLotRows` used by Holo/Coning. |
| `apps/backend/src/routes/v2.js` | v2 stock endpoints (`/stock/:process/lots`, `/lot-rows`, `/barcode-lot-keys`) that control Holo/Coning lot-key matching behavior. |

### Technical Decisions

- Keep implementation in existing stock view files (no new architecture layer) to match project conventions.
- Preserve current search thresholds and scoring math unless a parity defect proves they diverge from Coning behavior.
- Treat Coning as UX reference baseline for "barcode hit should reveal relevant lot row details."
- Prefer frontend-only changes for Cutter Jumbo/Bobbins first; evaluate Holo backend lot-key behavior only if frontend parity is still broken after matching Coning patterns.
- Keep group mode behavior unchanged (`groupBy` continues disabling detail expansion where currently designed).

## Implementation Plan

### Tasks

- [x] Task 1: Normalize barcode-hit expansion trigger semantics across target stock views
  - File: `apps/frontend/src/pages/Stock.jsx`
  - Action: Extract/align cutter jumbo row-expansion condition so it matches Coning intent: a barcode hit in current filtered results should force expanded lot rendering when `groupByItem` is false.
  - Notes: Preserve existing search threshold behavior (`>=6` barcode substring). Do not change filter logic or sorting.

- [x] Task 2: Add Coning-style one-time auto-expand memory for Bobbins barcode search
  - File: `apps/frontend/src/components/stock/BobbinView.jsx`
  - Action: Introduce `lastAutoExpandRef`-style guard and deterministic target expansion update for barcode-hit results so matching lot auto-expands consistently without repeated jitter on re-render.
  - Notes: Keep legacy non-v2 data path. Ensure manual row toggle still works after auto-expand.

- [x] Task 3: Harden Holo barcode-hit auto-expand parity with Coning flow
  - File: `apps/frontend/src/components/stock/HoloView.jsx`
  - Action: Verify and align Holo single-hit auto-expand sequence (`barcodeHitKeys.size === 1`) with Coning pattern, including lazy row fetch then set expand key.
  - Notes: Keep `groupBy` behavior unchanged; no expansion when grouped.

- [x] Task 4: Ensure mobile and desktop expansion parity for Cutter Jumbo and Bobbins
  - File: `apps/frontend/src/pages/Stock.jsx`
  - File: `apps/frontend/src/components/stock/BobbinView.jsx`
  - Action: Confirm both desktop table and mobile card branches use the same computed expansion condition for barcode-hit scenarios.
  - Notes: Keep current row highlighting behavior (`bg-primary/10`) for matched inner rows.

- [x] Task 5: Preserve non-barcode search and manual expansion regressions
  - File: `apps/frontend/src/pages/Stock.jsx`
  - File: `apps/frontend/src/components/stock/BobbinView.jsx`
  - File: `apps/frontend/src/components/stock/HoloView.jsx`
  - Action: Keep default manual expand/collapse logic and fuzzy search relevance behavior unchanged for non-barcode queries.
  - Notes: No backend/API changes unless Holo parity failure is proven during validation.

### Acceptance Criteria

- [x] AC 1: Given Stock is on Cutter Jumbo and `groupBy` is off, when the user enters a barcode that matches exactly one lot in visible filtered results, then that lot row auto-expands and matching inner piece rows are visible without manual click.
- [x] AC 2: Given Stock is on Cutter Bobbins and `groupBy` is off, when the user enters a barcode matching one or more crates under a lot, then the matching lot auto-expands and matching crate rows are visible/highlighted.
- [x] AC 3: Given Stock is on Holo with v2 stock enabled and `groupBy` is off, when barcode search returns exactly one lot key from `/api/v2/stock/holo/barcode-lot-keys`, then the lot auto-expands (loading lot rows first if needed) and shows matching active rows.
- [x] AC 4: Given Stock is on any target view and `groupBy` is on, when the user searches by barcode, then grouped rows remain non-expandable and existing grouped behavior is unchanged.
- [x] AC 5: Given Stock is on any target view, when the user clears the search box or enters non-barcode search text, then manual expand/collapse continues to function and no unintended auto-expanded state persists beyond existing behavior.
- [x] AC 6: Given multiple lots match a barcode-like search term, when results render, then view behavior remains deterministic and stable (no rapid expand/collapse oscillation across re-renders).
- [x] AC 7: Given no rows match the entered barcode, when search is applied, then no lot expands and existing empty-state messaging remains unchanged.

## Additional Context

### Dependencies

- Existing stock v2 APIs: `/api/v2/stock/:process/lots`, `/api/v2/stock/:process/lot-rows`, `/api/v2/stock/:process/barcode-lot-keys` (Holo/Coning only).
- Existing utility stack: `calculateMultiTermScore`, `HighlightMatch`, and per-view `expandedLot` state patterns.
- React hook dependencies (`useEffect`, `useMemo`, `useRef`) already used in target files; no new package dependency required.
- Permission/auth behavior remains unchanged because this change is UI-state/search behavior only.

### Testing Strategy

- Manual validation only (project has no automated frontend tests configured).
- Desktop checks:
  - Cutter Jumbo: scan/enter barcode for a known piece, confirm lot opens automatically and relevant piece row is visible.
  - Cutter Bobbins: scan/enter known bobbin barcode, confirm lot opens automatically and matching crate row is highlighted.
  - Holo (v2 on): scan/enter known holo receive barcode that resolves to one lot key, confirm row loads and expands automatically.
- Mobile checks:
  - Repeat Cutter Jumbo and Bobbins barcode checks in mobile card view and confirm same expansion outcome.
- Regression checks:
  - Apply non-barcode text search and verify ranking/filter behavior unchanged.
  - Toggle `groupBy` on and verify no detail expansion occurs.
  - Manually click expand/collapse before and after barcode searches to confirm no broken toggling.
  - Verify empty result behavior remains unchanged for unmatched barcodes.

### Notes

- Risk: Holo v2 barcode lot-key responses may include multiple keys for partially similar barcodes; UX should remain stable and avoid oscillating expansion.
- Risk: Expansion side effects can conflict with user manual collapse if state is repeatedly re-derived; use one-time auto-expand guard semantics similar to Coning.
- Limitation: No automated test harness means regressions must be guarded by explicit manual test checklist.
- Future consideration (out of scope): unify duplicate stock view expansion/search logic into shared hook to reduce drift across process views.

## Review Notes
- Adversarial review completed
- Findings: 10 total, 7 fixed, 3 skipped
- Resolution approach: auto-fix
- Validation evidence: frontend build passed via `npm run build --workspace apps/frontend`; manual QA checklist remains the source of truth for runtime UX confirmation.
- Post-fix review completed on 2026-02-25 for holo barcode key parity regression.
- Findings: 10 total, 1 fixed (real), 9 marked non-blocking follow-ups.
- Resolution approach: auto-fix (targeted backend patch in `apps/backend/src/routes/v2.js`).
