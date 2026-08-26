# Post-Coning Packing and Dispatch V2 Implementation Spec-Plan

Status: Confirmed implementation contract
Repository: `/Volumes/MacSSD/Development/CursorAI_Project/GLINTEX`
Authority: The confirmed user decisions from the post-Coning Packing design interview
Implementation mode: Local working tree only

## 1. How to use this file

This file is the canonical implementation contract. Implement it exactly.

- Do not reinterpret, simplify, widen, or redesign the requirements.
- Do not add Order Management, invoice, pricing, packaging-material inventory, or physical-location tracking.
- Do not delete or rewrite historical production, contractor-payment, wastage, barcode, Dispatch, or audit records.
- Do not use existing customer Dispatch records to reconcile legacy Coning stock.
- Do not deploy, connect to production for writes, run the live cutover, push, or publish.
- Do not modify this file during implementation. Report ambiguity to the orchestrator thread.
- This artifact deliberately stops at locally applied implementation. Testing and production execution are separate future work.

The repository working tree is already dirty. Existing edits belong to the user or earlier completed work. Every implementer must preserve them and must never use destructive Git commands, checkout files, reset the tree, or revert unrelated changes.

## 2. Product outcome

Replace the incomplete post-Coning flow with:

```text
Coning Receive
  -> authoritative shared Coning balance
      -> Re-Coning
      -> Packing Batch
          -> sealed physical containers
              -> independently actionable Packed Stock units
                  -> customer reservation when applicable
                  -> Dispatch V2
                      -> return / damage / repacking / reversal
```

Rules:

1. Packing is mandatory after Coning.
2. Direct Coning Dispatch is unavailable for new business operations.
3. Inbound, Cutter, and Holo Dispatch remain supported.
4. Re-Coning remains supported.
5. Re-Coning, Packing reservation/consumption, Dispatch, transfer, and reconciliation must use one authoritative balance calculation.
6. Stock-driven and customer-driven Packing are both supported.
7. Packed Stock is visible and actionable only in Stock.
8. Packing owns batches and physical transformations.
9. Dispatch owns shipment and challan operations.
10. Settings owns recipes and Packing masters.

## 3. Explicitly excluded

Do not implement any of the following:

- Sales Order or Customer Order models.
- Order lines, requested-versus-fulfilled accounting, promised dates, prices, taxes, invoices, or receivables.
- Packaging-material procurement or inventory consumption.
- Warehouse bins, physical locations, movement between locations, or location history.
- A second standalone Dispatch module.
- New direct Coning Dispatch capability.
- Hard deletion of Packing, Packed Stock, Dispatch V2, reconciliation, return, damage, repacking, or correction history.
- General action-specific Packing permissions. Packing uses only module-level `NONE`, `READ`, and `WRITE`.
- Production deployment or production cutover execution.

## 4. Canonical terminology

| Term | Exact meaning |
|---|---|
| Base unit | One cone or piece represented by Packing count. |
| Container | A Packet, Box, Bori, or Parcel. |
| Stock unit | The lowest recipe-selected container that may independently enter stock, reserve, dispatch, return, damage, transfer by allocation, or receive correction. |
| Parent container | A higher container that groups children and may have a barcode for bulk scanning. |
| Packing batch | One controlled transformation from Coning receipts or prior Packed Units into new physical containers. |
| Repacking batch | A Packing batch whose sources are prior Packed Units. |
| Customer reservation | A hard unit-level assignment directly to one Customer. There is no order reference in this version. |
| Administrative amendment | A reasoned change to notes or non-inventory metadata that does not change physical identity. |
| Inventory-affecting correction | An append-only reversal, split, repacking, return, damage, write-off, or replacement event. |
| Legacy cutover | A reversible inventory adjustment that removes old Coning availability without deleting historical production. |

### 4.1 Identifier formats

Use these exact human-readable identifiers:

- Packing batch: `PB-YYYYMMDD-NNNN`
- Barcoded physical container: `PKU-<PACKING_BATCH_ID>-L<LEVEL>-U<SEQUENCE>`
- Inventory adjustment batch: `IAB-YYYYMMDD-NNNN`
- Existing Dispatch challan: preserve `DC/<FISCAL_YEAR>/<SEQUENCE>`

`NNNN` and `SEQUENCE` are zero-padded decimal values allocated transactionally. Add `OperationalSequence`:

- `key` as primary key
- `nextValue`
- `updatedAt`

Sequence keys include the date/fiscal scope. Never allocate an identifier by counting rows.

## 5. Master data and recipes

### 5.1 Reuse existing masters

- `Item` remains the item identity.
- `Wrapper` is shown as Brand in Packing UI.
- `ConeType` remains the cone identity.
- `Customer` remains the optional customer identity.

### 5.2 Add Packing masters

Add `PackingColor`:

- `id`
- `name`
- `normalizedName`, lower-cased and unique
- `isActive`, default `true`
- created/updated timestamps and actor IDs

Add `PackingPackageType`:

- `id`
- `name`
- `normalizedName`, lower-cased and unique
- `kind`: `PACKET | BOX | BORI | PARCEL`
- `defaultTareKg` as `Decimal(12,3)`
- `isActive`, default `true`
- created/updated timestamps and actor IDs

Do not treat the existing `Box` receive/tare master as an outbound package type.

Add singleton `PackingLaunchState`:

- primary key fixed to `packing_dispatch_v2`
- `status`: `PREPARATION | WRITES_GATED | CUTOVER_APPLIED | ACTIVE | FAILED | REVERSED`
- `affectedWritesPaused`
- `cutoffAt`, nullable
- `adjustmentBatchId`, nullable
- `lastError`, nullable
- updated timestamp and actor ID

This is an auditable cutover state, not a general feature-flag system.

### 5.3 Versioned recipe model

Add `PackingRecipe` where every version is an immutable row:

