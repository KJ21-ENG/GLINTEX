# Review 5 remediation

Date: 2026-08-27

## Accepted findings

### Cutter source candidates were truncated

- Replaced the fixed 200-row terminal responses with stable cursor pages.
- Lot cursors use PostgreSQL microsecond text plus lot number, avoiding JavaScript timestamp precision loss.
- Piece cursors use sequence plus ID.
- The frontend consumes every page for the selected Item or Lot and rejects a repeated cursor.
- Integration coverage forces one-row pages and proves all lots and pieces remain reachable without a scanner.

### Cutter stock materialized full tables in Node

- Routed Cutter Jumbo and Bobbin lot groups through SQL aggregation, filtering, grouping, cursor pagination, and full-filtered-result window summaries.
- Only the requested page is returned to Node.
- Expanded rows remain lazy through the existing lot-row endpoint.
- Added integration coverage for two-page cursor traversal, complete summaries, and multi-Yarn aggregation without numeric multiplication.

### Review-pack credential scan

- Restored the credential-bearing base Compose file byte-for-byte so historical development literals are absent from the outgoing diff.
- Moved the root-context build, corrected workdir mounts, health checks, migration service, performance configuration, and healthy dependency ordering into the existing development and production override files.
- Production database configuration remains environment-only in the production override.
- Both the automatic development merge and the explicit production merge render successfully.

### Coning trace filters loaded full history

- Accepted the reviewer finding for normal Issue Tracking and On Machine filters.
- Both routes now scan stable database batches, resolve trace only for each bounded batch, filter the mapped batch, and retain only the requested page plus numeric summary accumulators.
- Replaced full-history On Machine computed-filter and first-page summary paths for Cutter, Holo, and Coning with the same bounded batching pattern.
- Deliberate export routes remain separate full-result downloads as allowed by the release contract.
- Consolidated Coning Stock recursion, trace resolution, and issued totals onto one materialized JSON-reference expansion. The production-scale probe fell from 5.4 seconds to about 0.8 seconds.

### Rejected reviewer finding

- Rejected the claim that Cutter Bobbin SQL must read `"bobbinQuantity"`. Prisma schema maps that property to the physical `bobbin_quantity` column. The production-scale route executes successfully with `bobbin_quantity`; changing it as suggested would create the reported 500.

### Cutter partial-dispatch ownership invariant

- Independently confirmed that the new Cutter barcode lookup and source-candidate SQL treated the un-dispatched remainder of a partially dispatched piece as issueable, while the retired UI and current Cutter Stock both require zero dispatch.
- Barcode lookup now returns `409 exhausted` with zero business availability for such a piece.
- Item/Lot candidate queries exclude partially dispatched pieces.
- Create, quantity edit, and take-back reversal revalidate the same rule after locking the source row and return `409 availability_changed` if its state changed.
- The production-database route test covers candidate exclusion, barcode rejection, and direct POST rejection.

### Combined Stock bounded pagination

- Removed the effect that automatically called `loadMoreLots()` until every enabled stock cursor was exhausted.
- Each enabled Combined Stock section now keeps the initial 100-group page and exposes an explicit `Load more lots` control in summary and full-table modes.
- Full-filtered-result headline totals continue to use the server summary and do not depend on all group rows being downloaded.
- Added a static regression contract that rejects reintroduction of automatic cursor draining.

### On Machine aggregate summaries

- Replaced the default Holo and Coning first-page full-history replay with database aggregate summaries over issue, receive, take-back, and wastage balances.
- Default first-page route probes on the production-scale rehearsal data complete well below 5 seconds while retaining full-result total counts and weights.
- Filtered and trace-derived journeys retain the exact bounded-batch fallback because their displayed-value predicates cannot be reduced to the base issue columns without changing semantics.

### Holo and Coning stock SQL pagination

- Moved Holo and Coning search, filters, server grouping, summary windows, stable cursor predicates, ordering, and `LIMIT` into PostgreSQL.
- Node now receives only the requested page rather than every stock group.
- Grouped results retain exact `memberLotKeys`, while display lot labels remain non-authoritative.
- Production-scale tests cover ungrouped cursor traversal, complete summaries, grouped responses, member keys, trace-first Coning Yarn identity, exact Holo mixed-lot expansion, and expanded rows.

