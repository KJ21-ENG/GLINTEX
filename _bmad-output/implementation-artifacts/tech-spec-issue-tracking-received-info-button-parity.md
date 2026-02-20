---
title: 'Issue Tracking Received Info Button Parity'
slug: 'issue-tracking-received-info-button-parity'
created: '2026-02-20T13:58:41+05:30'
status: 'Implementation Complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['JavaScript (ESM)', 'React 18', 'Vite 5', 'TailwindCSS 3', 'Express 4', 'Prisma 4', 'PostgreSQL']
files_to_modify: ['apps/frontend/src/components/issue/OnMachineTable.jsx']
code_patterns: ['Shared InfoPopover component with table-style renderContent in receive header info section', 'Per-process conditional table rendering (cutter/holo/coning)', 'Data derived from issue-linked receive rows and refs', 'Feature-flagged v2 list path via useV2CursorList']
test_patterns: ['No automated test suite configured', 'Manual validation through process-specific UI flows']
---

# Tech-Spec: Issue Tracking Received Info Button Parity

**Created:** 2026-02-20T13:58:41+05:30

## Overview

### Problem Statement

In Issue to Machine → Issue Tracking (On Machine), the `Received` column only shows aggregate weight and does not provide the same `i` info-popover details available in the Receive-from-Machine header information section. Users cannot quickly inspect the receive rows tied to scanned issue barcode context directly from Issue Tracking.

### Solution

Add the same `InfoPopover` interaction and table-style details layout used in the Receive-from-Machine header information section (e.g., `Received Crates`) to the Issue Tracking table’s `Received` column, for all stages (`cutter`, `holo`, `coning`), without changing existing receive math or backend flows.

### Scope

**In Scope:**
- Add an `i` info button beside `Received` values in Issue Tracking (On Machine) rows.
- Support `cutter`, `holo`, and `coning` stage views.
- Mirror the receive-header info popover layout/content pattern exactly (table-style popover, not history-row key/value tooltip).
- Keep the existing popover interaction pattern (hover/hold/click, mobile tap behavior).

**Out of Scope:**
- Any UI redesign of popovers.
- Backend/API contract changes.
- Changes to receive allocation or weight-calculation logic.
- Adding extra data fields beyond the current receive-header details layout.

## Context for Development

### Codebase Patterns

