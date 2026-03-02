---
title: 'Coning Take-Back: Free Source Selection with Shared Pool Constraint'
slug: 'coning-takeback-free-source-selection'
created: '2026-02-28'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React', 'Node.js', 'Prisma', 'PostgreSQL']
files_to_modify:
  - 'apps/frontend/src/components/issue/OnMachineTable.jsx'
  - 'apps/backend/src/routes/index.js'
code_patterns: ['FIFO allocation', 'shared pool constraint', 'live max recompute']
test_patterns: []
---

# Tech-Spec: Coning Take-Back — Free Source Selection with Shared Pool Constraint

**Created:** 2026-02-28

---

## Overview

### Problem Statement

When performing a take-back from an Issue-to-Coning-Machine record that has multiple holo barcodes (crates/greats), the system currently uses a FIFO algorithm to determine which barcode has "remaining" allocation. This means that in practice only the **last** barcode (the one not yet exhausted by FIFO) appears in the take-back modal — even if physically the operator wants to return rolls from an earlier barcode. The user cannot choose which specific source/barcode to take back from.

### Solution

1. **Remove FIFO filtering from the frontend** so the take-back modal shows **all** barcodes from the issue's `receivedRowRefs`, each with its own per-source cap (`issuedWeight − activeTakeBack`).
2. **Add a real-time shared pool constraint** in the modal: all rows share the issue's `pendingWeight` as a common pool. As the user enters weight in one row, the other rows' effective maximums shrink live, and their inputs are disabled when the pool is exhausted.
3. **Relax the per-source backend validation for coning** from `original − activeTakeBack − FIFO_consumed` to `original − activeTakeBack`. The issue-level total guard (`totalWeight ≤ pendingWeight`) remains the authoritative safety check.

### Scope

**In Scope:**
- `OnMachineTable.jsx` — `buildTakeBackSources` coning branch: remove FIFO allocation
- `OnMachineTable.jsx` — `openTakeBackModal`: initialize coning lines at 0 (not auto-filled to max)
- `OnMachineTable.jsx` — take-back modal UI: add live shared pool constraint (effectiveMax per row)
- `index.js` — `createIssueTakeBackForStage`: skip FIFO-consumed deduction for coning per-source validation
- Change applies to **coning only** — holo and cutter take-back are unchanged

**Out of Scope:**
- Holo or cutter take-back logic
- Barcode scanner input in the take-back modal
- Reversal logic (`reverseIssueTakeBack`)
- V2 on-machine path (`v2Enabled` flag)
- Any database schema changes

---

## Context for Development

### How the Current Coning Take-Back Works (Deep Investigation Results)

#### Data path for coning `receivedRowRefs`

`IssueToConingMachine.receivedRowRefs` is a JSON array stored on the issue record:
```json
[
  { "rowId": "<holoReceiveRowId>", "issueRolls": 5, "issueWeight": 10.0, "barcode": "BC-001" },
  { "rowId": "<holoReceiveRowId>", "issueRolls": 5, "issueWeight": 10.0, "barcode": "BC-002" },
  { "rowId": "<holoReceiveRowId>", "issueRolls": 5, "issueWeight": 10.0, "barcode": "BC-003" }
]
```
These are the barcodes the user scanned when creating the issue. Their order determines FIFO sequence.

#### Current FIFO block in `buildTakeBackSources` (frontend, lines 550–605)

```
OnMachineTable.jsx:550  if (process === 'coning') {
OnMachineTable.jsx:554    // builds receivedBySource from sourceRowRefs on coning receive rows
OnMachineTable.jsx:577    let remainingToAllocate = ...totalIssueConsumedWeight - receivedAllocatedTotal
OnMachineTable.jsx:581    for (const line of sourceMap.values()) {
OnMachineTable.jsx:586      // extra allocation from remainingToAllocate (FIFO)
OnMachineTable.jsx:593      const remainingWeight = clampZero(issuedWeight - receivedAllocatedWeight)
OnMachineTable.jsx:604    }
```
Result: first sources get consumed weight assigned first → their `maxWeight` reaches 0 → filtered out at line 529 (`if (maxWeight <= 0.0001) return`).

#### Current per-source validation in backend (`createIssueTakeBackForStage`, lines 3175–3194)

