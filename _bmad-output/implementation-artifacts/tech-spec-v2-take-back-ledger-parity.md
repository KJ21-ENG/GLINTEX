---
title: 'V2 Take-Back Ledger with Filter Parity'
slug: 'v2-take-back-ledger-parity'
created: '2026-02-21T05:59:35.041Z'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4, 5, 6]
tech_stack: ['Node.js', 'Express', 'Prisma', 'React', 'TailwindCSS']
files_to_modify: ['apps/backend/src/routes/v2.js', 'apps/frontend/src/api/v2.js', 'apps/frontend/src/pages/IssueHistory.jsx']
code_patterns: ['Backend: Express Router, Prisma findMany with cursor', 'Frontend: useV2CursorList hook', 'Frontend: Infinite Scroll Sentinel']
test_patterns: ['Manual Validation']
---

# Tech-Spec: V2 Take-Back Ledger with Filter Parity

**Created:** 2026-02-21T05:59:35.041Z

## Review Notes
- Adversarial review completed.
- Findings: 1 total, 1 fixed, 0 skipped.
- Resolution approach: auto-fix (Increased search limit).

## Overview

### Problem Statement

The Take-Back Ledger in Issue History is empty in V2 mode, creating a mismatch with the "Grand Total" summary which correctly shows taken-back weight.

### Solution

Implement a new V2 endpoint for fetching filtered take-back records with infinite scroll, and integrate it into the `IssueHistory` component to display the ledger, ensuring consistency with the main issue list filters.

### Scope

**In Scope:**
- Backend: `GET /api/v2/issue/:process/take-back-history` endpoint supporting filters (date, search) and cursor-based pagination.
- Frontend: new API client method `getV2TakeBackHistory`.
- Frontend: Integrate separate `useV2CursorList` hook for the Ledger in `IssueHistory.jsx`.
- Frontend: Update Ledger UI to use the new data source and support infinite scroll.
- Frontend: Ensure 'Reverse' action works for V2 items.

**Out of Scope:**
- Changes to legacy behavior.
- modifying other parts of `IssueHistory`.

## Context for Development

### Codebase Patterns

- **Backend V2 Endpoints**: Located in `apps/backend/src/routes/v2.js`. Use `requireAuth`, `requireStageReadPermission`. Return `{ items, nextCursor, hasMore, summary }`.
- **Frontend V2 Lists**: Use `useV2CursorList` hook. Fetch data via `api/v2.js`. Use `useInfiniteScrollSentinel` for pagination.
- **Take-Back Model**: `IssueTakeBack` in Prisma. Linked to `Issue` via `issueId`. Contains `totalWeight`, `totalCount`, `reason`, `note`.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/backend/src/routes/v2.js` | Add new `GET /issue/:process/take-back-history` endpoint. |
| `apps/frontend/src/api/v2.js` | Add `getV2TakeBackHistory` client function. |
| `apps/frontend/src/pages/IssueHistory.jsx` | Implement V2 Ledger using `useV2CursorList`. |
| `apps/backend/prisma/schema.prisma` | Reference `IssueTakeBack` model. |

### Technical Decisions

- **Separate API Endpoint**: We will create a dedicated endpoint for take-backs rather than embedding them in the issue list response, as they are a separate list in the UI and can be large.
- **Consistent Filtering**: The take-back query will respect the same `dateFrom`, `dateTo`, and `search` parameters as the main issue list to ensure the Ledger matches the "Grand Total" summary.
- **Infinite Scroll**: We will implement infinite scroll for the Ledger to handle potentially large histories, mirroring the main issue list behavior.
- **Manual Relation Resolution**: Since `IssueTakeBack` has a polymorphic-like relationship with issues (dependent on `stage`), we cannot use Prisma `include`. We will fetch take-backs first, then fetch the related issues by ID to populate barcode/item details.

## Implementation Plan

### Tasks

- [x] Task 1: Create Backend Endpoint for Take-Back History
  - File: `apps/backend/src/routes/v2.js`
  - Action: Add `GET /issue/:process/tracking/take-backs` endpoint.
  - Notes: Implement cursor pagination, date filtering, and search (by note/reason or joined issue barcode). Resolve user and issue details for response.

- [x] Task 2: Add Frontend API Client Method
  - File: `apps/frontend/src/api/v2.js`
  - Action: Add `getV2TakeBackHistory` function calling the new endpoint.

- [x] Task 3: Integrate V2 Ledger in IssueHistory
  - File: `apps/frontend/src/pages/IssueHistory.jsx`
  - Action: Initialize `useV2CursorList` for take-backs. Replace `stageTakeBacks` usage with the new list items when `v2Enabled` is true. Add `useInfiniteScrollSentinel` for the ledger container.

### Acceptance Criteria

- [x] AC1: Given V2 mode is enabled, when I open Issue History, the "Take-Back Ledger" displays take-back records.
- [x] AC2: When I filter by date range, the Ledger only shows take-backs within that range.
- [x] AC3: When I search by barcode, the Ledger shows take-backs associated with that issue.
- [x] AC4: When I scroll down the Ledger, more records load (infinite scroll).
- [x] AC5: When I click "Reverse" on a V2 take-back, it is reversed and removed from the list (or marked reversed).
- [x] AC6: The data in the Ledger matches the "Grand Total" taken-back weight (sum of all filtered records).

## Additional Context

### Dependencies

- None.

### Testing Strategy

- **Manual Validation:**
  - Create a take-back in V2 mode.
  - Verify it appears in the Ledger.
  - Change date filter to exclude it -> verify it disappears.
  - Search for the issue barcode -> verify it appears.
  - Scroll down (if enough data) -> verify loading.
  - Reverse it -> verify it is removed/updated and Grand Total decreases.

### Notes

- The `IssueTakeBack` model does not have a direct Prisma relation to the specific issue tables (`IssueToCutterMachine` etc). Logic must handle fetching the related issue details manually by `issueId` and `stage`.