- `id`
- `familyKey`
- `version`
- `status`: `DRAFT | ACTIVE | RETIRED`
- `supersedesRecipeId`, nullable
- `itemId`, nullable while DRAFT
- `wrapperId`, nullable while DRAFT
- `colorId`, nullable while DRAFT
- `coneTypeId`, nullable while DRAFT
- `customerId`, nullable
- `nominalGram` as nullable `Decimal(12,3)` while DRAFT
- `deliveryMode`: `UNSPECIFIED | LOCAL | PARCEL`
- `allowPartialDispatch`
- `requiresQualityHold`
- `warningVariancePercent`, default `2.000`
- `approvalVariancePercent`, default `5.000`
- `stockUnitLevelIndex`
- `notes`
- `sourceMetadata` JSON, nullable
- created/updated timestamps and actor IDs

Constraints:

- Unique `(familyKey, version)`.
- Only one ACTIVE version per family.
- Activation requires non-null Item, Wrapper/Brand, Color, Cone Type, nominal gram, at least one valid level, and a valid stock-unit level.
- A recipe is generic when `customerId` is null.
- A customer-restricted recipe may only be used for that Customer.
- Editing an ACTIVE recipe means creating a new DRAFT version. Never mutate historical meaning.

Add `PackingRecipeLevel`:

- `id`
- `recipeId`
- `levelIndex`, starting at 1 for the innermost container
- `packageTypeId`
- `childUnitsPerContainer`
- `barcodeEnabled`
- unique `(recipeId, levelIndex)`

Interpretation:

- At level 1, `childUnitsPerContainer` is the number of base cones/pieces.
- At higher levels, it is the number of immediately lower-level containers.
- The recipe's `stockUnitLevelIndex` identifies the independently actionable stock level.
- Higher levels may have barcodes for atomic group scans.

### 5.4 Recipe override

A Packing WRITE user may apply a batch-only override with a mandatory reason. The override must be stored as a snapshot on the batch and must not mutate the recipe. Turning an override into a standard requires a new recipe version.

### 5.5 Workbook recipe seed

Create an idempotent local importer at `apps/backend/src/scripts/importPackingRecipeSeed.mjs`. It inserts these 39 source rows as DRAFT recipes only. It never activates a recipe.

Importer rules:

- Preserve every raw source value in the recipe snapshot.
- Normalize whitespace and package spelling such as `120PAC` to `120 PAC` while retaining the raw value.
- Map Item, Wrapper/Brand, and Cone Type only when an unambiguous existing master matches.
- Create or map PackingColor and PackingPackageType through their normalized names.
- Parse package structure into recipe levels only when the arithmetic is exact.
- `1*50 PER BORI` means 50 base units per Bori.
- Parcel rows with Parcel `1` represent one outer Parcel.
- Local rows have no Parcel level unless later added by a user.
- `GRAM = S`, item spelling variants, and any non-exact package arithmetic remain unresolved DRAFT fields and block activation.
- Imported source row number is stored in recipe metadata for traceability.