```javascript
// index.js:3183
const lineRemainingWeight = clampZero(
  original.weight - activeTakeBack.weight - consumed.weight  // ← consumed = FIFO
);
if (line.weight - lineRemainingWeight > TAKE_BACK_EPSILON) {
  throw new Error(`Requested weight exceeds remaining allocation for source ${line.sourceId}`);
}
```
`consumed` comes from `buildTakeBackConsumedBySource` (lines 678–761) which applies the same FIFO heuristic. If the frontend sends a take-back for an "earlier" source that FIFO said was consumed, the backend rejects it.

#### Issue-level total guard (unchanged, lines 3198–3203)

```javascript
if (totalWeight - pending.pendingWeight > TAKE_BACK_EPSILON) {
  throw new Error('Take-back exceeds issue pending weight');
}
```
This is the real safety net — it stays exactly as-is.

#### `pendingWeight` available on entry object

In `openTakeBackModal`, `entry.pendingWeight` holds the issue's current pending weight (computed by backend `getIssuePending` and returned in `issueBalance`). This is the shared pool value.

#### Helper functions relevant to coning modal

- `calcConingTakeBackNetWeight(line, grossWeightInput, nextBoxId)` → line 87: computes `net = gross - boxWeight`, capped at `line.maxWeight`
- `roundTakeBackWeight(value)` → line 63: rounds to 3 decimal places
- `boxById` map → available in component scope

### Codebase Patterns

- **State for draft lines**: `takeBackLinesDraft` is a `useState` array; rows are updated via `setTakeBackLinesDraft(prev => prev.map(...))`.
- **Disabling inputs**: checked via `disabled={Number(line.maxWeight || 0) <= 0.0001}` on line 1768/1849 — same pattern used for the effectiveMax check.
- **Weight field is `readOnly` for coning/holo**: line 1857 — the gross weight drives net weight via `calcConingTakeBackNetWeight`.
- **Submission filter**: line 666 — already filters out lines with `weight <= 0.0001`, so zero-weight coning rows are not sent.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/frontend/src/components/issue/OnMachineTable.jsx` | All take-back UI + source-building logic |
| `apps/backend/src/routes/index.js` | `createIssueTakeBackForStage`, `buildTakeBackConsumedBySource` |
| `apps/backend/prisma/schema.prisma` | `IssueToConingMachine`, `IssueTakeBack`, `IssueTakeBackLine` models |

### Technical Decisions

- **Initialize coning lines at 0, not max**: Because all 3 sources are now visible, auto-filling all to max would immediately exceed the pool. User must deliberately enter weights.
- **effectiveMax computed at render time, not stored in state**: Avoids stale state issues. Derive it inline from `takeBackLinesDraft` during render.
- **Pool = `takeBackTarget.pendingWeight`**: This is the pre-computed issue-level pending weight already on the entry object. No extra API call needed.
- **Backend change is coning-only**: Add a `stage === 'coning'` branch — do not touch holo or cutter paths.

---

## Implementation Plan

### Tasks

#### [x] Task 1 — Frontend: Remove FIFO from `buildTakeBackSources` (coning branch)

**File:** `apps/frontend/src/components/issue/OnMachineTable.jsx`
**Location:** Lines 550–605 (the `if (process === 'coning')` block)

**Replace** the entire coning block with:

```javascript
if (process === 'coning') {
    const updated = [];
    for (const line of sourceMap.values()) {
        const issuedWeight = clampZero(Number(line.maxWeight || 0));
        // maxWeight here is already: original issued − active take-backs (built in sourceMap above, lines 526-528)
        // No FIFO consumed deduction — user selects source freely; pool is enforced at issue level
        updated.push({
            ...line,
            issuedWeight,
            maxWeight: issuedWeight,
            maxCount: clampZero(Number(line.maxCount || 0)),
        });
    }
    // Filter out sources that are fully taken back (no remaining issued allocation)
    return updated.filter((s) => s.maxWeight > 0.0001);
}
```

**What this does:**
- Removes the `receivedBySource` build, `hasAnyRefs` flag, `remainingToAllocate` FIFO loop
- Each source's `maxWeight = original issued − active take-backs` (already computed in `sourceMap` at line 527-528)
- All 3 barcodes now appear as long as they have any un-taken-back issued weight

---

#### [x] Task 2 — Frontend: Initialize coning modal lines at zero

**File:** `apps/frontend/src/components/issue/OnMachineTable.jsx`
**Location:** `openTakeBackModal` function, lines 616–648 (the `sources.map(...)` block)

In the existing map, find the `count` initialization:
```javascript
const count = process === 'cutter' ? 0 : line.maxCount;
```
Change to:
```javascript
const count = (process === 'cutter' || process === 'coning') ? 0 : line.maxCount;
```

Then find the `grossWeight` initialization:
```javascript
const grossWeight = process === 'holo'
    ? roundTakeBackWeight(Number(line.maxWeight || 0) + tareEstimate)
    : (process === 'coning'
        ? roundTakeBackWeight(Number(line.maxWeight || 0) + tareEstimate)
        : 0);