### Cutter source selector pagination

- Removed the frontend helper that drained every candidate cursor.
- Item and Lot selection load one 100-row page and expose separate user-driven `Load more lots` and `Load more pieces` controls.
- Generation guards prevent an older Item or Lot response from populating the newly selected context.

### Holo stock label trace

- Stock reprint now merges the action-detail trace into the selected Holo receive row, matching Receive History.
- Holo label resolution prefers the returned trace fields for Cut, Yarn, and Twist instead of depending on retired Cutter snapshot rows.

### Final bounded-review pagination remediation

- Added a database aggregate for the default Cutter On Machine summary. It matches the existing take-back, receive, and challan-wastage assignment rules without replaying every issue through Node.
- Pushed expanded lot-row cursors and `LIMIT + 1` into the Cutter, Holo, and Coning database queries. Coning recursion now starts only from issues in the requested lot identity, and downstream reference aggregation is limited to the candidate page.
- Kept cursor comparison inside PostgreSQL so timestamp precision cannot repeat a row after a JavaScript date round trip.
- Added production-database page-two coverage for Cutter Bobbin, Holo, and Coning expanded rows. The tests prove that equal contract pages remain distinct and complete.
- Fixed grouped Stock load-more deduplication to prefer `groupKey` and only fall back to `lotKey` for ungrouped rows.
- Reset the load-more state whenever a replacement process/search/filter query begins, preventing a stale request from permanently disabling pagination.
- Rejected the repeated physical-column claim for Cutter Bobbins again. `bobbinQuantity` is mapped by Prisma to PostgreSQL `bobbin_quantity`, and the exercised stock route passes.

### Filtered list summary bounds

- Removed exhaustive first-page summary scans from Issue Tracking and On Machine when search, date, computed, or trace-derived filters are active.
- Filtered responses now return `summary: null`, and the frontend omits the grand-total footer instead of showing a page-only or stale value.
- Added SQL aggregates for unfiltered Issue Tracking summaries across Cutter, Holo, and Coning. These preserve full-result totals without enumerating every issue ID in application memory.
- Deliberate exports remain complete full-filtered-result downloads and stay outside global frontend state.

### User-driven expanded stock rows

- Replaced automatic all-page retrieval on lot expansion with an initial 100-row page.
- Added per-lot cursors, deduplicated append state, retryable load-more errors, and explicit `Load more rows` controls across Cutter Jumbo, Bobbin, Holo, Coning, and Combined Stock desktop and mobile layouts.
- Exports remain the only path that deliberately drains all row pages.

### Cutter challan action hydration

- Changed Cutter challan edit, print, and export resolution to request the targeted challan contract first.
- A local cache is now only a failure fallback, preventing a partially loaded page cache from producing incomplete challan actions.

### Rejected duplicate-row claim

- Rejected the claim that Cutter Receive double-counts rows present in both linked and legacy collections. The form constructs a `Map` keyed by row ID before computing balances, so the same row is counted once.

### Bounded sparse-filter continuation

- Added a hard 500-row raw scan budget per ordinary Issue Tracking and On Machine request when pending, computed, or trace-derived values must be resolved after the base query.
- Continuation cursors resume after the final scanned raw row when a sparse segment has no full page of matches, and after the final returned match when another match is already buffered.
- Replaced numbered Issue Tracking pagination with cursor pagination and explicit user-driven continuation.
- Removed On Machine's automatic infinite-scroll continuation. Sparse histories cannot drain themselves in the background; the operator explicitly requests more pending rows or matches.
- Production-scale sparse Coning probes returned empty bounded segments with distinct continuation cursors in about 396 ms for two pages across both routes.

### Authoritative receive-form balance ordering