| Source row | Delivery mode | Item | Brand | Color No | Cone | Gram | Pcs | Package | Parcel | Notes |
|---:|---|---|---|---|---|---:|---:|---|---:|---|
| 3 | PARCEL | 110 NYLON-ANMOL 10 | MSK | NEW 3435 | P GREEN | 125 | 320 | 4 BOX | 1 | |
| 4 | PARCEL | 110 NYLON-L WATER | G-4 | M GOLD | P YELLOW | 125 | 320 | 4 BOX | 1 | |
| 5 | PARCEL | 110 NYLON-ANMOL 21 | PLAIN | 3435 | P GREEN | 125 | 320 | 4 BOX | 1 | |
| 6 | PARCEL | 110 NYLON-ANMOL 41 | PLAIN | 152 | P GREEN | 100 | 400 | 4 BOX | 1 | |
| 7 | PARCEL | 110 NYLON-ANMOL 21 | GLINTEX | 3435 | Y-BLACK | 125 | 320 | 4 BOX | 1 | |
| 8 | PARCEL | 110 NYLON-ANMOL 10 | NAZIR | NEW 3435 | Y-BLACK | S | 320 | 4 BOX | 1 | |
| 10 | PARCEL | 40/2 COTTON-IVERY | GOLDEN DARE | 108 | 1 HOLE PINK | 35 | 900 | 150 PAC | 1 | |
| 11 | PARCEL | 40/2 COTTON-IVERY | PLAIN | 108 | 1 HOLE PINK | 30 | 900 | 150 PAC | 1 | |
| 12 | PARCEL | 40/2 COTOON-WATER 11 | JJH | WATER | 1 HOLE BLUE | 50 | 720 | 120 PAC | 1 | |
| 13 | PARCEL | 40/2 COTOON-ANMOL 21 | PLAIN | 20 | 1 HOLE BLUE | 45 | 720 | 120PAC | 1 | |
| 14 | PARCEL | 40/2 COTOON-IVERY | PLAIN | 108 | 1 HOLE PINK | 25 | 900 | 150 PAC | 1 | |
| 15 | PARCEL | 100 POLYSTER-WATER 11 | ASHIYANA | WATER | BALAZI S/Z | 30 | 1040 | 4 BOX | 1 | |
| 16 | PARCEL | 40 NYLON-D GOLD | PLAIN | D GOLD | BLUE+WHITE | 100 | 400 | 4 BOX | 1 | |
| 17 | PARCEL | 70 POLYSTER-D GOLD | PLAIN | D GOLD | BLUE+WHITE | 100 | 400 | 4 BOX | 1 | |
| 18 | PARCEL | 70 POLYSTER-D GOLD | PLAIN | D GOLD | BLUE+WHITE | 95 | 400 | 4 BOX | 1 | |
| 19 | PARCEL | 75 POLYSTER-D GOLD | PLAIN | D GOLD | S/S | 100 | 400 | 4 BOX | 1 | |
| 21 | PARCEL | 180 BRT-R WATER | GLINTEX | WATER GOLD | P PUTHA | 1000 | 60 | 4 BORI | 1 | 1*15 PER BORI |
| 22 | PARCEL | 70 NYLON-D GOLD | NEPOLEON | D GOLD | P WHITE | 250 | 200 | 4 BORI | 1 | 1*50 PER BORI |
| 23 | PARCEL | 75 POLYSTER-D GOLD | NEPOLEON | D GOLD | P RED | 250 | 200 | 4 BORI | 1 | 1*50 PER BORI |
| 24 | PARCEL | 180 CREAM-ST WATER | INDIAN FLORA | D GOLD | P PUTHA | 250 | 250 | 5 BORI | 1 | 1*50 PER BORI |
| 25 | PARCEL | 180 BRT-SR WATER | PLAIN | WY-10-D | P GREEN | 220 | 250 | 5 BORI | 1 | 1*50 PER BORI |
| 26 | PARCEL | 180 GOLD-ANMOL 15 | PLAIN | L.ANTIC-201 | P GREEN | 220 | 250 | 5 BORI | 1 | 1*50 PER BORI |
| 27 | PARCEL | 40/2 COTTON-IVERY | GLINTEX | 108 | P PUTHA | 500 | 100 | 4 BORI | 1 | 1*25 PER BORI |
| 28 | PARCEL | 40/2 COTTON-IVERY | PLAIN | 32 | P RED | 100 | 400 | 5 BORI | 1 | 1*15 PER BORI |
| 30 | LOCAL | 30 NO COTTON-WATER D | GLINTEX | FL WATER D | P PUTHA | 1000 | 15 | 1 BORI | | |
| 31 | LOCAL | 70 NYLON-SR ANMOL | GLINTEX | ANMOL | P PUTHA | 500 | 28 | 1 BORI | | |
| 32 | LOCAL | 70 NYLON-D GOLD | GLINTEX | D GOLD | P PUTHA | 500 | 25 | 1 BORI | | |
| 33 | LOCAL | 40 NYLON-D GOLD | GLINTEX | D GOLD | P PUTHA | 500 | 25 | 1 BORI | | |
| 34 | LOCAL | 70 NYLON-SR ANMOL | GLINTEX | ANMOL YELLOW MONO DOUBLING | JALI PUTHA | 1000 | 15 | 1 BORI | | |
| 35 | LOCAL | 70 NYLON-W 10 | GLINTEX | W-10 | P PUTHA | 500 | 28 | 1 BORI | | |
| 36 | LOCAL | 20 NYLON-ANMOL 10(S) | GLINTEX BORI | LIGHT ANMOL | P PUTHA | 500 | 20 | 1 BORI | | |
| 37 | LOCAL | 30 NO COTTON-PINK COPPER | GLINTEX | PINK COPPER | P PUTHA | 1000 | 15 | 1 BORI | | |
| 38 | LOCAL | 30 NO COTTON-SR ANMOL | GLINTEX | ANMOL | P PUTHA | 1000 | 15 | 1 BORI | | |
| 39 | LOCAL | 30 NO COTTON-W 10 | GLINTEX | W-10 | P PUTHA | 1000 | 15 | 1 BORI | | |
| 40 | LOCAL | 30 NO COTTON-W 2 | GLINTEX | W-2 | P PUTHA | 1000 | 15 | 1 BORI | | |
| 42 | LOCAL | 20 NYLON-LG 20 | GLINTEX | LM.BCH | P PUTHA | 500 | 20 | 1 BORI | | |
| 43 | LOCAL | 20 NYLON-CJ GOLD | GLINTEX | MY-44 | P PUTHA | 500 | 20 | 1 BORI | | |
| 44 | LOCAL | 20 NYLON-ANMOL 10 | GLINTEX BORI | LIGHT ANMOL | ROLLS | 350 | 60 | 1 BORI | | |
| 45 | LOCAL | 30 NYLON-I VERY | GLINTEX BORI | MY-16 | ROLLS | 350 | 60 | 1 BORI | | |

## 6. Packing data model

### 6.1 Batch

Add `PackingBatch`:

- `id`
- `batchNo`, unique and human-readable
- `kind`: `INITIAL | REPACKING | OPENING`
- `status`: `DRAFT | CONFIRMED | IN_PROGRESS | PARTIALLY_COMPLETED | COMPLETED | SHORT_CLOSED | VOIDED`
- `recipeId`
- immutable recipe snapshot JSON
- `customerId`, nullable
- `deliveryMode`
- `plannedBaseCount`
- `plannedNetWeightKg` as `Decimal(16,3)`
- `targetAmendmentReason`, nullable
- `shortCloseReason`, nullable
- `voidReason`, nullable
- `notes`
- confirmed/started/completed/short-closed/voided timestamps
- created/updated actor IDs and timestamps
- optimistic `version` integer

Rules:

- One batch has zero or one Customer.
- DRAFT does not reserve source stock.
- CONFIRMED or IN_PROGRESS reserves exact source count and weight.
- A batch with no completed output may become VOIDED and release all reservations.
- A batch with completed output may not be cancelled or voided. It may become SHORT_CLOSED and release unused reservations.
- Completing more than the current target requires an audited target amendment before sealing the extra unit.
- Delivery mode is editable in DRAFT and CONFIRMED. It becomes immutable when IN_PROGRESS starts.
- Assigning or changing a Customer after Packing starts is allowed only when physical composition remains compatible. Otherwise create a Repacking batch.

### 6.2 Batch sources

Add `PackingBatchSource`:

- `id`
- `batchId`
- `sourceType`: `CONING_RECEIVE | PACKED_UNIT`
- `sourceId`
- source barcode/item/lot/recipe/customer snapshots
- `reservedBaseCount`
- `reservedNetWeightKg` as `Decimal(16,3)`
- `consumedBaseCount`
- `consumedNetWeightKg` as `Decimal(16,3)`
- `releasedBaseCount`
- `releasedNetWeightKg` as `Decimal(16,3)`
- created/updated timestamps and actor IDs

One source may participate in multiple batches only when its authoritative remaining balance permits it.

### 6.3 Packed physical hierarchy

Add `PackedUnit` for every physical Packet, Box, Bori, or Parcel created by Packing:

- `id`
- `batchId`
- `recipeId`
- `packageTypeId`
- `parentUnitId`, nullable self-relation
- `levelIndex`
- `unitSequence`
- `barcode`, nullable until sealing, unique when present
- `isStockUnit`
- `status`: `IN_PROGRESS | LABEL_PENDING | QUALITY_HOLD | AVAILABLE | RESERVED | DISPATCHED | RETURNED_PENDING_INSPECTION | DAMAGED | REPACKED | SPLIT_CONSUMED | OPENED | VOIDED`
- `itemId`, `wrapperId`, `colorId`, `coneTypeId`
- `customerId`, nullable
- `nominalGram` as `Decimal(12,3)`
- `baseCount`
- `grossWeightKg`, `tareWeightKg`, `netWeightKg` as `Decimal(16,3)`
- `labelPrintCount`
- `sealedAt`
- `qualityReleasedAt`, nullable
- `splitFromUnitId`, nullable
- `replacedByUnitId`, nullable
- `version` for optimistic concurrency
- created/updated timestamps and actor IDs

Rules:

- The hierarchy is recipe-defined. Levels may be skipped.
- Box and Bori are sibling kinds.
- Each independently actionable unit receives a unique barcode at sealing.
- Parent containers receive a barcode only when the recipe enables it.
- A completed unit is immutable. Inventory-affecting changes create events and new identities.
- Failed label generation leaves the unit LABEL_PENDING and unavailable.
- A recipe with quality hold moves the unit from sealing to QUALITY_HOLD. Packing WRITE releases it.
- A customer-neutral batch creates customer-neutral units.
- Batch customer is copied to sealed units. Those units enter RESERVED after release; customer-neutral units enter AVAILABLE.
- A customer-neutral, UNSPECIFIED-delivery unit remains valid generic stock. Later customer/delivery requirements that change its physical composition require Repacking.
- The printed unit label contains exactly the barcode, minimal item identity, and exact base count. Do not add customer, weight, batch, or recipe detail to the physical label in this implementation.

Sealing variance behavior:

- Absolute variance at or below `warningVariancePercent`: seal normally.
- Above warning and at or below `approvalVariancePercent`: require a reason.
- Above `approvalVariancePercent`: require explicit confirmation by a Packing WRITE user plus a reason.
- Store planned values, actual values, computed variance, reason, and actor in the event payload.

### 6.4 Append-only events

Add `PackedUnitEvent`:

- `id`
- `batchId`, nullable
- `unitId`, nullable
- `type`
- `reason`, mandatory for exceptional events
- `payload` JSON with before/after snapshots
- `reversalOfEventId`, nullable
- `idempotencyKey`, unique
- actor ID and timestamp

Use events for:

- administrative amendment
- reservation, release, and reassignment
- label reprint and barcode replacement
- quality release
- partial split
- return and inspection outcome
- damage
- write-off
- repacking
- void and short-close
- reversal

Never hard-delete these events.

## 7. Authoritative Coning balance

Create a dedicated backend service, not route-local arithmetic. All Coning Stock, re-Coning, Packing, direct legacy reads, Box Transfer, and reconciliation paths must call it.

Required formula for count and weight:

```text
current row quantity
- legacy/new customer Dispatch consumption
- downstream re-Coning consumption
- completed Packing consumption
- unconsumed active Packing reservations
+ signed applied reconciliation adjustments
= authoritative available balance
```

Current row quantity already reflects Box Transfer mutations. Do not subtract Box Transfer twice.

Implementation rules:

- Lock every affected source deterministically inside the same database transaction before balance calculation and mutation.
- Lock multiple sources in stable sorted-ID order.
- Reject negative count or weight.
- Count is exact. Never infer Packed Stock count proportionally from weight.
- Use Decimal values for all new weight fields.
- Every mutating endpoint accepts an idempotency key and cannot apply the same operation twice.
- Re-Coning must reserve/consume through the same balance service as Packing.
- Remove Coning from new Dispatch source selection after cutover support exists. Preserve read compatibility for historical Coning Dispatch data.

## 8. Customer reservation

There is no Order model in this implementation.

- Reservation is the current `customerId` on an independently actionable PackedUnit plus an append-only reservation event.
- A unit reserved to Customer A cannot Dispatch to Customer B.
- Reservations never expire automatically.
- Release or reassignment requires a reason.
- Customer may be assigned during DRAFT or later when physical configuration remains compatible.
- If customer requirements change physical composition, repacking is mandatory.
- After partial Dispatch, the residual unit remains reserved to the same Customer until manually released or reassigned.
- Add `isActive` to Customer.
- Customers with Packing, Packed Stock, Dispatch, or document history cannot be deleted. They may be deactivated and hidden from new-selection lists.

## 9. Partial Dispatch, return, damage, and repacking

### 9.1 Partial Dispatch

Partial Dispatch is allowed only when the recipe version permits it. Any Dispatch WRITE user may perform it and must provide a reason.

The operation is one transaction:

1. Lock source PackedUnit.
2. Confirm customer compatibility and recipe permission.
3. Require exact dispatched count and actual weight.
4. Require exact residual count and actual weight.
5. Require count conservation including explicit damaged/lost count if any.
6. Retire the source as SPLIT_CONSUMED.
7. Create a dispatched child identity.
8. Create, reseal, and label a residual child with a new barcode.
9. Keep residual customer reservation.
10. Create Dispatch line and append-only events.

The operation fails atomically if the residual barcode/label cannot be produced.

### 9.2 Return

Dispatch return moves a unit to RETURNED_PENDING_INSPECTION.

- Sealed and unchanged: same barcode returns to AVAILABLE or RESERVED according to explicit current customer assignment.
- Opened or physically changed: create a Repacking batch.
- Damaged: move to DAMAGED.
- Do not automatically reactivate an old customer reservation after a return.

### 9.3 Damage and write-off

- DAMAGED units cannot Dispatch.
- Salvageable content becomes a Repacking source.
- Unsalvageable count and weight become an append-only write-off event with reason.
- Never reduce the sealed unit in place.

### 9.4 Repacking

- Repacking supports compatible many-to-many PackedUnit sources and outputs.
- Source units become REPACKED.
- New containers and barcodes are created.
- Full lineage is preserved.

### 9.5 Parent Parcel scan

- Scanning a sealed parent Parcel operates atomically on all active child stock units.
- It succeeds only when every child is eligible and customer-compatible.
- Dispatching a subset requires scanning children.
- Removing or splitting children moves the parent to OPENED and prevents reuse as a sealed atomic group.

