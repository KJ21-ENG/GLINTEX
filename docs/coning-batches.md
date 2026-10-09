# Shared coning batches

New coning issues can share a receiving batch when the worker physically mixes
compatible supplies during a shift. The first issue's ICO barcode identifies the
pool throughout receiving. There is no second batch-number format.

## Issuing material

After scanning source crates and selecting the issue parameters, the application
checks for an open batch with the same issue date, shift, worker, machine, item,
traced cut, yarn, cone type, wrapper and target net weight per cone. Twist, source
lot and box are not matching criteria. Missing material lineage or required
parameters disables automatic matching.

If one batch matches, **Add to existing batch** is selected automatically. The
screen shows its ICO number and the previous, additional and combined weights.
Uncheck it to create a separate receiving barcode; those goods must be kept
separate. If several batches match, select one explicitly or create a separate
batch. The server checks eligibility again when the issue is saved.

Each delivery receives an immutable supply record with its own ICO transaction
number, source allocations, weight, rolls, timestamp and specification snapshot.
The batch aggregates the allocations while retaining the first ICO barcode.
Supply history is visible in receiving and the issue editor. Scanning any of the
delivery ICO numbers resolves to the same batch, but supervisor stickers always
print the first ICO number. Choose **Supervisor sticker copies** when issuing to
print enough labels for the finished crates. Printing follows the existing label
template and print-service configuration and does not undo a saved issue if the
printer is unavailable.

## Receiving and finishing

Scan a supervisor sticker and receive finished crates against the whole batch.
The operator does not choose which delivery produced a crate. Further supplies
may be added after a partial receive; existing receive records and source
allocations remain unchanged. Source allocation follows the existing lineage
allocator for stock accounting, rather than claiming physical separation of
mixed material.

The batch stays open when its current pending weight reaches zero so another
compatible delivery in the same shift can join it. **Finish Batch** closes it
explicitly once all material has been received, taken back or accounted for.
Marking the remaining weight as wastage also finishes it. An explicit wastage
reversal reopens the batch. A finished batch cannot accept new supplies or
receives. If a receive correction restores pending material, use **Reopen for
Remaining Material** to account for it. A different date or shift starts a separate
batch.

## Compatibility and safeguards

- Historical issues keep their existing behavior and are not automatically
  combined. Shared batches start with issues created after this release.
- The receiving batch owns stock, receive, take-back, wastage and payment totals.
  Supply records are history, not additional stock or payment rows.
- Date, machine, operator, shift and notes retain ordinary edit permissions and
  paid-settlement safeguards. Corrections update automatic matching, retain the
  first ICO receiving barcode and append before/after snapshots to history.
- Before receiving starts, choose a specific delivery in the issue editor to
  correct its source crates, rolls or weight. Enter a reason. Original deliveries
  remain immutable; current allocations come from their latest correction.
  Source stock and combined batch totals change in one transaction. Corrections
  are blocked by active take-backs, wastage or a closed batch.
- Quantity corrections remain locked after receiving starts, including when a
  receive was later deleted. The server checks this under the batch lock at save
  time, so an editor opened earlier cannot change quantities after a receive.
  A stale batch revision also requires reloading before saving.
- Before receiving starts, cone type, wrapper and target cone weight can be
  corrected for the whole batch, including every delivery. Enter a reason.
  Expected cones and future matching update together. Original delivery
  specifications remain in history; current delivery projections include the
  corrected specifications so later quantity corrections retain them.
  Box corrections apply only to the selected delivery and do not change batch
  matching. These corrections share the receive, take-back, wastage, closed-batch,
  revision and paid-settlement safeguards used for delivery quantities.
- Allocation, specification, box or date/machine/operator/shift corrections require replacing
  supervisor stickers printed before the correction. History shows the original
  and corrected quantities, reason, timestamp and changed details. Reprinting
  loads fresh batch details and keeps the original receiving ICO.
- Existing paid-issue protections still apply to additions and edits. If a batch
  is locked by payment, create a separate batch under the existing payment rules.
- Transactions lock source crates and the receiving batch. Concurrent supplies
  cannot allocate a source twice; receives and wastage updates are atomic.
- Re-coning output cannot be added back into its own ancestor batch.
- Legacy JSON imports cannot preserve the delivery ledger and are blocked once
  shared batches exist. Full database backups retain the ledger.

## Verification

Apply the additive Prisma migration using the standard deployment process. Run
the backend suite and frontend production build. The integration suite requires
an isolated migrated PostgreSQL database whose name ends with `_test`:

```sh
TEST_DATABASE_URL=postgresql://user@localhost/glintex_coning_batches_test \
  node --test apps/backend/src/routes/__tests__/coningBatches.integration.test.js
```

It covers mixed twists/lots, supply aliases, partial receives and source reuse,
opt-out and ambiguous matches, finishing and wastage reversal, take-backs,
concurrent supplies/receives, re-coning and legacy/edit/permission safeguards.
Correction coverage includes metadata edits after receiving, future matching,
repeated per-delivery corrections, crate replacement, source stock credit and
dispatch limits, take-back/wastage reversals, paid guards and both lock orderings
of a simultaneously saving correction and receive.