```
Change to:
```javascript
const grossWeight = process === 'holo'
    ? roundTakeBackWeight(Number(line.maxWeight || 0) + tareEstimate)
    : 0;
```

Then find the `weight` initialization for coning:
```javascript
: (process === 'coning'
    ? calcConingTakeBackNetWeight(line, grossWeight, boxId)
    : ...
```
Because `grossWeight` is now 0, `calcConingTakeBackNetWeight` already returns 0 — no extra change needed here.

**What this does:** All coning lines open with `grossWeight = 0`, `weight = 0`, `count = 0`. The user enters values manually.

---

#### [x] Task 3 — Frontend: Add shared pool constraint to modal render

**File:** `apps/frontend/src/components/issue/OnMachineTable.jsx`
**Location:** Inside the `takeBackLinesDraft.map((line, idx) => ...)` block, lines 1746–1861

**Step 3a:** Before the `.map(...)`, add a pool computation for the coning case. Find the line:
```javascript
takeBackLinesDraft.map((line, idx) => (
```
Insert above it:
```javascript
const issuePendingPool = process === 'coning'
    ? Math.max(0, Number(takeBackTarget?.pendingWeight || 0))
    : Infinity;
const totalEnteredWeight = process === 'coning'
    ? takeBackLinesDraft.reduce((sum, l) => sum + Math.max(0, Number(l.weight || 0)), 0)
    : 0;
```

**Step 3b:** Inside the map callback, after `(line, idx) => (`, add the per-row effective max:
```javascript
const otherLinesWeight = process === 'coning'
    ? totalEnteredWeight - Math.max(0, Number(line.weight || 0))
    : 0;
const effectiveMaxWeight = process === 'coning'
    ? Math.max(0, Math.min(
        Number(line.maxWeight || 0),
        issuePendingPool - otherLinesWeight
      ))
    : Number(line.maxWeight || 0);
const isRowDisabled = effectiveMaxWeight <= 0.0001;
```

**Step 3c:** Update the **Count input** `disabled` prop (line 1768):
```javascript
// Before:
disabled={Number(line.maxWeight || 0) <= 0.0001}
// After:
disabled={isRowDisabled}
```

**Step 3d:** Update the **Gross Weight input** `disabled` prop (currently not disabled — add it):
```javascript
// In the gross weight <input> (around line 1820), add:
disabled={isRowDisabled}
```

**Step 3e:** Update the **Weight input** `disabled` prop (line 1849) and `max`:
```javascript
// Before:
disabled={Number(line.maxWeight || 0) <= 0.0001}
max={line.maxWeight || 0}
// After:
disabled={isRowDisabled}
max={effectiveMaxWeight}
```

**Step 3f:** Update `calcConingTakeBackNetWeight` call in the gross weight `onChange` (line 1833) to cap against `effectiveMaxWeight`. Find inside the gross weight onChange:
```javascript
weight: process === 'holo'
    ? calcHoloTakeBackNetWeight(l, l.count, grossWeight, l.boxId)
    : calcConingTakeBackNetWeight(l, grossWeight, l.boxId),
```
The cap inside `calcConingTakeBackNetWeight` uses `line.maxWeight` (line 93-94). Since `effectiveMaxWeight` varies per render, pass it as an override. The simplest approach without changing the helper signature: after computing `weight` from `calcConingTakeBackNetWeight`, clamp it inline:

```javascript
// In the gross weight onChange, for coning weight re-computation:
const rawWeight = calcConingTakeBackNetWeight(l, grossWeight, l.boxId);
// Recompute effective max for this line within the updater:
const otherWeight = (prev || []).reduce((s, x, xi) => xi === idx ? s : s + Math.max(0, Number(x.weight || 0)), 0);
const effMax = Math.max(0, Math.min(Number(l.maxWeight || 0), issuePendingPool - otherWeight));
const clampedWeight = roundTakeBackWeight(Math.max(0, Math.min(effMax, rawWeight)));
return { ...l, grossWeight, weight: clampedWeight };
```

**Step 3g:** Add a pool summary line above the table. Find the `<div className="rounded-md border overflow-auto">` wrapper (line 1726). Insert above it:
```jsx
{process === 'coning' && (
    <div className="text-xs text-muted-foreground flex items-center gap-2">
        <span>Issue Pending: <strong>{formatKg(issuePendingPool)}</strong></span>
        <span>·</span>
        <span>Entered: <strong>{formatKg(totalEnteredWeight)}</strong></span>
        <span>·</span>
        <span>Remaining: <strong>{formatKg(Math.max(0, issuePendingPool - totalEnteredWeight))}</strong></span>
    </div>
)}
```

Note: `issuePendingPool` and `totalEnteredWeight` are computed above the map, so they are accessible here.

---

#### [x] Task 4 — Backend: Relax per-source validation for coning

**File:** `apps/backend/src/routes/index.js`
**Location:** `createIssueTakeBackForStage`, lines 3175–3194

Find:
```javascript
for (const line of requestedBySource) {
    const originalLine = originalMap.get(line.sourceId);
    if (!originalLine) {
        throw new Error(`Source ${line.sourceId} does not belong to issue ${issueId}`);
    }
    const takenBackLine = activeTakeBackBySource.get(line.sourceId) || { count: 0, weight: 0 };
    const consumedLine = consumedBySource.get(line.sourceId) || { count: 0, weight: 0 };

    const lineRemainingWeight = clampZero(Number(originalLine.weight || 0) - Number(takenBackLine.weight || 0) - Number(consumedLine.weight || 0));
    const lineRemainingCount = clampZero(Number(originalLine.count || 0) - Number(takenBackLine.count || 0) - Number(consumedLine.count || 0));
```

Change the `lineRemainingWeight` and `lineRemainingCount` computation to be conditional on stage:
```javascript
    const takenBackLine = activeTakeBackBySource.get(line.sourceId) || { count: 0, weight: 0 };
    const consumedLine = consumedBySource.get(line.sourceId) || { count: 0, weight: 0 };

    // For coning: skip FIFO-consumed deduction. The user selects source freely;
    // the issue-level pendingWeight check below is the authoritative guard.
    // For cutter/holo: keep existing per-source consumed deduction.
    const lineRemainingWeight = stage === 'coning'
        ? clampZero(Number(originalLine.weight || 0) - Number(takenBackLine.weight || 0))
        : clampZero(Number(originalLine.weight || 0) - Number(takenBackLine.weight || 0) - Number(consumedLine.weight || 0));
    const lineRemainingCount = stage === 'coning'
        ? clampZero(Number(originalLine.count || 0) - Number(takenBackLine.count || 0))
        : clampZero(Number(originalLine.count || 0) - Number(takenBackLine.count || 0) - Number(consumedLine.count || 0));
```

**The issue-level check at lines 3198–3203 is NOT changed** — it remains the total pool guard.

---

### Acceptance Criteria

#### AC-1: All sources visible in take-back modal

**Given** an Issue-to-Coning record with 3 barcodes (BC-001 10 kg, BC-002 10 kg, BC-003 10 kg) and 20 kg received from the coning machine,
**When** the user opens the take-back modal,
**Then** all 3 barcodes appear as rows in the table (not just BC-003), each showing their issued weight and active take-back amounts.

#### AC-2: Modal initializes at zero

**Given** the take-back modal opens for a coning issue with multiple sources,
**When** the modal renders,
**Then** all weight, count, and gross weight fields are initialized to 0 (blank/zero), and the user must manually enter values.

#### AC-3: Pool display is correct

**Given** an issue with pending weight of 10 kg,
**When** the modal opens,
**Then** a summary line shows "Issue Pending: 10.000 kg · Entered: 0.000 kg · Remaining: 10.000 kg".

#### AC-4: Single source exhausts pool

**Given** pool = 10 kg, 3 sources each with maxWeight = 10 kg,
**When** user enters gross weight for BC-001 that results in net weight = 10 kg,
**Then** BC-002 and BC-003 count/gross/weight inputs are disabled (effectiveMax = 0).

#### AC-5: Partial entry leaves remaining pool

**Given** pool = 10 kg,
**When** user enters 9 kg net for BC-001,
**Then** BC-002 effectiveMax = 1 kg, BC-003 effectiveMax = 1 kg, both inputs enabled.

#### AC-6: Two partial entries restrict third

**Given** pool = 10 kg and 9 kg entered for BC-001,
**When** user enters 0.5 kg net for BC-002,
**Then** BC-003 effectiveMax = 0.5 kg; BC-003 weight input is enabled but capped at 0.5 kg.

#### AC-7: Pool fully consumed disables all

**Given** pool = 10 kg, BC-001 = 9 kg, BC-002 = 0.5 kg, BC-003 = 0.5 kg,
**When** the last entry is confirmed,
**Then** all inputs are disabled, remaining pool shows 0.000 kg.

#### AC-8: Backend accepts any valid source combination

**Given** a coning take-back submitted with BC-001 = 10 kg (total = 10 kg = pendingWeight),
**When** the backend processes it,
**Then** it succeeds — even though FIFO would have said BC-001 was consumed.

#### AC-9: Backend rejects over-source-cap

**Given** BC-001 was originally issued 10 kg and already has an active take-back of 10 kg,
**When** another take-back for BC-001 is submitted,
**Then** backend returns error "Requested weight exceeds remaining allocation for source BC-001".

#### AC-10: Backend rejects over-pool-total

**Given** issue pending weight = 5 kg,
**When** a take-back is submitted with total weight = 6 kg across any sources,
**Then** backend returns error "Take-back exceeds issue pending weight".

#### AC-11: Holo and cutter take-back unchanged

**Given** any holo or cutter issue take-back flow,
**When** the user opens the take-back modal and submits,
**Then** behavior is identical to before this change (FIFO still applies to those processes).

---

## Additional Context

### Dependencies

- No schema migrations required
- No new API endpoints
- No new npm packages

### Testing Strategy

- Manual test: Create an Issue-to-Coning with 3 barcodes. Partially receive. Verify all 3 barcodes appear in take-back modal.
- Manual test: Enter weight on one source and verify other sources' inputs disable when pool is exhausted.
- Manual test: Submit take-back selecting a source that FIFO would have blocked. Verify backend accepts it.
- Manual test: Verify holo and cutter take-back modals are unaffected.

### Notes

- The `calcConingTakeBackNetWeight` helper (line 87) uses `line.maxWeight` to cap net weight. In the gross weight `onChange`, we must recompute the effective pool cap inline (within the `setTakeBackLinesDraft` updater) because `effectiveMaxWeight` from render scope may be stale inside the updater. Use `prev.reduce(...)` to compute `otherWeight` from current draft state.
- `issuePendingPool` and `totalEnteredWeight` must be computed **outside** the `takeBackLinesDraft.map(...)` call so they are in scope for the pool summary display above the table.
- The `sourceMap` in `buildTakeBackSources` already deducts `activeBySource` from `maxWeight/maxCount` at lines 527–528, so Task 1 does not need to redo that computation.

## Review Notes

- Adversarial review completed 2026-02-28
- Findings: 12 total, 2 fixed, 10 skipped
- Resolution approach: auto-fix
- F-03 fixed: Added pool total pre-submit validation in `submitTakeBack` for coning
- F-07 fixed: Added early return in `buildTakeBackConsumedBySource` for coning to skip wasteful FIFO computation
- F-01 acknowledged as by-design (tech-spec intent); F-04/F-05 noise; F-02/F-06/F-08/F-09/F-10/F-11/F-12 deferred (backend guards, pre-existing patterns, or theoretical edge cases)
