---
title: 'Real-Time Tracking Table Refresh After Save Across All Modules'
slug: 'real-time-tracking-table-refresh-after-save-across-all-modules'
created: '2026-02-21 00:21:33 IST'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React 18 + Vite SPA', 'InventoryContext normalized module store', 'Custom v2 cursor pagination hook (useV2CursorList)', 'Express + Prisma v2 history/tracking endpoints']
files_to_modify: ['apps/frontend/src/context/InventoryContext.jsx', 'apps/frontend/src/pages/IssueToMachine.jsx', 'apps/frontend/src/components/issue/OnMachineTable.jsx', 'apps/frontend/src/pages/IssueHistory.jsx', 'apps/frontend/src/components/issue/IssueToCutter.jsx', 'apps/frontend/src/components/issue/IssueToHolo.jsx', 'apps/frontend/src/components/issue/IssueToConing.jsx', 'apps/frontend/src/pages/ReceiveFromMachine.jsx', 'apps/frontend/src/components/receive/ReceiveHistoryTable.jsx', 'apps/frontend/src/components/receive/CutterReceiveForm.jsx', 'apps/frontend/src/components/receive/HoloReceiveForm.jsx', 'apps/frontend/src/components/receive/ConingReceiveForm.jsx', 'apps/frontend/src/components/receive/ManualReceiveForm.jsx', 'apps/frontend/src/components/receive/CutterCsvUpload.jsx', 'apps/frontend/src/pages/OpeningStock.jsx', 'apps/frontend/src/hooks/useV2CursorList.js', 'apps/frontend/src/api/client.js']
code_patterns: ['Legacy tables read from InventoryContext db slices; save handlers call refreshProcessData/refreshModuleData or patchDb', 'v2 history/tracking tables use local paginated cache via useV2CursorList and require explicit refresh()', 'Issue module renders On Machine and History in separate components/tabs with independent v2 list instances', 'Receive history supports history/challan tab state and only enables v2 fetch when history tab is active', 'Opening Stock already uses explicit v2HistoryList.refresh() after save/delete and is the closest existing refresh pattern']
test_patterns: ['No automated test suite in repo', 'Manual verification in module UI flows', 'Console/network validation for list refresh behavior']
---

# Tech-Spec: Real-Time Tracking Table Refresh After Save Across All Modules

**Created:** 2026-02-21 00:21:33 IST

## Overview

### Problem Statement

When users save records in Issue, Receive, Opening Stock, and other module flows, newly created/updated rows do not appear immediately in their corresponding tracking/history tables. Users currently need to reload the page or navigate away and return to the module, causing workflow interruption and stale UI behavior.

### Solution

Implement a consistent post-save data synchronization pattern across modules: apply immediate local UI state reconciliation where practical, then trigger authoritative table re-fetch for the active module context (and related tabs) to guarantee fresh and accurate row visibility without manual reload/navigation.

### Scope

**In Scope:**
- Issue module: ensure saved records are reflected immediately in Issue Tracking, including both `On Machine` (default tab) and `History` after tab switch.
- Receive module: ensure Receive History/table views refresh immediately after save actions.
- Opening Stock: include all relevant tracking/history/list tables so saved records are visible without reload.
- Extend the same refresh reliability to other modules that use save-to-table workflows and currently exhibit stale table state.
- Standardize frontend refresh triggers and data invalidation behavior after successful save operations.

**Out of Scope:**
- Changes to calculation/business logic for issued/received/pending/wastage values.
- Prisma schema/database structural changes.
- Non-related UI redesign or table layout changes.

## Context for Development

### Codebase Patterns

- Two distinct data modes exist in frontend:
  - Legacy mode: components derive rows from `useInventory().db` and react to `refreshProcessData`/`refreshModuleData`/`patchDb`.
  - v2 mode: components derive rows from `useV2CursorList`, which keeps independent local paginated cache and only refreshes when its own `refresh()` is called or params change.
- Issue save forms (`IssueToCutter`, `IssueToHolo`, `IssueToConing`) call backend create APIs and then `refreshProcessData(stage)`; this updates context DB but does not directly refresh v2 On Machine/History caches.
- Receive save forms are inconsistent by design:
  - Cutter/manual/csv forms call `refreshProcessData('cutter')`.
  - Holo/coning forms optimistically patch local DB via `patchDb` and avoid full process refresh.
  - Receive history table itself calls `v2List.refresh()` for in-table edit/delete actions, but external form saves are not coupled to its v2 list lifecycle.