## 10. Dispatch V2

Do not add Packed Stock as another branch inside the current Dispatch monolith. Introduce a structural V2 model and compatibility layer.

### 10.1 Models

Add `DispatchChallan`:

- `id`
- `challanNo`, unique
- `businessDate` as PostgreSQL DATE
- `customerId`
- `status`: `ACTIVE | VOIDED | PARTIALLY_RETURNED | RETURNED`
- `notes`
- immutable company and customer snapshot JSON
- `idempotencyKey`, unique
- legacy reconstruction marker
- created/updated timestamps and actor IDs
- optimistic `version`

Add `DispatchLine`:

- `id`
- `challanId`
- `sourceType`: `INBOUND | CUTTER | HOLO | PACKED`
- `sourceId`
- immutable source barcode and display snapshots
- `baseCount`, nullable only for legacy source semantics
- `netWeightKg` as `Decimal(16,3)`
- `parentPackedUnitId`, nullable
- `legacyDispatchId`, nullable unique
- created/updated timestamps and actor IDs

Add `DispatchEvent`:

- challan/line references
- event type
- mandatory reason for correction, void, return, and reversal
- before/after payload
- reversal link
- idempotency key
- actor and timestamp

Add `DispatchDocument`:

- `challanId`, unique
- `kind`: `ORIGINAL | LEGACY_RECONSTRUCTION`
- immutable rendering snapshot JSON
- stored PDF bytes, nullable until first generation for legacy reconstruction
- SHA-256 hash
- generation timestamp

### 10.2 Legacy migration

- Keep the existing `Dispatch` table in this release as read-only legacy evidence.
- Create an idempotent migration command that groups existing rows by challan number.
- Preserve existing challan numbers, source IDs, barcodes, count, weight, dates, actors, and timestamps.
- Refuse migration when rows under one challan disagree on customer, date, or stage.
- Create one DispatchLine per existing Dispatch row with `legacyDispatchId`.
- Do not recompute or mutate existing source dispatch counters during migration.
- Build compatibility response adapters for old browser clients.
- Historical PDFs are generated on demand and marked LEGACY_RECONSTRUCTION.

### 10.3 Source adapters

Implement explicit source adapters:

- Inbound adapter
- Cutter adapter
- Holo adapter
- Packed adapter

Legacy adapters preserve their current business semantics while adopting V2 locking, idempotency, challan, history, correction, and document infrastructure.

Packed adapter enforces:

- whole unit by default
- exact unit count and net weight
- customer reservation lock
- recipe-controlled partial split
- parent Parcel expansion
- immutable PackedUnit transitions

Coning is not a selectable new source adapter. Historical Coning records remain readable.

### 10.4 APIs

Provide:

- lightweight source summary counts
- cursor-paginated available-source listing
- exact authoritative barcode lookup
- cursor-paginated challan headers
- lazy challan details
- create challan with idempotency key
- void/reverse/correct/return actions with reasons
- server-side export endpoints
- authoritative PDF endpoint

Do not load complete stock or complete Dispatch history into the browser.

### 10.5 Document behavior

- Future challans generate an immutable server PDF from stored snapshots.
- Browser preview and printing consume the authoritative document DTO/PDF.
- Multiple selected challans render as distinct pages without iframe overwrite.
- Escape every dynamic value.
- Packed lines show item, barcode, package kind, exact count, and net weight.
- Parent Parcel may summarize children but child detail remains attached.

## 11. Reconciliation and opening balances

### 11.1 Models

Add `InventoryAdjustmentBatch`:

- `id`
- `kind`: `LEGACY_CUTOVER | MANUAL_CORRECTION | DAMAGE_WRITE_OFF | OPENING_BALANCE`
- `status`: `DRAFT | APPLIED | REVERSED | FAILED`
- `effectiveAt`
- `reason`
- evidence snapshot JSON
- idempotency key
- applied/reversed timestamps
- actor IDs and timestamps

Add `InventoryAdjustmentLine`:

- `batchId`
- `sourceType`
- `sourceId`
- exact signed count delta
- exact signed weight delta
- source barcode/item/lot/cone snapshots
- optional replacement opening source/unit reference
- reversal link

### 11.2 Legacy cutover semantics

- Preserve every historical Coning receive with `isDeleted=false` unless it was already legitimately deleted.
- LEGACY_CUTOVER applies a reversible negative availability adjustment for the audited legacy balance.
- Never create fake customer Dispatch records.
- Never change contractor-production evidence, piece totals, wastage, notifications, or historical barcode identity.
- Show the adjustment as Inventory Adjustment in barcode history and reports.

### 11.3 Opening-balance importer

Create a dedicated transactional importer:

- Loose/unpacked goods create explicit payment-exempt Coning opening stock.
- Already packed goods create Packing OPENING batches and PackedUnits.
- Damaged or uncertain goods are rejected until classified.
- Every imported line links to the cutover batch.
- New barcodes are mandatory and must be globally unique.
- Use an explicit opening-source marker, not fragile `createdBy` string inference.
- Opening records never enter contractor earnings.
- Preserve Item, Yarn, Twist, Cut, Wrapper/Brand, Color, Cone Type, count, and weight lineage where applicable.
- Require an evidence snapshot with distinct preparer and verifier identities.
- Refuse cutover application while any live Coning contractor settlement remains draft. The design audit observed 33 drafts, but the implementation must query the current count rather than hard-code 33.
- Refuse duplicate import using the cutover batch idempotency key and line-level source identity.

## 12. State transitions and mutation rules

Implement state transition services. Route handlers must not assign statuses directly.

Allowed transitions include:

```text
PackingBatch:
DRAFT -> CONFIRMED -> IN_PROGRESS
IN_PROGRESS -> PARTIALLY_COMPLETED -> COMPLETED
DRAFT|CONFIRMED|IN_PROGRESS(no output) -> VOIDED
PARTIALLY_COMPLETED -> SHORT_CLOSED

PackedUnit:
IN_PROGRESS -> LABEL_PENDING|QUALITY_HOLD|AVAILABLE|RESERVED
LABEL_PENDING -> QUALITY_HOLD|AVAILABLE|RESERVED
QUALITY_HOLD -> AVAILABLE|RESERVED
AVAILABLE <-> RESERVED
AVAILABLE|RESERVED -> DISPATCHED|DAMAGED|REPACKED|SPLIT_CONSUMED
DISPATCHED -> RETURNED_PENDING_INSPECTION
RETURNED_PENDING_INSPECTION -> AVAILABLE|RESERVED|DAMAGED|REPACKED
parent sealed state -> OPENED
```

