# Autoreview cycle 3

Date: 2026-08-28
Engine: Codex GPT-5.6 Sol, high reasoning
Scope: P0, P1, and P2 with direct normal-user impact
Result before triage: blocked with three candidates

## Accepted and corrected

1. Legacy Cutter receive attribution in On Machine
   - Confirmed the new unfiltered SQL fast path counted only receive rows carrying `issueId` even though supported historical rows can carry only `pieceId` and `createdAt`.
   - Both the unfiltered list and separate summary now assign each active null-linked row to the latest eligible active Cutter issue for that piece before aggregating balances.
   - Added database-backed coverage proving a fully received legacy issue is absent from the list and does not change the pending summary.

2. Cutter Jumbo lot identity during issue and label creation
   - Confirmed ungrouped V2 lots were keyed by opaque `lotKey` while selection, issue creation, and label data lookup use `lotNo`.
   - Ungrouped lots are now keyed by `lotNo`; grouped lots still use `groupKey`, preserving the previous grouped identity fix.

## Rejected

1. Duplicate targeted and cached Cutter receive rows
   - The merged collection is already deduplicated through a `Map` keyed by stable row ID before received weight, bobbin quantity, pending balance, or piece status is calculated.
   - This repeated claim does not reproduce in the final state.

## Verification

- 19 frontend snapshot/regression tests passed.
- The focused database-backed legacy receive attribution test passed.
- Production frontend build passed.
- Backend syntax and `git diff --check` passed.