- Shared popover behavior is centralized in `InfoPopover` with hover/click open state.
- Receive-from-machine header info section uses `InfoPopover` with `renderContent` table layout for received record drill-down.
- `OnMachineTable` renders rows through explicit per-stage branches (`cutter`, `holo`, `coning`) and already computes per-issue `receivedWeight`.
- Issue-linked source data already exists in loaded module data:
- `cutter`: `receive_from_cutter_machine_rows` by `issueId`
- `holo`: `receive_from_holo_machine_rows` by `issueId`
- `coning`: `receive_from_coning_machine_rows` by `issueId`
- V2 on-machine mode is active behind `v2OnMachine`; response rows come from `/api/v2/on-machine/:process` but still preserve issue-level fields used by current table rendering.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/frontend/src/components/issue/OnMachineTable.jsx` | Primary implementation target; add info trigger in `Received` cell and build issue receive-detail items |
| `apps/frontend/src/components/receive/CutterReceiveForm.jsx` | Canonical source for header summary `Received` info button and `Received Crates` table popover layout |
| `apps/frontend/src/components/receive/ConingReceiveForm.jsx` | Reference for header summary popover table variant (`Coning Receives`) and sizing/alignment behavior |
| `apps/frontend/src/components/common/InfoPopover.jsx` | Shared interaction behavior (hover/hold/click + mobile tap) to reuse unchanged |
| `apps/frontend/src/context/InventoryContext.jsx` | Confirms process module payload includes receive row collections needed for client-side detail mapping |
| `apps/backend/src/routes/v2.js` | Confirms v2 on-machine payload characteristics/constraints when feature flag is enabled |

### Technical Decisions

- Reuse `InfoPopover` directly to guarantee behavior parity and avoid UI divergence.
- Mirror the receive-header info layout (table-style popover content under `Received`) rather than Receive History row tooltip layout.
- Keep this change frontend-scoped in `OnMachineTable` unless a v2 payload gap blocks parity; backend changes are not planned by default.
- Build detail items from already loaded receive rows keyed by `issueId` and avoid additional fetches.

## Implementation Plan

### Tasks

- [x] Task 1: Add receive-details popover dependencies and shared table renderer in On Machine table
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Import `InfoPopover` from common components and add a local renderer for table-style popover content matching receive-header `Received Crates` pattern.
  - Notes: Reuse receive-header settings (`renderContent` table, larger width class, compact header/body cells, same `i` trigger style next to `Received`).

- [x] Task 2: Build issue-level receive detail row resolvers for each stage
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Add helper functions that return rows for the popover table for a given issue row (`entry`) and stage (`cutter`/`holo`/`coning`) by reading already-loaded receive rows and related lookup maps.
  - Notes: Keep logic read-only and frontend-derived from existing module data (`receive_from_cutter_machine_rows`, `receive_from_holo_machine_rows`, `receive_from_coning_machine_rows`, `issue.receivedRowRefs`, `sourceRowRefs` where relevant). Do not change receive math.

- [x] Task 3: Add `i` button beside desktop `Received (kg)` values in Issue Tracking rows
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Replace plain desktop `Received` cell render with a `flex` row showing formatted received weight plus `InfoPopover` that renders a table-style content block.
  - Notes: Keep current text color/spacing behavior. If no detail records are available, show the receive-style empty state.

- [x] Task 4: Add the same `i` button behavior in mobile Issue Tracking cards
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Update mobile `Rcvd:` display block to include the same `InfoPopover` trigger and table content mapping used in desktop rows.
  - Notes: Ensure tap-to-open works on mobile and does not break existing card actions.

- [x] Task 5: Ensure v2 on-machine mode remains compatible
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Verify helper lookups work for both legacy and `v2OnMachine` row shapes (including fallback by `entry.id`, `entry.issueId`, and safe defaults) so popover data resolves when v2 list is enabled.
  - Notes: No backend contract changes planned; handle missing fields defensively in UI.

- [x] Task 6: Keep table filtering/export/progress behavior unchanged
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Confirm new popover render path is presentation-only and does not alter existing computed values, filters, totals, export mapping, or action menus.
  - Notes: This is a non-functional parity addition; all existing issue tracking workflows must remain intact.

### Acceptance Criteria

- [x] AC 1: Given Issue to Machine is opened on `cutter` process with at least one On Machine row, when the user hovers/holds or taps the `i` beside `Received`, then a received-details popover opens with the same table-style layout used in receive header info (`Received Crates` pattern).

- [x] AC 2: Given Issue to Machine is opened on `holo` process with at least one On Machine row, when the user opens the `i` popover for `Received`, then receive rows shown are sourced from issue-linked holo receive data without changing the displayed received kg.

- [x] AC 3: Given Issue to Machine is opened on `coning` process with at least one On Machine row, when the user opens the `i` popover for `Received`, then receive rows shown are sourced from issue-linked coning receive data without changing the displayed received kg.

- [x] AC 4: Given an On Machine row has no resolvable receive detail rows, when the user opens the `i` popover, then the popover still renders and shows an empty-state message instead of crashing or hiding the button.

- [x] AC 5: Given desktop table view is active, when users interact with the new `i` button in `Received` cells, then existing row actions, filters, and progress indicators continue to work unchanged.

- [x] AC 6: Given mobile card view is active, when users tap the new `i` button in the `Rcvd` section, then the same popover content/interaction pattern works and card actions remain usable.

- [x] AC 7: Given `v2OnMachine` feature flag is enabled, when On Machine data is loaded and users open `Received` popovers, then the UI handles available/missing detail data safely with no runtime errors.

- [x] AC 8: Given the feature is implemented, when users compare receive-header `Received` info popover and Issue Tracking’s new popover, then both use the same table-style content pattern and trigger presentation.

## Additional Context

### Dependencies

- No new npm dependencies.
- Existing shared component dependency: `apps/frontend/src/components/common/InfoPopover.jsx`.
- Existing data dependency: process module data loaded through `ensureModuleData('process', { process })` and normalized in `InventoryContext`.
- Optional reference dependency only (no mandatory change): `/api/v2/on-machine/:process` payload behavior from backend `apps/backend/src/routes/v2.js`.

### Testing Strategy

- Manual test matrix (no automated suite exists in repo scripts):
- Cutter desktop: open Issue Tracking → On Machine, verify `Received` cell has `i` button, open popover, validate table columns/rows and no row regressions.
- Holo desktop: repeat and verify table rows come from holo receive-linked rows; confirm received number remains unchanged.
- Coning desktop: repeat and verify coning receive-linked table rows and stable rendering with/without refs.
- Mobile (all stages): switch to small viewport, open `i` from `Rcvd` area, verify tap open/close behavior and non-blocked card actions.
- V2 enabled path: with `v2OnMachine` active, verify no console/runtime errors and popovers render either populated table rows or empty-state safely.
- Regression checks: filtering/search/export and action menus still behave exactly as before.

### Notes

- Preserve pure JS/JSX + ESM + Tailwind conventions from project context.
- This spec intentionally avoids backend/API changes; if v2 payload lacks required detail granularity for exact parity, raise a follow-up backend enhancement spec instead of silently changing behavior.
- Performance caution: avoid heavy nested scans inside render loops; use memoized maps/helpers where practical in `OnMachineTable`.
