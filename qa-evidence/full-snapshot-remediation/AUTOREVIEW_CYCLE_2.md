# Autoreview cycle 2

Date: 2026-08-28
Engine: Codex GPT-5.6 Sol, high reasoning
Scope: P0, P1, and P2 with direct normal-user impact
Result before triage: blocked with four candidates

## Accepted and corrected

1. Grouped Cutter Jumbo identity
   - Confirmed `useV2StockLots` retained `groupKey`, but `Stock.jsx` converted the array to an object keyed only by empty/colliding grouped `lotNo` values.
   - The conversion now prefers `groupKey`, then `lotKey`, then `lotNo`.

2. Cutter source candidates after issue creation
   - Confirmed successful issuance left the selected Item and Lot unchanged while scanned pieces overrode the refreshed remote candidate shape.
   - Successful create removes affected scanned overrides and advances a candidate refresh generation so both lot and piece candidates reload.

3. Cutter wastage revert invalidation
   - Confirmed the mutation refreshed Receive and Stock projections but not Issue History or On Machine.
   - Added both issue-facing invalidations to the successful revert path.

## Rejected

1. Cutter bobbin SQL physical column
   - Prisma declares `bobbinQuantity Int? @map("bobbin_quantity")`.
   - The isolated PostgreSQL rehearsal schema contains `bobbin_quantity`, not `bobbinQuantity`.
   - Database-backed Cutter Bobbins list, summary, grouping, and expansion routes execute successfully.
   - The raw SQL reference is correct and changing it to quoted camel case would introduce the reported failure.