Reject every transition not explicitly allowed.

Administrative note amendments do not change state. Physical changes require events and new identities.

### 12.1 Canonical event type constants

Use one shared backend constant registry. Do not scatter literal event names.

Packing/Packed Unit event types:

- `BATCH_CONFIRMED`
- `BATCH_STARTED`
- `BATCH_TARGET_AMENDED`
- `BATCH_COMPLETED`
- `BATCH_SHORT_CLOSED`
- `BATCH_VOIDED`
- `SOURCE_RESERVED`
- `SOURCE_CONSUMED`
- `SOURCE_RELEASED`
- `UNIT_SEALED`
- `UNIT_LABEL_PENDING`
- `UNIT_LABEL_REPRINTED`
- `UNIT_BARCODE_REPLACED`
- `UNIT_QUALITY_RELEASED`
- `UNIT_RESERVED`
- `UNIT_RESERVATION_RELEASED`
- `UNIT_RESERVATION_REASSIGNED`
- `UNIT_SPLIT`
- `UNIT_RETURNED`
- `UNIT_RETURN_INSPECTED`
- `UNIT_DAMAGED`
- `UNIT_WRITTEN_OFF`
- `UNIT_REPACKED`
- `ADMINISTRATIVE_AMENDMENT`
- `EVENT_REVERSED`

Dispatch event types:

- `CHALLAN_CREATED`
- `CHALLAN_VOIDED`
- `LINE_CORRECTED`
- `LINE_RETURNED`
- `RETURN_REVERSED`
- `DISPATCH_EVENT_REVERSED`

Inventory adjustment event types are represented by adjustment batch status plus append-only AuditLog entries.

### 12.2 Canonical API namespaces

All new endpoints return JSON errors as `{ "error": "stable_code", "message": "human explanation", "details": object|null }`. Mutating endpoints read an `Idempotency-Key` header. Missing idempotency keys return HTTP 400.

#### Packing masters and recipes

- `GET|POST /api/packing/colors`
- `PUT /api/packing/colors/:id`
- `GET|POST /api/packing/package-types`
- `PUT /api/packing/package-types/:id`
- `GET|POST /api/packing/recipes`
- `GET|PUT /api/packing/recipes/:id`
- `POST /api/packing/recipes/:id/activate`
- `POST /api/packing/recipes/:id/retire`

#### Packing batches and physical units

- `GET|POST /api/packing/batches`
- `GET|PUT /api/packing/batches/:id`
- `POST /api/packing/batches/:id/confirm`
- `POST /api/packing/batches/:id/start`
- `POST /api/packing/batches/:id/amend-target`
- `POST /api/packing/batches/:id/short-close`
- `POST /api/packing/batches/:id/void`
- `POST /api/packing/batches/:id/sources/reserve`
- `POST /api/packing/batches/:id/units`
- `POST /api/packing/units/:id/seal`
- `POST /api/packing/units/:id/reprint-label`
- `POST /api/packing/units/:id/replace-barcode`
- `POST /api/packing/units/:id/release-quality`
- `POST /api/packing/units/:id/return`
- `POST /api/packing/units/:id/inspect-return`
- `POST /api/packing/units/:id/damage`
- `POST /api/packing/units/:id/write-off`
- `POST /api/packing/repacking-batches`

#### Packed Stock

- `GET /api/packed-stock`
- `GET /api/packed-stock/:id`
- `GET /api/packed-stock/barcode/:barcode`
- `POST /api/packed-stock/:id/reserve`
- `POST /api/packed-stock/:id/release-reservation`
- `POST /api/packed-stock/:id/reassign-reservation`

#### Dispatch V2

- `GET /api/v2/dispatch/sources/summary`
- `GET /api/v2/dispatch/sources/:sourceType`
- `GET /api/v2/dispatch/barcode/:barcode`
- `GET|POST /api/v2/dispatch/challans`
- `GET /api/v2/dispatch/challans/:id`
- `POST /api/v2/dispatch/challans/:id/void`
- `POST /api/v2/dispatch/lines/:id/correct`
- `POST /api/v2/dispatch/lines/:id/return`
- `POST /api/v2/dispatch/events/:id/reverse`
- `GET /api/v2/dispatch/challans/:id/pdf`
- `GET /api/v2/dispatch/export`

#### Reconciliation and cutover

- `GET|POST /api/reconciliation/batches`
- `GET /api/reconciliation/batches/:id`
- `POST /api/reconciliation/batches/:id/preview`
- `POST /api/reconciliation/batches/:id/apply`
- `POST /api/reconciliation/batches/:id/reverse`
- `POST /api/reconciliation/batches/:id/import-opening-balances`
- `GET /api/packing-launch-state`

The launch state GET is readable by Packing READ. Mutation of cutover state is performed only by the explicit local/production command tooling, not a general UI endpoint.

#### Reports and lineage

- `GET /api/packing-reports/production`
- `GET /api/packing-reports/stock`
- `GET /api/packing-reports/variance`
- `GET /api/packing-reports/exceptions`
- `GET /api/packing-reports/reconciliation`
- Extend existing `GET /api/reports/barcode-history/:barcode` through the new lineage service.

## 13. Permissions

Add `packing` to backend and frontend base permission keys.

- `NONE`: no access.
- `READ`: read-only Packing and Packed Stock visibility.
- `WRITE`: every Packing mutation, including recipe activation, variance acceptance, reservation reassignment, barcode replacement, repacking, damage, write-off, void, and short-close.

Do not add Packing action-specific permission keys.

Existing non-admin roles missing `packing` must remain NONE after migration. Update role normalization and role editor defaults so opening and saving an old role cannot silently grant Packing WRITE.