- Added an `asOf` marker to every batched issue balance returned by targeted lookups and mutations.
- Receive forms select the targeted scan balance unless InventoryContext contains a strictly newer mutation response, preserving both fresh-session accuracy and same-screen edit/delete propagation.
- Coning scans no longer short-circuit to a cached issue before performing the targeted lookup.

### Fail-closed Cutter challan actions

- Removed the partial local-row fallback from Cutter challan edit, print, export, and cascade-confirmation calculations.
- If the targeted challan response fails or omits its row array, the action stops with a visible retry message instead of producing a partial document or editor.

### Rejected Holo expansion claim

- Rejected the claim that Holo lot expansion filters only by display lot. Candidate issues already require the encoded item, Yarn, Twist, Cut, firm, supplier, raw lot, display lot, and canonical exact source-lot set.
- Added a PostgreSQL integration fixture with the same Item and Lot but different Cut, Yarn, and Twist. It produced two groups and each key expanded to only its own receive row.

### Holo input/output count-unit correction

- Confirmed that Holo issue counts represent input metallic bobbins while Holo receive counts represent output rolls. They are not conserved in the same unit.
- Removed roll-count comparisons against bobbin pending counts from transactional Holo receive create and edit. Weight remains the authoritative availability guard under the locked issue.
- Holo pending-count math now subtracts bobbin take-backs but not produced or wastage roll counts, keeping it meaningful for input-source take-backs.
- Expanded the concurrent Holo receive test so a 10-bobbin, 10 kg issue legitimately produces 20 rolls at 10 kg; one concurrent receive succeeds and the second is rejected by exhausted weight.

### Rejected missing-continuation claim

- Rejected the claim that On Machine has no continuation after removing its automatic sentinel. One shared desktop/mobile control calls `v2List.loadMore`, and the static regression contract verifies that explicit trigger while rejecting reintroduction of the sentinel.

### Final review remediation: Holo input mass and transaction-time lineage

- Corrected Holo issue capacity to conserve the complete issued input mass: metallic bobbin weight plus separately issued Yarn weight. The targeted balance service, Issue Tracking rows and summaries, and On Machine rows and summaries now use the same definition already used by the production totals.
- Kept metallic bobbin weight and Yarn weight as separate visible metrics while using their sum only for original, net-issued, and pending weight.
- Revalidated the submitted Holo receive piece against source rows resolved from the issue after acquiring the issue lock. If an edit changes the issue lineage while receive is waiting, the receive now returns `409 availability_changed` and writes nothing.
- Extended the concurrent Holo receive fixture so 10 kg of metallic input plus 3 kg of Yarn can legitimately produce a 12 kg net receive. The first request succeeds and the duplicate is rejected against the one remaining kilogram.

### Final review remediation: locked Coning tare and trace-first Twist

- Moved Coning Box, issue cone type, tare, net-weight, and issue-series derivation into the locked receive transaction. A concurrent issue edit can no longer leave the receive using a stale cone type or stale tare.
- Added trace-first Twist names and canonical Twist IDs to Coning stock grouping, stable lot keys, grouped member keys, expanded-row equality filters, and barcode-to-key lookup.
- Coning stock now keeps rows with different upstream Twist lineage separate, while stale child Twist fields collapse into the single correct traced identity.
- Added a coordinated database race proving that an issue cone-type change while receive waits on the issue lock produces the new authoritative 2.5 kg tare and 7.5 kg net weight.

### Coning create parent-lineage lock

- Extended Coning issue creation from source-row locking to source-row plus parent-issue locking.
- After locking each Holo or re-Coning source row, the transaction locks and reloads its parent issue, then derives Item, Lot, Cut, Yarn, and Twist exclusively from that locked state.
- A coordinated race changes the Holo parent Cut while Coning create waits. The created Coning issue now records the new locked Cut together with the authoritative Yarn and Twist, proving the pre-scan metadata cannot leak into the committed lineage.

### Rejected Cutter duplicate-row claim

- Rejected the repeated claim that targeted and cached Cutter receive rows are double-counted for multi-piece issues.
- The form combines both sources only as input, then filters eligible linked/legacy rows through a `Map` keyed by row ID before any issue or per-piece calculation. `pieceStatus` consumes the deduplicated array.

