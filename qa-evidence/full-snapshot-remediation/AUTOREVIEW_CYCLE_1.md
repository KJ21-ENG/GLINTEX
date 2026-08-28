# Autoreview cycle 1

Date: 2026-08-28
Engine: Codex GPT-5.6 Sol, high reasoning
Scope: P0, P1, and P2 with direct normal-user impact
Result before triage: blocked with six candidates

## Accepted and corrected

1. Production API origin fallback
   - Confirmed that an empty production `VITE_API_BASE` fell through to port 4000.
   - Production builds now default to `window.location.origin`; only Vite development defaults to port 4000.

2. Coning On Machine export lineage filters
   - Confirmed the list and summary applied trace-first Cut/Yarn/Twist filters but export did not.
   - Export now applies the same trace filter after lineage enrichment.

3. Cursor-list request ownership
   - The reported permanent-empty scenario was prevented by the reset effect, but the shared boolean still allowed an aborted request's stale `finally` to release a newer request.
   - Replaced the boolean with a generation-owned request token so only the owning request can release the page slot.

4. Cutter challan projections after edit/delete
   - Confirmed successful normal and cascade paths refreshed Receive History only and did not invalidate the active challan page or stock.
   - All four success paths now emit Cutter receive-history and stock invalidations. The local subscription refreshes the active challan list and marks hidden history dirty.

## Rejected

1. Duplicate targeted and cached Cutter receive rows
   - The final code concatenates both sources, then deduplicates linked and legacy rows through a `Map` keyed by stable row ID before any balance calculation.
   - No double-counting path exists in the reviewed final state.

## Backlogged

1. Filtered Issue Tracking with the legacy `page` parameter
   - The shipped Issue History UI is cursor-only and never sends `page`.
   - Direct API callers combining `page > 1` with computed or trace filters can repeat the first cursor page.
   - Recorded in `BACKLOG.md`; this is not a direct normal-user release blocker.

## Verification

- 32 focused frontend/regression/contract tests passed.
- Database-backed trace-first Issue, On Machine list, On Machine export, stock grouping, and lot expansion test passed.
- Production frontend build passed.
- Backend syntax and `git diff --check` passed.