## 14. Frontend ownership

### 14.1 Packing module

Route: `/app/packing`
Permission: `packing`

Owns:

- Overview
- Draft and Active Batches
- Batch source reservation
- Container construction and sealing
- Quality release
- Repacking
- Returns and damage workflows
- Batch history

It does not own the Packed Stock list.

### 14.2 Stock module

Add Packed Stock as a Stock view. It is the only Packed Stock list and action surface.

Owns:

- availability and status
- customer reservation, release, and reassignment
- barcode reprint and replacement
- unit history
- parent/child hierarchy inspection
- opening, damaged, returned, repacked, and voided filters

Do not duplicate these controls in Packing.

### 14.3 Dispatch module

Replace desktop/mobile business-logic duplication with one responsive workflow:

- shared controller/query layer
- source selector
- exact barcode scan queue
- available-source list
- dispatch draft
- customer/date/notes
- challan history and lazy details
- correction/void/return actions
- PDF preview and printing

Desktop and mobile presentations consume the same state and mutations.

### 14.4 Settings

Add Packing settings for:

- Colors
- Package Types
- Recipe families and versions
- variance thresholds
- customer restriction
- quality-hold rule
- partial-Dispatch rule

### 14.5 Reports

Add operational reporting for:

- Packing production
- Available and Reserved Packed Stock
- yield and variance
- customer-reserved units
- returns, damage, write-offs, and repacking
- LEGACY_CUTOVER and opening balances
- batch and barcode histories

## 15. Barcode history

Extend barcode history to show the complete chain:

```text
Holo Receive
-> Coning Issue
-> Coning Receive
-> Packing or Repacking batch
-> physical container hierarchy
-> customer reservation events
-> Dispatch challan and line
-> return / damage / write-off / repacking / reversal
```

Show Legacy Cutover as Inventory Adjustment. Never show it as customer Dispatch.

Exact barcode lookup must be server-authoritative. Do not use notes, lot numbers, or browser-downloaded arrays as barcode identity.

## 16. Notifications

Use existing notification infrastructure. Add only batch-level and exceptional events:

- batch completed
- batch short-closed
- quality or variance exception
- damage or write-off
- reconciliation applied or reversed
- optional customer-ready batch completion

Do not notify for every sealed unit.

## 17. Deployment hardening implementation

Implement, but do not execute, the following production safeguards:

- exact deployed SHA recording and verification
- pre-deployment database backup step
- additive migration execution separated from long backfill/cutover commands
- backend readiness endpoint that checks database connectivity and required schema
- backend and frontend container health checks
- dependency on backend health, not container-start state
- post-deploy local and public health polling
- migration-status and expected-container verification
- temporary server-enforced write gate for Dispatch, re-Coning, Packing, and affected stock mutations
- reversible cutover command
- compatibility with old browser clients during the one-release transition

Do not add a long-lived feature-flag product. The write gate is a cutover integrity control.

### 17.1 Future overnight cutover behavior supported by the code

The implementation must support this later externally authorized sequence without executing it now:

1. Restore a fresh production copy into an isolated rehearsal environment. The copy is rehearsal-only and never replaces newer live production.
2. After the final live shift, record that no operators are active.
3. Finalize the dual-verified physical snapshot and resolve all current draft Coning settlements.
4. Take a fresh live backup immediately before live changes.
5. Deploy one exact tested commit.
6. Enter WRITES_GATED before any new Packing or Dispatch V2 mutation is allowed.
7. Run historical Dispatch migration idempotently.
8. Apply LEGACY_CUTOVER.
9. Import verified Coning and Packed opening balances.
10. Record reconciliation totals, barcode uniqueness, lineage, migration state, and health evidence.
11. Move to ACTIVE and release affected writes only after explicit owner acceptance.
12. On failure, keep writes gated, move to FAILED, reverse append-only cutover changes, preserve diagnostics, and retain legacy-compatible operation.

## 18. Performance implementation constraints

- Barcode lookup must query by indexed exact identity.
- Stock and history APIs are cursor paginated.
- Page load must not fetch complete source stages merely to display counts.
- Add indexes for challan, created time, business date, customer, source, barcode, statuses, and active Packed Stock filters.
- Avoid unbounded synchronous bulk operations.
- Use server-side exports for large result sets.
- Use field projections and lazy detail loading.

## 19. Implementation work packets

The orchestrator must assign these packets exactly. A worker may touch only its owned paths. If an unlisted shared file is required, the worker must stop and ping the orchestrator.

### WP-01: Data foundation