### Physical-source take-back selection and latest-only reversal

- Removed the inferred FIFO assignment of aggregate Holo and Coning receive consumption to individual physical input sources. Transformed output rows do not preserve a trustworthy per-source consumption mapping, so that inference could hide a still-returnable source.
- Holo and Coning take-back dialogs now expose every source with remaining issued quantity, start each requested return at zero, and enforce the authoritative issue-level pending count and weight as a shared cap across all selected lines.
- Backend take-back creation applies the same invariant: each selected source is capped by its own original quantity minus active take-backs, while the combined request is capped by the locked issue's current pending balance.
- Reverse Latest now always hydrates targeted action detail, rather than preferring a possibly stale local snapshot. The backend also locks the issue and accepts reversal only for the latest active take-back ordered by `createdAt` and `id`.
- Added database coverage proving that either Holo physical source can be selected under the global pending cap, an older active take-back cannot be reversed, and two concurrent attempts to reverse the latest take-back produce exactly one reversal.
- Expanded the snapshot-retirement regression contract to reject reintroduction of FIFO pending-pool distribution and cache-first latest-take-back selection.

### Re-coning allocation versus Coning dispatch

- Confirmed the reviewer finding that Coning dispatch availability subtracted prior dispatches but not effective allocations of the same receive row into a downstream re-coning issue.
- Applied the existing authoritative Coning-allocation calculation, including signed take-backs, to the dispatch availability list, single create, bulk create, edit validation, and Coning box-transfer lookup/revalidation paths.
- These write paths already lock the Coning receive source. Once availability is calculated from the locked source plus its active downstream references, re-coning issue creation and dispatch serialize on one inventory invariant.
- Added a coordinated database race for a 10 kg Coning receive row. A full re-coning issue and a full dispatch run concurrently; exactly one commits, the other returns `409 availability_changed`, and final issued plus dispatched weight remains at or below 10 kg.
- The same fixture then allocates 8 kg from a second 10 kg source, verifies the dispatch list exposes exactly 2 cones and 2 kg, and verifies a 3-cone/3 kg dispatch is rejected with the authoritative 2/2 balance.

## Validation

- Backend unit suite: 141 tests, 137 passed, 4 intentional database-gate skips, 0 failed.
- Concurrency integration: 17 passed, 0 failed.
- Production-scale route integration: 17 tests, 15 passed, 2 opt-in skips, 0 failed.
- Opt-in parity: passed.
- Issue load, 100 samples per stage:
  - Holo p95 111.5 ms, p99 240.1 ms.
  - Coning p95 171.4 ms, p99 306.1 ms.
- Cutter stock rehearsal probes:
  - Unfiltered Bobbin groups: 308.4 ms, 86,538 bytes.
  - Filtered Jumbo groups: 26.8 to 52.1 ms.
  - Filtered Bobbin groups: 18.9 ms.
  - Coning groups after reference-CTE consolidation: about 797 ms.
- Frontend production build: passed.
- Focused trace-first Coning Stock grouping, expansion, and barcode-key test: passed with canonical Cut, Yarn, and Twist identity.
- Focused Combined Stock pagination regression: passed.
- Focused Cutter source contract against the isolated production-scale rehearsal database: passed.
- Default On Machine aggregate probes: Cutter, Holo, and Coning passed below 5 seconds.
- Default Issue Tracking aggregate probes: Cutter, Holo, and Coning passed in about 187 ms combined.
- Filtered Issue Tracking and On Machine probes returned bounded pages with no exhaustive summary scan.
- Cutter, Holo, and Coning stock cursor, grouping, summary, and expansion probes: passed below 5 seconds, including explicit page-two row identity checks.
- Backend syntax checks: passed.
- `git diff --check`: passed.
- Explicit base plus production Compose render: passed with only optional unset-variable warnings.

## State boundary

These results validate local implementation and the isolated rehearsal database only. Staging browser, factory network, Windows, Android, production rollout, 60-minute observation, and 24-hour zero-snapshot evidence remain separate gates.