- Issue tab architecture (`IssueToMachine`) mounts either `OnMachineTable` or `IssueHistory`; switching tabs remounts the other component and incidentally fetches fresh v2 data, which explains why users currently see updates only after tab/module navigation.
- Opening Stock already applies explicit `v2HistoryList.refresh()` after save/delete flows; this pattern is more reliable and should be generalized.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/frontend/src/context/InventoryContext.jsx` | Shared refresh primitives (`refreshProcessData`, `refreshModuleData`, `patchDb`) and current module data loading strategy. |
| `apps/frontend/src/hooks/useV2CursorList.js` | v2 paginated cache behavior and explicit `refresh()` mechanism. |
| `apps/frontend/src/pages/IssueToMachine.jsx` | Issue tabs (`On Machine` / `History`) mount boundaries and current data-flow separation. |
| `apps/frontend/src/components/issue/OnMachineTable.jsx` | v2 On Machine list (`scopeKey: on-machine:{process}`) and stale-cache risk point after external saves. |
| `apps/frontend/src/pages/IssueHistory.jsx` | v2 Issue Tracking history list (`scopeKey: issue-history:{process}`), including existing in-component refresh actions. |
| `apps/frontend/src/components/issue/IssueToCutter.jsx` | Cutter issue save flow currently calling `createIssueToMachine` + process refresh only. |
| `apps/frontend/src/components/issue/IssueToHolo.jsx` | Holo issue save flow currently calling `refreshProcessData('holo')`. |
| `apps/frontend/src/components/issue/IssueToConing.jsx` | Coning issue save flow currently calling `refreshProcessData('coning')`. |
| `apps/frontend/src/pages/ReceiveFromMachine.jsx` | Receive page composition of stage forms + `ReceiveHistoryTable`. |
| `apps/frontend/src/components/receive/ReceiveHistoryTable.jsx` | v2 Receive History cache, active-tab gating, and in-component refresh behavior. |
| `apps/frontend/src/components/receive/CutterReceiveForm.jsx` | Cutter receive save flow currently calling `refreshProcessData('cutter')`. |
| `apps/frontend/src/components/receive/HoloReceiveForm.jsx` | Holo receive save flow using optimistic `patchDb` without mandatory v2 invalidation. |
| `apps/frontend/src/components/receive/ConingReceiveForm.jsx` | Coning receive save flow using optimistic `patchDb` without mandatory v2 invalidation. |
| `apps/frontend/src/components/receive/ManualReceiveForm.jsx` | Manual receive save flow calling `refreshProcessData('cutter')`. |
| `apps/frontend/src/components/receive/CutterCsvUpload.jsx` | CSV import save flow calling `refreshProcessData('cutter')`. |
| `apps/frontend/src/pages/OpeningStock.jsx` | Existing good reference: save/delete handlers already call `v2HistoryList.refresh()` under v2 mode. |
| `apps/frontend/src/api/client.js` | Shared API request layer; candidate anchor for centralized post-mutation invalidation signal if adopted. |

### Technical Decisions

- Root cause decision: stale table visibility is primarily a frontend cache invalidation orchestration issue, not backend persistence latency.
- Keep backend API contracts unchanged; focus implementation on frontend post-save invalidation consistency.
- Standardize to a hybrid policy across modules:
  - Fast local update when already available (`patchDb` / immediate UI response).
  - Guaranteed authoritative refresh for all relevant tracking/history v2 lists.
- Introduce a shared, process-aware invalidation trigger that external save forms can emit and table/list components can subscribe to, so refresh does not depend on tab remounts.
- Ensure cross-tab reliability in Issue module: save in current context must refresh both On Machine and History datasets (immediately for active view, and on next visibility for inactive tab without requiring module navigation).
- Preserve Opening Stock behavior and align other modules to the same reliability level.

## Implementation Plan

### Tasks

- [x] Task 1: Add a shared post-mutation invalidation bus in Inventory context
  - File: `apps/frontend/src/context/InventoryContext.jsx`
  - Action: Add a lightweight publish/subscribe mechanism for "data changed" events scoped by module/process/table keys (for example: `issue:on-machine:cutter`, `issue:history:holo`, `receive:history:coning`, `opening-stock:history:holo`).
  - Notes: Keep API backward-compatible with existing consumers; expose helper methods on context value (emit + subscribe hook-safe wrapper).

- [x] Task 2: Define and centralize invalidation key constants
  - File: `apps/frontend/src/context/InventoryContext.jsx`
  - Action: Add explicit key mapping utilities to avoid string drift across forms/tables.
  - Notes: Include issue, receive, and opening-stock mappings; keep stage/process normalized (`cutter|holo|coning`).

- [x] Task 3: Wire Issue tracking table consumers to invalidate and refresh v2 list cache
  - File: `apps/frontend/src/components/issue/OnMachineTable.jsx`
  - Action: Subscribe to issue invalidation keys for current `process`; call `v2List.refresh()` when v2 mode is enabled and local filter state must be preserved.
  - Notes: Do not reset user-entered filters/search; only refresh list data.

- [x] Task 4: Wire Issue history consumer to invalidate and refresh v2 list cache
  - File: `apps/frontend/src/pages/IssueHistory.jsx`
  - Action: Subscribe to issue-history invalidation keys for current `process`; call `v2List.refresh()` on external save signals.
  - Notes: Keep existing in-component refresh logic for delete/edit; this task covers refresh from external forms.

- [x] Task 5: Emit issue invalidation events after successful issue saves
  - File: `apps/frontend/src/components/issue/IssueToCutter.jsx`
  - Action: After successful issue creation, emit invalidation for both `issue:on-machine:{process}` and `issue:history:{process}`.
  - Notes: Preserve existing refresh behavior; emission is additive for deterministic v2 refresh.

- [x] Task 6: Emit issue invalidation events for holo/coning issue saves
  - File: `apps/frontend/src/components/issue/IssueToHolo.jsx`
  - Action: Emit issue invalidation signals after successful holo issue save.
  - Notes: Keep existing print and process refresh flow unchanged.
  - File: `apps/frontend/src/components/issue/IssueToConing.jsx`
  - Action: Emit issue invalidation signals after successful coning issue save.
  - Notes: Keep existing trace/print behavior unchanged.

- [x] Task 7: Emit receive-history invalidation events from all receive save entry points
  - File: `apps/frontend/src/components/receive/CutterReceiveForm.jsx`
  - Action: Emit `receive:history:cutter` invalidation after successful challan save.
  - Notes: Keep `refreshProcessData('cutter')` in place for legacy mode.
  - File: `apps/frontend/src/components/receive/ManualReceiveForm.jsx`
  - Action: Emit `receive:history:cutter` after successful manual save.
  - Notes: Preserve existing cart/reset behavior.
  - File: `apps/frontend/src/components/receive/CutterCsvUpload.jsx`
  - Action: Emit `receive:history:cutter` after successful import save.
  - Notes: Preserve preview/import UX.
  - File: `apps/frontend/src/components/receive/HoloReceiveForm.jsx`
  - Action: Emit `receive:history:holo` after successful save and `patchDb` update.
  - Notes: Keep optimistic local patch; invalidation guarantees server-authoritative list refresh.
  - File: `apps/frontend/src/components/receive/ConingReceiveForm.jsx`
  - Action: Emit `receive:history:coning` after successful save and `patchDb` update.
  - Notes: Keep optimistic local patch and wastage flow.

- [x] Task 8: Wire Receive history table consumer to shared invalidation events
  - File: `apps/frontend/src/components/receive/ReceiveHistoryTable.jsx`
  - Action: Subscribe to receive-history invalidation for active `process`; call `v2List.refresh()`.
  - Notes: When `activeTab` is not history (cutter challan tab), queue/persist a dirty flag so switching back to history immediately refreshes.

- [x] Task 9: Normalize Opening Stock invalidation to same shared mechanism
  - File: `apps/frontend/src/pages/OpeningStock.jsx`
  - Action: Keep existing `v2HistoryList.refresh()` after save/delete, and additionally emit shared opening-stock history invalidation key so behavior is consistent with other modules.
  - Notes: Ensure stage-specific v2 history refresh still uses current stage and filters.

- [x] Task 10: Ensure top-level pages pass through any required refresh bridge props/context access
  - File: `apps/frontend/src/pages/IssueToMachine.jsx`
  - Action: Confirm no extra prop drilling is needed; if required, wire context access for invalidation at page level.
  - Notes: Keep tab UX unchanged.
  - File: `apps/frontend/src/pages/ReceiveFromMachine.jsx`
  - Action: Confirm receive forms and history table share the invalidation channel for current process.
  - Notes: Avoid introducing duplicate refresh calls.

- [x] Task 11: Add optional guardrails for future mutations in API layer
  - File: `apps/frontend/src/api/client.js`
  - Action: Document or expose a narrow helper for mutation completion hooks (if needed by architecture decision) without changing endpoint signatures.
  - Notes: This is optional scaffolding; do not block core fix if unnecessary.

- [x] Task 12: Verify `useV2CursorList.refresh()` semantics remain suitable for preserving filters and replacing page-1 data
  - File: `apps/frontend/src/hooks/useV2CursorList.js`
  - Action: Confirm refresh resets cursor/items but keeps external query params; adjust only if a bug is found during implementation.
  - Notes: No feature change expected unless identified during implementation.

### Acceptance Criteria

- [ ] AC 1: Given Issue module is open on `On Machine` for any process, when a new issue is saved successfully, then the new/updated row visibility is reflected without page reload.
- [ ] AC 2: Given Issue module defaulted to `On Machine`, when user saves an issue and then switches to `History`, then `History` shows updated data without navigating away from the module.
- [ ] AC 3: Given Receive module is open on `History` for any process, when a receive is saved successfully from any receive form (manual, scan, csv, holo, coning), then the history table reflects the new row/state without page reload.
- [ ] AC 4: Given Receive module is on cutter `Challan` tab at save time, when user later switches to `History`, then history fetches fresh data immediately and shows the saved row.
- [ ] AC 5: Given Opening Stock v2 history is active, when user saves or deletes opening stock records, then the current stage history table refreshes and shows updated rows immediately.
- [ ] AC 6: Given v2 feature flags are enabled, when a mutation succeeds, then affected v2 list caches are invalidated via shared mechanism and refreshed deterministically.
- [ ] AC 7: Given v2 feature flags are disabled, when a mutation succeeds, then existing legacy refresh behavior continues to work with no regression.
- [ ] AC 8: Given active filters/search/date range are applied in tracking/history tables, when invalidation refresh occurs after save, then filter/search/date state remains intact while data updates.
- [ ] AC 9: Given save fails due to API error, when mutation does not succeed, then no success invalidation event is emitted and no false-positive table update is shown.
- [ ] AC 10: Given user performs repeated quick saves, when multiple invalidations fire close together, then UI remains stable (no infinite refresh loop, no crash) and eventually shows current server state.

## Additional Context

### Dependencies

- Frontend dependencies already present in repository:
  - React state/effect lifecycle for event subscription.
  - Inventory context as central shared runtime state.
  - Existing v2 endpoints (`/api/v2/on-machine/:process`, `/api/v2/issue/:process/tracking`, `/api/v2/receive/:process/history`, `/api/v2/opening-stock/:stage/history`).
- No new external library dependency is required.
- Requires consistent process/stage naming across emitters and subscribers.

### Testing Strategy

- Unit tests:
  - Not currently configured in repo; no new automated tests are required by current project constraints.
- Integration/manual verification matrix:
  - Issue `cutter/holo/coning`: save issue from respective form and verify On Machine and History refresh behavior.
  - Receive `cutter/holo/coning`: save receive and verify Receive History immediate visibility.
  - Receive cutter challan-tab scenario: save while not on history, then switch to history and verify immediate updated rows.
  - Opening Stock `inbound/cutter/holo/coning`: save and delete rows, verify stage-specific history refresh.
  - Toggle v2 flags (where available) to verify both v2 and legacy behaviors are non-regressive.
  - Apply filters/search/date before save; verify those controls persist after refresh.
- Observability checks:
  - Use browser network panel to confirm post-save list GET calls are made for affected datasets.
  - Confirm no repeated refresh loop calls are triggered.

### Notes

- High-risk item: over-refreshing multiple lists on every mutation can cause redundant network load; invalidation keys should stay narrowly scoped.
- High-risk item: multiple mounted components for same process could subscribe simultaneously; ensure cleanup/unsubscribe on unmount to prevent memory leaks.
- Known limitation: if backend persistence is delayed by eventual consistency (not expected here), immediate fetch may still briefly miss rows; fallback remains subsequent invalidation-triggered fetch on next action/tab visibility.
- Future consideration (out of scope): unify all module table data under a standard query cache library to remove custom invalidation plumbing.
- Future consideration (out of scope): add automated integration tests for save-to-table freshness guarantees once test framework is introduced.

## Review Notes
- Adversarial review completed
- Findings: 10 total, 8 fixed, 2 skipped
- Resolution approach: auto-fix