Dependencies: none
Primary ownership:

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260820090000_add_packing_dispatch_v2/migration.sql`

Deliverables:

- `OperationalSequence` from Section 4.1
- all enums and models in Sections 5, 6, 10, and 11
- Customer `isActive`
- required relations, uniqueness constraints, checks expressible through SQL, and indexes
- additive-only migration
- no removal or rename of legacy Dispatch columns/tables

### WP-02: Inventory and Packing backend domain

Dependencies: WP-01 model contract
Primary ownership:

- `apps/backend/src/services/inventory/**`
- `apps/backend/src/services/packing/**`
- `apps/backend/src/routes/packing.js`
- `apps/backend/src/routes/packedStock.js`
- `apps/backend/src/routes/reconciliation.js`
- `apps/backend/src/utils/packingNotifications.js`
- `apps/backend/src/scripts/importPackingRecipeSeed.mjs`

Deliverables:

- authoritative Coning availability and deterministic locking
- Packing batch, source reservation, consumption, hierarchy, sealing, quality, reservation, return, damage, write-off, repacking, and events
- recipe and Packing-master operations
- idempotent 39-row DRAFT recipe seed importer from Section 5.5
- reconciliation and opening-balance services/endpoints
- module-level Packing permission enforcement

Do not edit `routes/index.js`, `routes/v2.js`, or `app.js` in this packet.

### WP-03: Dispatch V2 backend

Dependencies: WP-01 and WP-02 contracts
Primary ownership:

- `apps/backend/src/services/dispatch/**`
- `apps/backend/src/routes/dispatchV2.js`
- `apps/backend/src/utils/pdf/dispatchChallanPdf.js`
- `apps/backend/src/scripts/migrateDispatchV2.mjs`

Deliverables:

- challan/line/event/document services
- Inbound, Cutter, Holo, and Packed source adapters
- idempotent create and migration behavior
- pagination, exact barcode lookup, history/details, correction, void, return, export, and PDF endpoints
- legacy response adapters

Do not edit legacy `routes/index.js` in this packet.

### WP-04: Packing and Settings frontend

Dependencies: canonical API contract in this file
Primary ownership:

- `apps/frontend/src/pages/Packing.jsx`
- `apps/frontend/src/components/packing/**`
- `apps/frontend/src/components/settings/PackingSettings.jsx`
- `apps/frontend/src/api/packing.js`

Deliverables:

- Packing Overview and batch workflows
- source reservation and physical container builder
- sealing, label, quality, repacking, return, damage, and batch history
- Colors, Package Types, recipe families/versions, and rules UI
- shared responsive components inside this feature

Do not edit router, page barrels, navigation, global permissions, or Stock.

### WP-05: Packed Stock and Dispatch frontend

Dependencies: canonical API contract in this file
Primary ownership:

- `apps/frontend/src/components/stock/PackedStockView.jsx`
- `apps/frontend/src/hooks/usePackedStock.js`
- `apps/frontend/src/api/packedStock.js`
- `apps/frontend/src/pages/DispatchV2.jsx`
- `apps/frontend/src/components/dispatchV2/**`
- `apps/frontend/src/api/dispatchV2.js`
- `apps/frontend/src/utils/dispatchDocumentPreview.js`

Deliverables:

- Packed Stock list and all unit actions
- unified responsive Dispatch V2 workflow
- exact scan queue, source listing, draft, customer lock, parent Parcel behavior, history/detail, correction/return, PDF preview/printing
- no duplicated desktop/mobile business logic

Do not edit existing `Stock.jsx`, `Dispatch.jsx`, router, page barrels, or global API barrels.

### WP-06: Reports, lineage, and notifications

Dependencies: WP-01 model contract
Primary ownership:

- `apps/backend/src/services/packingReports/**`
- `apps/backend/src/routes/packingReports.js`
- `apps/backend/src/services/packingLineage/**`
- `apps/frontend/src/components/reports/PackingReports.jsx`
- `apps/frontend/src/api/packingReports.js`

Deliverables:

- all reports in Section 14.5
- complete Packing/Dispatch/reconciliation barcode lineage service
- report and lineage API routes
- report UI component

Notification event calls remain owned by WP-02. This packet may provide formatting helpers but must not edit WP-02 files.

### WP-07: Deployment and cutover tooling

Dependencies: WP-01 model contract and WP-02 reconciliation contract
Primary ownership:

- `.github/workflows/deploy-production.yml`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `apps/backend/src/routes/readiness.js`
- `apps/backend/src/services/cutover/**`
- `apps/backend/src/scripts/packingCutover.mjs`
- `apps/backend/src/scripts/importPackingOpeningBalance.mjs`
- `apps/backend/src/scripts/reversePackingCutover.mjs`
- `apps/backend/package.json`

Deliverables:

- deployment hardening in Section 17
- readiness and health contracts
- idempotent preview/apply/reverse cutover commands
- opening-balance import command
- affected-write gate service wiring points exposed for WP-08

Do not run deployment or live cutover commands.

### WP-08: Shared integration bridge

Dependencies: WP-01 through WP-07 complete
This packet must run after every earlier packet has pinged completion.
Primary ownership:

- `apps/backend/src/app.js`
- `apps/backend/src/routes/index.js`
- `apps/backend/src/routes/v2.js`
- `apps/backend/src/utils/permissions.js`
- `apps/backend/src/services/contractorPayments/calc.js`
- `apps/backend/src/services/contractorPayments/service.js`
- `apps/frontend/src/app/router.jsx`
- `apps/frontend/src/components/layouts/DashboardLayout.jsx`
- `apps/frontend/src/pages/index.js`
- `apps/frontend/src/pages/Stock.jsx`
- `apps/frontend/src/pages/Dispatch.jsx`
- `apps/frontend/src/pages/Reports.jsx`
- `apps/frontend/src/pages/Settings.jsx`
- `apps/frontend/src/pages/Settings/UserManagement.jsx`
- `apps/frontend/src/utils/permissions.js`
- `apps/frontend/src/api/client.js`
- `apps/frontend/src/api/index.js`
- `apps/frontend/src/components/scanner/BarcodeScanner.jsx`

Deliverables:

- register all new routers
- add Packing navigation, route, and permission UI
- wire PackedStockView into Stock only
- replace current Dispatch presentation with DispatchV2 while preserving current dirty source-detail behavior and legacy compatibility
- wire Packing reports into Reports
- make customer deactivation authoritative
- route Coning Stock, re-Coning, Box Transfer, and legacy Dispatch compatibility through the shared balance service
- disable new Coning Dispatch selection without hiding historical Coning records
- extend barcode scanner prefixes/lookup through the authoritative endpoint
- enforce explicit opening-stock classification for contractor payment exclusion
- preserve every unrelated and pre-existing dirty change

## 20. Cross-packet rules

- WP-01 freezes model and field names. Later packets must not invent alternate models.
- WP-02 owns inventory and Packing business rules. Other packets call its services.
- WP-03 owns Dispatch V2 business rules. Other packets call its services.
- WP-04 and WP-05 own feature UI, not shared route/navigation files.
- WP-08 is the only packet allowed to edit shared integration files listed in WP-08.
- No worker may reformat or mechanically rewrite unrelated code.
- No worker may modify another packet's files without an explicit orchestrator reassignment sent through the thread tool.
- If a worker finds a contradiction, it must stop, leave the tree coherent, and ping the orchestrator with `NEEDS_DECISION`.

## 21. Implementation completion contract

Implementation is complete only when the local code contains every required model, service, endpoint, UI surface, compatibility bridge, migration command, cutover command, permission path, report, lineage path, document path, and deployment safeguard specified above.

Completion does not authorize:

- committing
- pushing
- deploying
- production database mutation
- production cutover

Those remain separate user gates.
