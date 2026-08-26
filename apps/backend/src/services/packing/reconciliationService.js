import prisma from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { runIdempotent } from '../inventory/idempotency.js';
import {
  assertConingAvailability,
  getConingAvailability,
  lockConingSources,
  lockPackedSources,
  lockPackingSourcesForConing,
  lockPackingSourcesForPackedUnits,
  EPSILON,
} from '../inventory/coningBalance.js';
import { allocateAdjustmentBatchNo, allocatePackingBatchNo, allocatePackingUnitBarcode, allocateUnitSequence } from './sequence.js';
import {
  actorCreateFields,
  actorUpdateFields,
  batchInclude,
  createPackedUnitEvent,
  lockRecord,
  packedUnitInclude,
  recipeInclude,
} from './common.js';
import { BATCH_STATUSES, PACKING_EVENT_TYPES, UNIT_STATUSES } from './constants.js';
import {
  badRequest,
  conflict,
  notFound,
  optionalString,
  parseDate,
  parseNonNegativeNumber,
  parsePositiveInt,
  requireNonEmptyString,
} from './errors.js';
import { serialize } from './serialization.js';
import { transitionUnit } from './transitionService.js';
import { generatePackedUnitLabel } from './labelService.js';

const ADJUSTMENT_KINDS = ['LEGACY_CUTOVER', 'MANUAL_CORRECTION', 'DAMAGE_WRITE_OFF', 'OPENING_BALANCE'];
const ADJUSTMENT_STATUSES = ['DRAFT', 'APPLIED', 'REVERSED', 'FAILED'];

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function calculateAdjustmentPreviewBalance({ count, weight, countDelta = 0, weightDeltaKg = 0 } = {}) {
  const beforeCount = numberOrZero(count);
  const beforeWeight = numberOrZero(weight);
  return {
    before: { count: beforeCount, weight: beforeWeight },
    after: {
      count: beforeCount + numberOrZero(countDelta),
      weight: beforeWeight + numberOrZero(weightDeltaKg),
    },
  };
}

function normalizeAdjustmentLines(lines, { allowZero = false } = {}) {
  if (!Array.isArray(lines)) throw badRequest('lines_required', 'lines must be an array.');
  if (lines.length > 1000) throw badRequest('too_many_lines', 'A reconciliation request may contain at most 1000 lines.');
  const seen = new Set();
  return lines.map((line) => {
    const sourceType = requireNonEmptyString(line?.sourceType, 'sourceType', 100).toUpperCase();
    const sourceId = requireNonEmptyString(line?.sourceId, 'sourceId', 200);
    const identity = `${sourceType}:${sourceId}`;
    if (seen.has(identity)) throw badRequest('duplicate_adjustment_line', 'Each adjustment source may appear only once per batch.', { sourceType, sourceId });
    seen.add(identity);
    const countDelta = Number(line?.countDelta ?? 0);
    const weightDeltaKg = Number(line?.weightDeltaKg ?? 0);
    if (!Number.isInteger(countDelta) || !Number.isFinite(weightDeltaKg)) throw badRequest('invalid_adjustment_delta', 'countDelta must be an integer and weightDeltaKg must be finite.', { sourceType, sourceId });
    if (!allowZero && countDelta === 0 && Math.abs(weightDeltaKg) <= EPSILON) throw badRequest('empty_adjustment_line', 'An adjustment line must change count or weight.', { sourceType, sourceId });
    return {
      sourceType,
      sourceId,
      countDelta,
      weightDeltaKg,
      sourceBarcode: optionalString(line?.sourceBarcode, 250),
      sourceItemSnapshot: line?.sourceItemSnapshot && typeof line.sourceItemSnapshot === 'object' ? line.sourceItemSnapshot : {},
      sourceLotSnapshot: line?.sourceLotSnapshot && typeof line.sourceLotSnapshot === 'object' ? line.sourceLotSnapshot : {},
      sourceConeSnapshot: line?.sourceConeSnapshot && typeof line.sourceConeSnapshot === 'object' ? line.sourceConeSnapshot : {},
      replacementSourceId: optionalString(line?.replacementSourceId, 200),
      replacementUnitId: optionalString(line?.replacementUnitId, 200),
    };
  });
}

function evidenceIdentities(evidence) {
  const source = evidence && typeof evidence === 'object' ? evidence : {};
  const preparer = source.preparerUserId || source.preparerId || source.preparedByUserId || source.preparedBy || source.preparer;
  const verifier = source.verifierUserId || source.verifierId || source.verifiedByUserId || source.verifiedBy || source.verifier;
  return { preparer: preparer ? String(preparer).trim() : '', verifier: verifier ? String(verifier).trim() : '' };
}

async function verifyEvidenceUsers(tx, evidence) {
  const identities = evidenceIdentities(evidence);
  if (!identities.preparer || !identities.verifier) throw badRequest('dual_verification_required', 'Opening balances require preparer and verifier identities.');
  async function resolve(raw, field) {
    const byId = await tx.user.findUnique({ where: { id: raw }, select: { id: true, username: true, displayName: true, isActive: true } });
    const user = byId || await tx.user.findUnique({ where: { username: raw }, select: { id: true, username: true, displayName: true, isActive: true } });
    if (!user || user.isActive === false) throw badRequest('evidence_user_invalid', `${field} must identify an active authoritative user.`, { field, identity: raw });
    return user;
  }
  const preparer = await resolve(identities.preparer, 'preparer');
  const verifier = await resolve(identities.verifier, 'verifier');
  if (preparer.id === verifier.id) throw badRequest('dual_verification_required', 'Preparer and verifier must be distinct authoritative users.', { userId: preparer.id });
  return { preparer, verifier };
}

async function findAdjustmentBatch(tx, id, { include = true } = {}) {
  const batch = await tx.inventoryAdjustmentBatch.findUnique({ where: { id: String(id) }, ...(include ? { include: { lines: { orderBy: { createdAt: 'asc' } }, launchState: true } } : {}) });
  if (!batch) throw notFound('reconciliation_batch_not_found', 'Reconciliation batch not found.', { id });
  return batch;
}

async function findAdjustmentBatchForUpdate(tx, id) {
  await lockRecord(tx, 'InventoryAdjustmentBatch', id, 'reconciliation_batch_not_found', 'Reconciliation batch not found.');
  return findAdjustmentBatch(tx, id);
}

function linkedCutoverId(evidenceSnapshot) {
  const value = evidenceSnapshot && typeof evidenceSnapshot === 'object' ? evidenceSnapshot.cutoverBatchId : null;
  return value ? String(value).trim() : '';
}

async function findActiveOpeningBatchesForCutover(tx, cutoverBatchId) {
  const id = requireNonEmptyString(cutoverBatchId, 'cutoverBatchId', 100);
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "InventoryAdjustmentBatch"
    WHERE "kind"::text = 'OPENING_BALANCE'
      AND "status"::text IN ('DRAFT', 'APPLIED')
      AND "evidenceSnapshot"->>'cutoverBatchId' = ${id}
    ORDER BY "createdAt" ASC, "id" ASC
    FOR UPDATE
  `);
  if (!rows.length) return [];
  return tx.inventoryAdjustmentBatch.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: { lines: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function createLines(tx, batchId, lines, actorUserId) {
  for (const line of lines) {
    await tx.inventoryAdjustmentLine.create({
      data: {
        batchId,
        ...line,
        ...actorCreateFields(actorUserId),
      },
    });
  }
}

async function assertGlobalBarcodeAvailable(tx, barcode) {
  const value = requireNonEmptyString(barcode, 'barcode', 250);
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'opening-barcode:' + value}))`);
  const [packed, coning, holo, inbound, cutterIssue, holoIssue, coningIssue, cutterReceive, legacyDispatch] = await Promise.all([
    tx.packedUnit.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.receiveFromConingMachineRow.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.receiveFromHoloMachineRow.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.inboundItem.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.issueToCutterMachine.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.issueToHoloMachine.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.issueToConingMachine.findUnique({ where: { barcode: value }, select: { id: true } }),
    tx.receiveFromCutterMachineRow.findFirst({ where: { barcode: value }, select: { id: true } }),
    tx.dispatch.findFirst({ where: { stageBarcode: value }, select: { id: true } }),
  ]);
  if (packed || coning || holo || inbound || cutterIssue || holoIssue || coningIssue || cutterReceive || legacyDispatch) throw conflict('barcode_in_use', 'The opening-balance barcode is already used.', { barcode });
  return value;
}

async function assertDraftConingSettlementsClear(tx) {
  const count = await tx.contractorSettlement.count({ where: { process: 'coning', status: 'draft' } });
  if (count > 0) throw conflict('draft_coning_settlements_exist', 'Cutover cannot be applied while Coning contractor settlements remain draft.', { count });
}

async function requireWritesGatedForCutover(tx) {
  const launchState = await tx.packingLaunchState.findUnique({ where: { id: 'packing_dispatch_v2' } });
  if (!launchState || launchState.status !== 'WRITES_GATED' || launchState.affectedWritesPaused !== true) {
    throw conflict('writes_not_gated', 'LEGACY_CUTOVER requires PackingLaunchState WRITES_GATED with affectedWritesPaused=true before any cutover mutation.', {
      status: launchState?.status || null,
      affectedWritesPaused: launchState?.affectedWritesPaused || false,
    });
  }
  return launchState;
}

async function writeAdjustmentAudit(tx, { batchId, action, actorUserId, payload }) {
  await tx.auditLog.create({
    data: {
      entityType: 'inventory_adjustment_batch',
      entityId: batchId,
      action,
      actorUserId: actorUserId || null,
      payload: serialize(payload || {}),
    },
  });
}

async function validateAdjustmentLinesBeforeApply(tx, lines) {
  const coningIds = lines.filter((line) => ['CONING_RECEIVE', 'CONING'].includes(line.sourceType)).map((line) => line.sourceId);
  const packedIds = lines.filter((line) => line.sourceType === 'PACKED_UNIT').map((line) => line.sourceId);
  await lockConingSources(tx, coningIds);
  await lockPackedSources(tx, packedIds);
  await lockPackingSourcesForConing(tx, coningIds);
  await lockPackingSourcesForPackedUnits(tx, packedIds);
  for (const line of lines) {
    if (['CONING_RECEIVE', 'CONING'].includes(line.sourceType)) {
      const balance = await getConingAvailability(tx, line.sourceId);
      const after = { count: balance.available.count + line.countDelta, weight: balance.available.weight + line.weightDeltaKg };
      if (balance.invariantBroken || after.count < -EPSILON || after.weight < -0.001) throw badRequest('negative_adjusted_balance', 'An adjustment would create a negative authoritative balance.', { sourceId: line.sourceId, before: balance.available, delta: { count: line.countDelta, weight: line.weightDeltaKg }, after });
    }
    if (line.sourceType === 'PACKED_UNIT') {
      const unit = await tx.packedUnit.findUnique({ where: { id: line.sourceId }, select: { id: true, baseCount: true, netWeightKg: true, status: true } });
      if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit adjustment source not found.', { sourceId: line.sourceId });
      if (Number(unit.baseCount) + line.countDelta < 0 || Number(unit.netWeightKg) + line.weightDeltaKg < -0.001) throw badRequest('negative_adjusted_balance', 'An adjustment would create a negative Packed Unit balance.', { sourceId: line.sourceId });
    }
  }
}

async function openPackedCorrectionParent(tx, unit, reason, actorUserId, idempotencyKey) {
  if (!unit.parentUnitId) return null;
  await lockRecord(tx, 'PackedUnit', unit.parentUnitId, 'parent_unit_not_found', 'The Packed Unit correction parent was not found.');
  const parent = await tx.packedUnit.findUnique({ where: { id: unit.parentUnitId }, include: packedUnitInclude });
  if (!parent) throw notFound('parent_unit_not_found', 'The Packed Unit correction parent was not found.', { parentUnitId: unit.parentUnitId });
  if (parent.status === UNIT_STATUSES.OPENED) return parent;
  if (![UNIT_STATUSES.QUALITY_HOLD, UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(parent.status)) {
    throw conflict('packed_correction_parent_locked', 'A Packed Unit correction cannot replace a child under a retired or dispatched parent.', { parentUnitId: parent.id, status: parent.status });
  }
  if ([UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(parent.status)) transitionUnit(parent.status, UNIT_STATUSES.OPENED);
  const opened = await tx.packedUnit.update({ where: { id: parent.id }, data: { status: UNIT_STATUSES.OPENED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
  await createPackedUnitEvent(tx, {
    batchId: parent.batchId,
    unitId: parent.id,
    type: PACKING_EVENT_TYPES.UNIT_SPLIT,
    reason,
    payload: { physicalReplacement: true, affectedChildUnitId: unit.id, beforeStatus: parent.status, afterStatus: opened.status, correctionBatchId: unit.batchId },
    idempotencyKey: `${idempotencyKey}:parent-open:${parent.id}`,
    actorUserId,
  });
  return opened;
}

async function applyPackedUnitAdjustment(tx, batch, line, actorUserId, idempotencyKey) {
  const unit = await tx.packedUnit.findUnique({ where: { id: line.sourceId }, include: packedUnitInclude });
  if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit adjustment source not found.', { sourceId: line.sourceId });
  if ([UNIT_STATUSES.DISPATCHED, UNIT_STATUSES.REPACKED, UNIT_STATUSES.SPLIT_CONSUMED, UNIT_STATUSES.VOIDED].includes(unit.status)) {
    throw conflict('packed_unit_adjustment_locked', 'A dispatched or retired Packed Unit cannot receive a correction adjustment.', { sourceId: line.sourceId, status: unit.status });
  }
  const activeSourceReservation = await tx.packingBatchSource.findFirst({
    where: { sourceType: 'PACKED_UNIT', sourceId: unit.id, batch: { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'] } } },
    select: { batchId: true },
  });
  if (activeSourceReservation) throw conflict('packed_unit_adjustment_locked', 'A Packed Unit reserved for Repacking cannot be corrected until that batch resolves.', { sourceId: unit.id, batchId: activeSourceReservation.batchId });
  const adjustedBaseCount = Number(unit.baseCount) + Number(line.countDelta || 0);
  const adjustedWeight = Number(unit.netWeightKg) + Number(line.weightDeltaKg || 0);
  if (adjustedBaseCount < 0 || adjustedWeight < -0.001) throw badRequest('negative_adjusted_balance', 'A Packed Unit adjustment would create a negative balance.', { sourceId: unit.id, adjustedBaseCount, adjustedWeight });
  const intendedStatus = adjustedBaseCount <= 0 || adjustedWeight <= 0.001 ? UNIT_STATUSES.VOIDED : unit.status;
  if (intendedStatus === UNIT_STATUSES.OPENED) throw conflict('packed_unit_adjustment_locked', 'An OPENED Packed Unit cannot receive a correction replacement.', { sourceId: unit.id });
  const sequence = await allocateUnitSequence(tx, unit.batchId, unit.levelIndex);
  const replacementBarcode = intendedStatus === UNIT_STATUSES.VOIDED
    ? null
    : await allocatePackingUnitBarcode(tx, unit.batch?.batchNo, unit.levelIndex, sequence);
  const replacement = await tx.packedUnit.create({
    data: {
      batchId: unit.batchId,
      recipeId: unit.recipeId,
      packageTypeId: unit.packageTypeId,
      parentUnitId: unit.parentUnitId,
      levelIndex: unit.levelIndex,
      unitSequence: sequence,
      barcode: replacementBarcode,
      isStockUnit: unit.isStockUnit,
      status: intendedStatus === UNIT_STATUSES.VOIDED ? UNIT_STATUSES.VOIDED : UNIT_STATUSES.LABEL_PENDING,
      itemId: unit.itemId,
      wrapperId: unit.wrapperId,
      colorId: unit.colorId,
      coneTypeId: unit.coneTypeId,
      customerId: unit.customerId,
      nominalGram: unit.nominalGram,
      baseCount: adjustedBaseCount,
      grossWeightKg: adjustedWeight + Number(unit.tareWeightKg || 0),
      tareWeightKg: unit.tareWeightKg,
      netWeightKg: adjustedWeight,
      labelPrintCount: 0,
      sealedAt: new Date(),
      qualityReleasedAt: null,
      ...actorCreateFields(actorUserId),
    },
    include: packedUnitInclude,
  });
  let label = null;
  let labelPending = false;
  let replacementStatus = replacement.status;
  if (intendedStatus !== UNIT_STATUSES.VOIDED) {
    try {
      label = generatePackedUnitLabel(replacement);
    } catch (error) {
      labelPending = true;
      await createPackedUnitEvent(tx, {
        batchId: replacement.batchId,
        unitId: replacement.id,
        type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING,
        reason: error?.message || 'Label generation failed for correction replacement.',
        payload: { physicalReplacement: true, available: false, barcode: replacementBarcode, error: error?.code || 'label_generation_failed' },
        idempotencyKey: `${idempotencyKey}:packed-adjustment-label-pending:${line.id}`,
        actorUserId,
      });
    }
    if (!labelPending) {
      if (intendedStatus === UNIT_STATUSES.QUALITY_HOLD || intendedStatus === UNIT_STATUSES.AVAILABLE || intendedStatus === UNIT_STATUSES.RESERVED) transitionUnit(UNIT_STATUSES.LABEL_PENDING, intendedStatus);
      replacementStatus = intendedStatus;
      const updated = await tx.packedUnit.update({ where: { id: replacement.id }, data: { status: replacementStatus, labelPrintCount: 1, qualityReleasedAt: replacementStatus === UNIT_STATUSES.QUALITY_HOLD ? null : new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
      replacement.status = updated.status;
      replacement.labelPrintCount = updated.labelPrintCount;
      replacement.qualityReleasedAt = updated.qualityReleasedAt;
    }
  }
  const openedParent = await openPackedCorrectionParent(tx, unit, batch.reason, actorUserId, idempotencyKey);
  await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.REPACKED, replacedByUnitId: replacement.id, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
  const sourceConeSnapshot = {
    ...(line.sourceConeSnapshot || {}),
    packedUnitAdjustment: {
      originalStatus: unit.status,
      originalCustomerId: unit.customerId,
      originalBaseCount: Number(unit.baseCount),
      originalWeightKg: Number(unit.netWeightKg),
      replacementUnitId: replacement.id,
      replacementStatus,
      intendedStatus,
      label,
      labelPending,
      parentUnitId: unit.parentUnitId,
      parentOpened: Boolean(openedParent && openedParent.status === UNIT_STATUSES.OPENED),
    },
  };
  await tx.inventoryAdjustmentLine.update({ where: { id: line.id }, data: { replacementUnitId: replacement.id, sourceConeSnapshot: serialize(sourceConeSnapshot), ...actorUpdateFields(actorUserId) } });
  await createPackedUnitEvent(tx, {
    batchId: unit.batchId,
    unitId: unit.id,
    type: PACKING_EVENT_TYPES.UNIT_REPACKED,
    reason: batch.reason,
    payload: { physicalReplacement: true, adjustmentBatchId: batch.id, adjustmentLineId: line.id, before: { status: unit.status, baseCount: unit.baseCount, netWeightKg: unit.netWeightKg }, after: { replacementUnitId: replacement.id, status: replacement.status, baseCount: replacement.baseCount, netWeightKg: replacement.netWeightKg, label, labelPending }, parent: openedParent ? { id: openedParent.id, status: openedParent.status } : null },
    idempotencyKey: `${idempotencyKey}:packed-adjustment:${line.id}`,
    actorUserId,
  });
  if (intendedStatus !== UNIT_STATUSES.VOIDED) {
    await createPackedUnitEvent(tx, {
      batchId: replacement.batchId,
      unitId: replacement.id,
      type: PACKING_EVENT_TYPES.UNIT_SEALED,
      reason: batch.reason,
      payload: { physicalReplacement: true, adjustmentBatchId: batch.id, adjustmentLineId: line.id, replacementOfUnitId: unit.id, baseCount: replacement.baseCount, netWeightKg: replacement.netWeightKg, status: replacement.status, label, labelPending },
      idempotencyKey: `${idempotencyKey}:packed-adjustment-sealed:${line.id}`,
      actorUserId,
    });
  }
  return replacement;
}

async function assertOpeningConingReplacementPristine(tx, line) {
  const row = await tx.receiveFromConingMachineRow.findUnique({ where: { id: line.replacementSourceId } });
  if (!row || !row.isOpeningStock || row.isDeleted) throw conflict('opening_source_not_pristine', 'Opening Coning replacement is missing, deleted, or not explicitly classified as opening stock.', { sourceId: line.replacementSourceId });
  const balance = await getConingAvailability(tx, row.id);
  if (row.dispatchedCount !== 0 || Math.abs(Number(row.dispatchedWeight || 0)) > 0.001
      || balance.reconing.count !== 0 || Math.abs(balance.reconing.weight) > 0.001
      || balance.packing.consumed.count !== 0 || Math.abs(balance.packing.consumed.weight) > 0.001
      || balance.packing.reserved.count !== 0 || Math.abs(balance.packing.reserved.weight) > 0.001
      || balance.adjustments.count !== 0 || Math.abs(balance.adjustments.weight) > 0.001) {
    throw conflict('opening_source_in_use', 'Opening Coning replacement has downstream consumption, reservation, or balance adjustments.', { sourceId: row.id, balance });
  }
  const [descendants, transfers, takeBackLines, settlements, dispatches, packingSources, otherAdjustmentLines] = await Promise.all([
    tx.$queryRaw(Prisma.sql`SELECT "id" FROM "IssueToConingMachine" WHERE "isDeleted" = false AND EXISTS (SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS element WHERE element->>'rowId' = ${row.id} OR element->>'barcode' = ${row.barcode || null})`),
    tx.boxTransfer.count({ where: { stage: 'coning', OR: [{ fromItemId: row.id }, { toItemId: row.id }] } }),
    tx.issueTakeBackLine.count({ where: { sourceId: row.id, takeBack: { stage: 'coning' } } }),
    tx.contractorSettlementLine.count({ where: { process: 'coning', sourceRowId: row.id } }),
    tx.dispatch.count({ where: { stage: 'coning', stageItemId: row.id } }),
    tx.packingBatchSource.count({ where: { sourceType: 'CONING_RECEIVE', sourceId: row.id } }),
    tx.inventoryAdjustmentLine.count({ where: { OR: [{ sourceId: row.id }, { replacementSourceId: row.id }], NOT: { id: line.id } } }),
  ]);
  if (descendants.length || transfers || takeBackLines || settlements || dispatches || packingSources || otherAdjustmentLines) {
    throw conflict('opening_source_lineage_not_pristine', 'Opening Coning replacement has downstream lineage and cannot be reversed.', { sourceId: row.id, descendants: descendants.length, transfers, takeBackLines, settlements, dispatches, packingSources, otherAdjustmentLines });
  }
  return row;
}

async function assertOpeningPackedReplacementPristine(tx, line) {
  const unit = await tx.packedUnit.findUnique({ where: { id: line.replacementUnitId }, include: packedUnitInclude });
  const pristineStatus = unit && [UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.QUALITY_HOLD, UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(unit.status);
  const customerAssignmentAllowed = unit && (unit.status === UNIT_STATUSES.RESERVED ? Boolean(unit.customerId) : (unit.status === UNIT_STATUSES.AVAILABLE ? !unit.customerId : true));
  if (!unit || !unit.isStockUnit || !pristineStatus || !customerAssignmentAllowed || unit.parentUnitId || unit.replacedByUnitId || unit.splitFromUnitId) {
    throw conflict('opening_unit_not_pristine', 'Opening Packed Unit replacement is reserved, transformed, nested, replaced, or otherwise not pristine.', { unitId: line.replacementUnitId, status: unit?.status || null });
  }
  const [dispatchLines, directDispatchLines, packingSources, childUnits, adjustmentLines, events] = await Promise.all([
    tx.dispatchLine.count({ where: { parentPackedUnitId: unit.id } }),
    tx.dispatchLine.count({ where: { sourceType: 'PACKED', sourceId: unit.id } }),
    tx.packingBatchSource.count({ where: { sourceType: 'PACKED_UNIT', sourceId: unit.id } }),
    tx.packedUnit.count({ where: { parentUnitId: unit.id } }),
    tx.inventoryAdjustmentLine.count({ where: { replacementUnitId: unit.id, NOT: { id: line.id } } }),
    tx.packedUnitEvent.findMany({ where: { unitId: unit.id }, select: { type: true, payload: true } }),
  ]);
  const reservationEvents = events.filter((event) => event.type === PACKING_EVENT_TYPES.UNIT_RESERVED);
  const pendingLabelEvents = events.filter((event) => event.type === PACKING_EVENT_TYPES.UNIT_LABEL_PENDING);
  const invalidEvents = events.filter((event) => {
    if (event.type === PACKING_EVENT_TYPES.UNIT_SEALED) return false;
    if (event.type === PACKING_EVENT_TYPES.UNIT_RESERVED) return Boolean(unit.customerId) && event.payload?.customerId === unit.customerId;
    return event.type === PACKING_EVENT_TYPES.UNIT_LABEL_PENDING && event.payload?.openingImport === true;
  });
  const reservationShapeValid = unit.status === UNIT_STATUSES.RESERVED || unit.status === UNIT_STATUSES.QUALITY_HOLD || unit.status === UNIT_STATUSES.LABEL_PENDING
    ? (unit.customerId ? reservationEvents.length === 1 : reservationEvents.length === 0)
    : reservationEvents.length === 0;
  const labelShapeValid = unit.status === UNIT_STATUSES.LABEL_PENDING ? pendingLabelEvents.length === 1 : pendingLabelEvents.length === 0;
  if (dispatchLines || directDispatchLines || packingSources || childUnits || adjustmentLines || invalidEvents.length || !reservationShapeValid || !labelShapeValid) {
    throw conflict('opening_unit_lineage_not_pristine', 'Opening Packed Unit replacement has downstream lineage or non-seal events and cannot be reversed.', { unitId: unit.id, dispatchLines, directDispatchLines, packingSources, childUnits, adjustmentLines, events: events.map((event) => event.type) });
  }
  return unit;
}

async function lockOpeningReplacementIdentities(tx, lines) {
  const coningIds = lines.map((line) => line.replacementSourceId).filter(Boolean).sort();
  const packedIds = lines.map((line) => line.replacementUnitId).filter(Boolean).sort();
  await lockConingSources(tx, coningIds);
  await lockPackedSources(tx, packedIds);
  await lockPackingSourcesForConing(tx, coningIds);
  await lockPackingSourcesForPackedUnits(tx, packedIds);
}

async function restorePackedUnitAdjustment(tx, originalLine, reversalBatch, actorUserId, idempotencyKey, reason) {
  const replacement = await tx.packedUnit.findUnique({ where: { id: originalLine.replacementUnitId }, include: packedUnitInclude });
  const metadata = originalLine.sourceConeSnapshot?.packedUnitAdjustment;
  if (!replacement || !metadata) throw conflict('packed_adjustment_lineage_missing', 'Packed Unit adjustment replacement metadata is missing.', { lineId: originalLine.id });
  const dispatchLines = await tx.dispatchLine.count({ where: { OR: [{ parentPackedUnitId: replacement.id }, { sourceType: 'PACKED', sourceId: replacement.id }] } });
  const sourceUses = await tx.packingBatchSource.count({ where: { sourceType: 'PACKED_UNIT', sourceId: replacement.id } });
  if (dispatchLines || sourceUses || replacement.status === UNIT_STATUSES.DISPATCHED) throw conflict('packed_adjustment_in_use', 'A corrected Packed Unit replacement has downstream usage and cannot be reversed.', { replacementUnitId: replacement.id, dispatchLines, sourceUses });
  await tx.packedUnit.update({ where: { id: replacement.id }, data: { status: UNIT_STATUSES.VOIDED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
  await tx.packedUnit.update({ where: { id: originalLine.sourceId }, data: { status: metadata.originalStatus, customerId: metadata.originalCustomerId || null, replacedByUnitId: null, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
  await createPackedUnitEvent(tx, { batchId: replacement.batchId, unitId: replacement.id, type: PACKING_EVENT_TYPES.EVENT_REVERSED, reason, payload: { reversalBatchId: reversalBatch.id, originalAdjustmentLineId: originalLine.id, restoredUnitId: originalLine.sourceId }, idempotencyKey: `${idempotencyKey}:packed:${replacement.id}`, actorUserId });
}

export async function createReconciliationBatch({ payload, actorUserId, idempotencyKey, client = prisma }) {
  const kind = requireNonEmptyString(payload?.kind, 'kind', 100).toUpperCase();
  if (!ADJUSTMENT_KINDS.includes(kind)) throw badRequest('invalid_adjustment_kind', 'Invalid reconciliation batch kind.', { allowed: ADJUSTMENT_KINDS });
  const reason = requireNonEmptyString(payload?.reason, 'reason', 2000);
  const effectiveAt = parseDate(payload?.effectiveAt || new Date(), 'effectiveAt');
  const evidenceSnapshot = payload?.evidenceSnapshot && typeof payload.evidenceSnapshot === 'object' ? payload.evidenceSnapshot : {};
  const lines = payload?.lines === undefined ? [] : normalizeAdjustmentLines(payload.lines);
  return runIdempotent({ operation: 'reconciliation.batch.create', idempotencyKey, actorUserId, client, work: async (tx) => {
    const batchNo = await allocateAdjustmentBatchNo(tx, effectiveAt);
    const created = await tx.inventoryAdjustmentBatch.create({
      data: {
        batchNo,
        kind,
        status: 'DRAFT',
        effectiveAt,
        reason,
        evidenceSnapshot: serialize(evidenceSnapshot),
        idempotencyKey: String(idempotencyKey),
        lines: lines.length ? { create: lines.map((line) => ({ ...line, ...actorCreateFields(actorUserId) })) } : undefined,
        ...actorCreateFields(actorUserId),
      },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    return serialize(created);
  } });
}

export async function listReconciliationBatches({ status, kind, cursor, limit = 50, client = prisma } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const where = {};
  if (status) {
    const normalized = String(status).toUpperCase();
    if (!ADJUSTMENT_STATUSES.includes(normalized)) throw badRequest('invalid_adjustment_status', 'Invalid reconciliation status.');
    where.status = normalized;
  }
  if (kind) {
    const normalized = String(kind).toUpperCase();
    if (!ADJUSTMENT_KINDS.includes(normalized)) throw badRequest('invalid_adjustment_kind', 'Invalid reconciliation batch kind.');
    where.kind = normalized;
  }
  const rows = await client.inventoryAdjustmentBatch.findMany({
    where,
    take: take + 1,
    ...(cursor ? { skip: 1, cursor: { id: String(cursor) } } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { lines: { orderBy: { createdAt: 'asc' } } },
  });
  const hasMore = rows.length > take;
  const batches = hasMore ? rows.slice(0, take) : rows;
  return { batches, nextCursor: hasMore ? batches[batches.length - 1].id : null };
}

export async function getReconciliationBatch(id, client = prisma) {
  return findAdjustmentBatch(client, id);
}

export async function previewReconciliationBatch({ id, payload, client = prisma }) {
  const batch = await getReconciliationBatch(id, client);
  const lines = payload?.lines === undefined ? batch.lines : normalizeAdjustmentLines(payload.lines, { allowZero: true });
  const preview = [];
  for (const line of lines) {
    if (['CONING_RECEIVE', 'CONING'].includes(line.sourceType)) {
      const balance = await getConingAvailability(client, line.sourceId);
      const balances = calculateAdjustmentPreviewBalance({ ...balance.available, ...line });
      preview.push({ ...serialize(line), before: balances.before, after: balances.after });
    } else if (line.sourceType === 'PACKED_UNIT') {
      const unit = await client.packedUnit.findUnique({ where: { id: line.sourceId }, select: { id: true, baseCount: true, netWeightKg: true, status: true } });
      if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit adjustment source not found.', { sourceId: line.sourceId });
      const balances = calculateAdjustmentPreviewBalance({ count: unit.baseCount, weight: unit.netWeightKg, ...line });
      preview.push({ ...serialize(line), before: { ...balances.before, status: unit.status }, after: { ...balances.after, status: unit.status } });
    } else {
      preview.push({ ...serialize(line), before: null, after: null });
    }
  }
  const invalid = preview.filter((line) => line.after && (Number(line.after.count) < 0 || Number(line.after.weight) < -0.001));
  return { batch, lines: preview, valid: invalid.length === 0, errors: invalid.map((line) => ({ sourceId: line.sourceId, error: 'negative_adjusted_balance' })) };
}

export async function applyReconciliationBatch({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'reconciliation.batch.apply', idempotencyKey, actorUserId, client, work: async (tx) => {
    const batch = await findAdjustmentBatchForUpdate(tx, batchId);
    if (batch.status !== 'DRAFT') throw conflict('adjustment_not_draft', 'Only a DRAFT reconciliation batch can be applied.', { status: batch.status });
    let lines = batch.lines;
    if (payload?.lines !== undefined) {
      if (lines.length) throw conflict('adjustment_lines_immutable', 'A batch with stored lines cannot replace them during apply.');
      lines = normalizeAdjustmentLines(payload.lines);
      await createLines(tx, batch.id, lines, actorUserId);
      lines = await tx.inventoryAdjustmentLine.findMany({ where: { batchId: batch.id }, orderBy: { createdAt: 'asc' } });
    }
    if (!lines.length) throw badRequest('lines_required', 'At least one adjustment line is required before apply.');
    if (batch.kind === 'LEGACY_CUTOVER') await requireWritesGatedForCutover(tx);
    if (batch.kind === 'LEGACY_CUTOVER' || batch.kind === 'OPENING_BALANCE') await assertDraftConingSettlementsClear(tx);
    await validateAdjustmentLinesBeforeApply(tx, lines);
    for (const line of lines) {
      if (line.sourceType === 'PACKED_UNIT') await applyPackedUnitAdjustment(tx, batch, line, actorUserId, idempotencyKey);
    }
    const applied = await tx.inventoryAdjustmentBatch.update({ where: { id: batch.id }, data: { status: 'APPLIED', appliedAt: new Date(), appliedByUserId: actorUserId || null, ...actorUpdateFields(actorUserId) }, include: { lines: { orderBy: { createdAt: 'asc' } } } });
    await writeAdjustmentAudit(tx, { batchId: batch.id, action: 'apply', actorUserId, payload: { kind: batch.kind, lineCount: lines.length, effectiveAt: batch.effectiveAt } });
    if (batch.kind === 'LEGACY_CUTOVER') {
      await tx.packingLaunchState.upsert({
        where: { id: 'packing_dispatch_v2' },
        update: { status: 'CUTOVER_APPLIED', affectedWritesPaused: true, adjustmentBatchId: batch.id, cutoffAt: batch.effectiveAt, ...actorUpdateFields(actorUserId) },
        create: { id: 'packing_dispatch_v2', status: 'CUTOVER_APPLIED', affectedWritesPaused: true, adjustmentBatchId: batch.id, cutoffAt: batch.effectiveAt, updatedByUserId: actorUserId || null },
      });
    }
    return serialize(applied);
  } });
}

export async function reverseReconciliationBatch({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const reason = requireNonEmptyString(payload?.reason, 'reason', 2000);
  return runIdempotent({ operation: 'reconciliation.batch.reverse', idempotencyKey, actorUserId, client, work: async (tx) => {
    const batch = await findAdjustmentBatchForUpdate(tx, batchId);
    assertReversalBoundary(batch);
    const lines = batch.lines;
    await lockOpeningReplacementIdentities(tx, lines.filter((line) => line.replacementSourceId || line.replacementUnitId));
    if (['LEGACY_CUTOVER', 'OPENING_BALANCE'].includes(batch.kind)) {
      for (const line of lines) {
        if (line.replacementSourceId) await assertOpeningConingReplacementPristine(tx, line);
        if (line.replacementUnitId) await assertOpeningPackedReplacementPristine(tx, line);
      }
    }
    if (batch.kind === 'LEGACY_CUTOVER') {
      const linkedOpeningBatches = await findActiveOpeningBatchesForCutover(tx, batch.id);
      if (linkedOpeningBatches.length) {
        throw conflict('opening_reversal_required', 'Every active OPENING_BALANCE batch linked to this cutover must be reversed before the LEGACY_CUTOVER can be reversed.', {
          cutoverBatchId: batch.id,
          openingBatchIds: linkedOpeningBatches.map((openingBatch) => openingBatch.id),
        });
      }
    }
    const reversalNo = await allocateAdjustmentBatchNo(tx);
    const reversal = await tx.inventoryAdjustmentBatch.create({
      data: {
        batchNo: reversalNo,
        kind: batch.kind,
        status: 'APPLIED',
        effectiveAt: new Date(),
        reason,
        evidenceSnapshot: serialize({ reversalOfBatchId: batch.id, originalEvidence: batch.evidenceSnapshot }),
        idempotencyKey: `${idempotencyKey}:reversal`,
        appliedAt: new Date(),
        appliedByUserId: actorUserId || null,
        lines: { create: lines.map((line) => ({
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          countDelta: -Number(line.countDelta || 0),
          weightDeltaKg: -Number(line.weightDeltaKg || 0),
          sourceBarcode: line.sourceBarcode,
          sourceItemSnapshot: line.sourceItemSnapshot,
          sourceLotSnapshot: line.sourceLotSnapshot,
          sourceConeSnapshot: line.sourceConeSnapshot,
          replacementSourceId: line.replacementSourceId,
          replacementUnitId: line.sourceType === 'PACKED_UNIT' ? line.sourceId : line.replacementUnitId,
          reversalOfLineId: line.id,
          ...actorCreateFields(actorUserId),
        })) },
        ...actorCreateFields(actorUserId),
      },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    for (const line of lines) {
      if (line.sourceType === 'PACKED_UNIT' && line.replacementUnitId) {
        await restorePackedUnitAdjustment(tx, line, reversal, actorUserId, idempotencyKey, reason);
        continue;
      }
      if (line.replacementSourceId) {
        const row = await tx.receiveFromConingMachineRow.findUnique({ where: { id: line.replacementSourceId } });
        if (row && row.isOpeningStock) {
          await tx.receiveFromConingMachineRow.update({ where: { id: row.id }, data: { isDeleted: true, deletedAt: new Date(), deletedByUserId: actorUserId || null, ...actorUpdateFields(actorUserId) } });
        }
      }
      if (line.replacementUnitId) {
        const unit = await tx.packedUnit.findUnique({ where: { id: line.replacementUnitId } });
        if (unit) {
          if (unit.status === UNIT_STATUSES.DISPATCHED) throw conflict('opening_unit_in_use', 'An opening Packed Unit has already been dispatched and cannot be reversed.', { unitId: unit.id });
          if (unit.status !== UNIT_STATUSES.VOIDED) {
            // Reversal retires the opening identity through an append-only
            // reversal event, not through the normal Packed Unit transition
            // registry.
            await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.VOIDED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
            await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.EVENT_REVERSED, reason, payload: { reversalBatchId: reversal.id, originalAdjustmentLineId: line.id }, idempotencyKey: `${idempotencyKey}:unit:${unit.id}`, actorUserId });
          }
        }
      }
    }
    await tx.inventoryAdjustmentBatch.update({ where: { id: batch.id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedByUserId: actorUserId || null, ...actorUpdateFields(actorUserId) } });
    await writeAdjustmentAudit(tx, { batchId: batch.id, action: 'reverse', actorUserId, payload: { reversalBatchId: reversal.id, reason } });
    const launchState = await tx.packingLaunchState.findUnique({ where: { adjustmentBatchId: batch.id } });
    if (launchState) await tx.packingLaunchState.update({ where: { id: launchState.id }, data: { status: 'REVERSED', affectedWritesPaused: true, lastError: 'Append-only reversal completed; explicit recovery acceptance is required before writes may resume.', ...actorUpdateFields(actorUserId) } });
    return serialize({ original: batch, reversal });
  } });
}

export async function getPackingLaunchState(client = prisma) {
  return client.packingLaunchState.upsert({ where: { id: 'packing_dispatch_v2' }, update: {}, create: { id: 'packing_dispatch_v2' } });
}

export function assertReversalBoundary(batch) {
  if (batch?.status !== 'APPLIED') {
    throw conflict('adjustment_not_applied', 'Only an APPLIED reconciliation batch can be reversed.', { status: batch?.status });
  }
  const reversalOfBatchId = batch?.evidenceSnapshot?.reversalOfBatchId;
  if (reversalOfBatchId) {
    throw conflict('adjustment_reversal_not_allowed', 'An append-only reversal batch cannot be reversed.', {
      batchId: batch.id,
      reversalOfBatchId,
    });
  }
}

function masterSnapshot(record) {
  return record ? { id: record.id, name: record.name } : null;
}

async function loadOpeningLineageMasters(tx, {
  itemId,
  yarnId,
  twistId,
  cutId,
  wrapperId,
  colorId,
  coneTypeId,
}) {
  const [item, yarn, twist, cut, wrapper, color, coneType] = await Promise.all([
    itemId ? tx.item.findUnique({ where: { id: String(itemId) }, select: { id: true, name: true } }) : null,
    yarnId ? tx.yarn.findUnique({ where: { id: String(yarnId) }, select: { id: true, name: true } }) : null,
    twistId ? tx.twist.findUnique({ where: { id: String(twistId) }, select: { id: true, name: true } }) : null,
    cutId ? tx.cut.findUnique({ where: { id: String(cutId) }, select: { id: true, name: true } }) : null,
    wrapperId ? tx.wrapper.findUnique({ where: { id: String(wrapperId) }, select: { id: true, name: true } }) : null,
    colorId ? tx.packingColor.findUnique({ where: { id: String(colorId) }, select: { id: true, name: true } }) : null,
    coneTypeId ? tx.coneType.findUnique({ where: { id: String(coneTypeId) }, select: { id: true, name: true } }) : null,
  ]);
  if (itemId && !item) throw notFound('item_not_found', 'The opening-balance Item master was not found.', { itemId });
  if (yarnId && !yarn) throw notFound('yarn_not_found', 'The opening-balance Yarn master was not found.', { yarnId });
  if (twistId && !twist) throw notFound('twist_not_found', 'The opening-balance Twist master was not found.', { twistId });
  if (cutId && !cut) throw notFound('cut_not_found', 'The opening-balance Cut master was not found.', { cutId });
  if (wrapperId && !wrapper) throw notFound('wrapper_not_found', 'The opening-balance Wrapper master was not found.', { wrapperId });
  if (colorId && !color) throw notFound('color_not_found', 'The opening-balance Color master was not found.', { colorId });
  if (coneTypeId && !coneType) throw notFound('cone_type_not_found', 'The opening-balance Cone Type master was not found.', { coneTypeId });
  return { item, yarn, twist, cut, wrapper, color, coneType };
}

async function createOpeningConingSource(tx, batch, line, actorUserId, idempotencyKey, sequence) {
  const itemId = requireNonEmptyString(line?.itemId, 'itemId', 100);
  const count = parsePositiveInt(line?.count ?? line?.baseCount, 'count');
  const weight = parseNonNegativeNumber(line?.weightKg ?? line?.netWeightKg, 'weightKg', { allowZero: false });
  const lotNo = optionalString(line?.lotNo, 200) || `OPENING-${batch.batchNo}`;
  const masters = await loadOpeningLineageMasters(tx, {
    itemId,
    yarnId: optionalString(line?.yarnId, 100),
    twistId: optionalString(line?.twistId, 100),
    cutId: optionalString(line?.cutId, 100),
    wrapperId: optionalString(line?.wrapperId, 100),
    colorId: optionalString(line?.colorId, 100),
    coneTypeId: optionalString(line?.coneTypeId, 100),
  });
  const issueBarcode = await assertGlobalBarcodeAvailable(tx, line?.issueBarcode || `ICO-OPEN-${batch.batchNo}-${String(sequence).padStart(4, '0')}`);
  const receiveBarcode = await assertGlobalBarcodeAvailable(tx, line?.barcode || `RCO-OPEN-${batch.batchNo}-${String(sequence).padStart(4, '0')}`);
  const issue = await tx.issueToConingMachine.create({
    data: {
      date: String(line?.date || batch.effectiveAt.toISOString().slice(0, 10)),
      itemId,
      lotNo,
      yarnId: optionalString(line?.yarnId, 100),
      twistId: optionalString(line?.twistId, 100),
      cutId: optionalString(line?.cutId, 100),
      barcode: issueBarcode,
      note: optionalString(line?.notes, 1000) || 'Opening stock import',
      rollsIssued: 0,
      requiredPerConeNetWeight: 0,
      expectedCones: count,
      receivedRowRefs: [],
      ...actorCreateFields(actorUserId),
    },
  });
  const row = await tx.receiveFromConingMachineRow.create({
    data: {
      barcode: receiveBarcode,
      date: String(line?.date || batch.effectiveAt.toISOString().slice(0, 10)),
      issueId: issue.id,
      coneCount: count,
      coneWeight: weight,
      netWeight: weight,
      grossWeight: weight,
      tareWeight: 0,
      sourceRowRefs: [],
      notes: optionalString(line?.notes, 1000) || 'Opening stock import',
      createdBy: 'OPENING_BALANCE',
      isOpeningStock: true,
      ...actorCreateFields(actorUserId),
    },
  });
  await tx.receiveFromConingMachinePieceTotal.upsert({ where: { pieceId: issue.id }, update: { totalCones: count, totalNetWeight: weight, ...actorUpdateFields(actorUserId) }, create: { pieceId: issue.id, totalCones: count, totalNetWeight: weight, wastageNetWeight: 0, ...actorCreateFields(actorUserId) } });
  const item = masterSnapshot(masters.item);
  const yarn = masterSnapshot(masters.yarn);
  const twist = masterSnapshot(masters.twist);
  const cut = masterSnapshot(masters.cut);
  const wrapper = masterSnapshot(masters.wrapper);
  const color = masterSnapshot(masters.color);
  const coneType = masterSnapshot(masters.coneType);
  const lineage = {
    sourceType: 'OPENING_CONING',
    item,
    yarn,
    twist,
    cut,
    wrapper,
    color,
    coneType,
    count,
    weightKg: weight,
    issueId: issue.id,
    issueBarcode,
    receiveId: row.id,
    receiveBarcode,
  };
  return {
    row,
    issue,
    count,
    weight,
    barcode: receiveBarcode,
    sourceItemSnapshot: { ...lineage, itemId, itemName: masters.item?.name || null },
    sourceLotSnapshot: { lotNo, issueId: issue.id, issueBarcode, receiveId: row.id, receiveBarcode },
    sourceConeSnapshot: { ...lineage, coneCount: count, netWeightKg: weight },
  };
}

async function createOpeningPackedUnit(tx, batch, line, actorUserId, idempotencyKey, sequence) {
  const recipeId = requireNonEmptyString(line?.recipeId, 'recipeId', 100);
  const recipe = await tx.packingRecipe.findUnique({ where: { id: recipeId }, include: recipeInclude });
  if (!recipe || recipe.status !== 'ACTIVE') throw badRequest('recipe_not_active', 'Opening Packed Units require an ACTIVE recipe.', { recipeId });
  if (!recipe.itemId || !recipe.wrapperId || !recipe.colorId || !recipe.coneTypeId || recipe.nominalGram === null || recipe.nominalGram === undefined) {
    throw badRequest('recipe_incomplete', 'Opening Packed Units require complete Item, Wrapper, Color, Cone Type, and nominal gram recipe identity.', { recipeId });
  }
  const lineageMasters = await loadOpeningLineageMasters(tx, {
    itemId: recipe.itemId,
    yarnId: optionalString(line?.yarnId, 100),
    twistId: optionalString(line?.twistId, 100),
    cutId: optionalString(line?.cutId, 100),
    wrapperId: recipe.wrapperId,
    colorId: recipe.colorId,
    coneTypeId: recipe.coneTypeId,
  });
  const levelIndex = parsePositiveInt(line?.levelIndex ?? recipe.stockUnitLevelIndex, 'levelIndex');
  const level = recipe.levels.find((entry) => entry.levelIndex === levelIndex);
  if (!level) throw badRequest('recipe_level_not_found', 'The opening Packed Unit level is not defined by the recipe.', { recipeId, levelIndex });
  if (levelIndex !== recipe.stockUnitLevelIndex) throw badRequest('opening_stock_level_required', 'Opening Packed Goods must be imported at the recipe stock-unit level.', { recipeId, stockUnitLevelIndex: recipe.stockUnitLevelIndex, levelIndex });
  const count = parsePositiveInt(line?.count ?? line?.baseCount, 'count');
  const weight = parseNonNegativeNumber(line?.weightKg ?? line?.netWeightKg, 'weightKg', { allowZero: false });
  const tare = parseNonNegativeNumber(line?.tareWeightKg ?? level.packageType.defaultTareKg ?? 0, 'tareWeightKg');
  const gross = parseNonNegativeNumber(line?.grossWeightKg ?? (weight + tare), 'grossWeightKg');
  if (gross + 0.000001 < tare || Math.abs((gross - tare) - weight) > 0.002) throw badRequest('weight_conservation_failed', 'Opening Packed Unit gross, tare, and net weight must reconcile.');
  const customerId = optionalString(line?.customerId, 100) || recipe.customerId || null;
  if (customerId) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.isActive === false) throw badRequest('customer_inactive', 'Opening Packed Unit Customer is missing or inactive.');
    if (recipe.customerId && recipe.customerId !== customerId) throw badRequest('recipe_customer_restricted', 'The opening Packed Unit recipe is restricted to another Customer.');
  }
  const requiresQualityHold = recipe.requiresQualityHold === true;
  const openingBatchNo = await allocatePackingBatchNo(tx, batch.effectiveAt);
  const openingBatch = await tx.packingBatch.create({
    data: {
      batchNo: openingBatchNo,
      kind: 'OPENING',
      status: BATCH_STATUSES.COMPLETED,
      recipeId,
      recipeSnapshot: serialize(recipe),
      customerId,
      deliveryMode: recipe.deliveryMode,
      plannedBaseCount: count,
      plannedNetWeightKg: weight,
      notes: optionalString(line?.notes, 1000) || 'Opening stock import',
      confirmedAt: batch.effectiveAt,
      startedAt: batch.effectiveAt,
      completedAt: batch.effectiveAt,
      ...actorCreateFields(actorUserId),
    },
  });
  const unitSequence = await allocateUnitSequence(tx, openingBatch.id, levelIndex);
  const barcode = await assertGlobalBarcodeAvailable(tx, line?.barcode || `PKU-${openingBatchNo}-L${levelIndex}-U${String(unitSequence).padStart(4, '0')}`);
  const unit = await tx.packedUnit.create({
    data: {
      batchId: openingBatch.id,
      recipeId,
      packageTypeId: level.packageTypeId,
      parentUnitId: null,
      levelIndex,
      unitSequence,
      barcode,
      isStockUnit: levelIndex === recipe.stockUnitLevelIndex,
      status: UNIT_STATUSES.LABEL_PENDING,
      itemId: recipe.itemId,
      wrapperId: recipe.wrapperId,
      colorId: recipe.colorId,
      coneTypeId: recipe.coneTypeId,
      customerId,
      nominalGram: recipe.nominalGram,
      baseCount: count,
      grossWeightKg: gross,
      tareWeightKg: tare,
      netWeightKg: weight,
      labelPrintCount: 0,
      sealedAt: batch.effectiveAt,
      qualityReleasedAt: null,
      ...actorCreateFields(actorUserId),
    },
    include: packedUnitInclude,
  });
  let label = null;
  let labelPending = false;
  const intendedStatus = requiresQualityHold ? UNIT_STATUSES.QUALITY_HOLD : (customerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE);
  const intendedQualityReleasedAt = requiresQualityHold ? null : batch.effectiveAt.toISOString();
  try {
    label = generatePackedUnitLabel(unit);
  } catch (error) {
    labelPending = true;
    await createPackedUnitEvent(tx, {
      batchId: openingBatch.id,
      unitId: unit.id,
      type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING,
      reason: error?.message || 'Label generation failed for opening stock.',
      payload: {
        recoveryMode: 'POST_SEAL_REPRINT',
        openingImport: true,
        openingImportRecovery: true,
        openingBatchId: openingBatch.id,
        openingBalanceBatchId: batch.id,
        preFailureStatus: intendedStatus,
        preFailureQualityReleasedAt: intendedQualityReleasedAt,
        reprintReason: 'Opening stock import',
        reason: 'Opening stock import',
        labelIdentity: { barcode, itemId: recipe.itemId, itemName: unit.item?.name || null, baseCount: count },
        barcode,
        available: false,
        error: error?.code || 'label_generation_failed',
      },
      idempotencyKey: `${idempotencyKey}:unit-label-pending:${sequence}`,
      actorUserId,
    });
  }
  const nextStatus = labelPending
    ? UNIT_STATUSES.LABEL_PENDING
    : intendedStatus;
  if (nextStatus !== UNIT_STATUSES.LABEL_PENDING) {
    transitionUnit(UNIT_STATUSES.LABEL_PENDING, nextStatus);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: nextStatus, labelPrintCount: 1, qualityReleasedAt: requiresQualityHold ? null : batch.effectiveAt, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    unit.status = updated.status;
    unit.labelPrintCount = updated.labelPrintCount;
    unit.qualityReleasedAt = updated.qualityReleasedAt;
  }
  await createPackedUnitEvent(tx, { batchId: openingBatch.id, type: PACKING_EVENT_TYPES.BATCH_CONFIRMED, reason: 'Opening stock import', payload: { kind: 'OPENING' }, idempotencyKey: `${idempotencyKey}:batch-confirmed:${sequence}`, actorUserId });
  await createPackedUnitEvent(tx, { batchId: openingBatch.id, type: PACKING_EVENT_TYPES.BATCH_STARTED, reason: 'Opening stock import', payload: { kind: 'OPENING' }, idempotencyKey: `${idempotencyKey}:batch-started:${sequence}`, actorUserId });
  await createPackedUnitEvent(tx, { batchId: openingBatch.id, type: PACKING_EVENT_TYPES.BATCH_COMPLETED, reason: 'Opening stock import', payload: { kind: 'OPENING', baseCount: count, netWeightKg: weight }, idempotencyKey: `${idempotencyKey}:batch-completed:${sequence}`, actorUserId });
  await createPackedUnitEvent(tx, { batchId: openingBatch.id, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_SEALED, reason: 'Opening stock import', payload: { openingBalanceBatchId: batch.id, barcode, baseCount: count, netWeightKg: weight, label, labelPending, requiresQualityHold, status: unit.status, intendedStatus, intendedQualityReleasedAt, recoveryMode: labelPending ? 'POST_SEAL_REPRINT' : null, openingImportRecovery: labelPending }, idempotencyKey: `${idempotencyKey}:unit-sealed:${sequence}`, actorUserId });
  if (customerId) {
    await createPackedUnitEvent(tx, { batchId: openingBatch.id, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RESERVED, reason: 'Opening stock customer assignment', payload: { customerId, status: unit.status }, idempotencyKey: `${idempotencyKey}:unit-reserved:${sequence}`, actorUserId });
  }
  const item = masterSnapshot(lineageMasters.item);
  const wrapper = masterSnapshot(lineageMasters.wrapper);
  const color = masterSnapshot(lineageMasters.color);
  const coneType = masterSnapshot(lineageMasters.coneType);
  const yarn = masterSnapshot(lineageMasters.yarn);
  const twist = masterSnapshot(lineageMasters.twist);
  const cut = masterSnapshot(lineageMasters.cut);
  const lineage = {
    sourceType: 'OPENING_PACKED',
    item,
    yarn,
    twist,
    cut,
    wrapper,
    color,
    coneType,
    count,
    weightKg: weight,
    barcode,
    openingBalanceBatchId: batch.id,
    openingBatchId: openingBatch.id,
    openingBatchNo,
    unitId: unit.id,
  };
  return {
    openingBatch,
    unit,
    count,
    weight,
    barcode,
    label,
    labelPending,
    sourceItemSnapshot: { ...lineage, itemId: recipe.itemId, wrapperId: recipe.wrapperId, colorId: recipe.colorId, coneTypeId: recipe.coneTypeId },
    sourceLotSnapshot: { openingBalanceBatchId: batch.id, openingBatchId: openingBatch.id, openingBatchNo, lotNo: optionalString(line?.lotNo, 200), barcode },
    sourceConeSnapshot: { ...lineage, levelIndex, packageTypeId: level.packageTypeId, packageType: masterSnapshot(level.packageType), tareWeightKg: tare, grossWeightKg: gross, netWeightKg: weight },
  };
}

export async function importOpeningBalances({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const cutoverBatchId = requireNonEmptyString(payload?.cutoverBatchId, 'cutoverBatchId', 100);
  if (!Array.isArray(payload?.lines) || payload.lines.length === 0) throw badRequest('lines_required', 'At least one opening-balance line is required.');
  if (payload.lines.length > 1000) throw badRequest('too_many_lines', 'An opening-balance import may contain at most 1000 lines.');
  return runIdempotent({ operation: 'reconciliation.batch.import_opening_balances', idempotencyKey, actorUserId, client, work: async (tx) => {
    const unlockedBatch = await findAdjustmentBatch(tx, batchId);
    if (unlockedBatch.kind !== 'OPENING_BALANCE') throw conflict('opening_batch_import_only', 'Opening balances require a dedicated OPENING_BALANCE batch; direct LEGACY_CUTOVER imports are not allowed.');
    if (batchId === cutoverBatchId) throw badRequest('opening_cutover_batch_same', 'The dedicated OPENING_BALANCE batch must differ from its LEGACY_CUTOVER batch.');
    if (linkedCutoverId(unlockedBatch.evidenceSnapshot) !== cutoverBatchId) throw conflict('opening_batch_not_linked', 'The dedicated OPENING_BALANCE batch is not durably linked to the requested cutoverBatchId.', { batchId, cutoverBatchId, linkedCutoverBatchId: linkedCutoverId(unlockedBatch.evidenceSnapshot) || null });
    const cutoverBatch = await findAdjustmentBatchForUpdate(tx, cutoverBatchId);
    if (cutoverBatch.kind !== 'LEGACY_CUTOVER' || cutoverBatch.status !== 'APPLIED') throw conflict('cutover_not_applied', 'Opening balances require one already APPLIED LEGACY_CUTOVER batch.', { cutoverBatchId, kind: cutoverBatch.kind, status: cutoverBatch.status });
    const batch = await findAdjustmentBatchForUpdate(tx, batchId);
    if (batch.kind !== 'OPENING_BALANCE' || linkedCutoverId(batch.evidenceSnapshot) !== cutoverBatchId) throw conflict('opening_batch_not_linked', 'The dedicated OPENING_BALANCE batch link changed before import could be locked.', { batchId, cutoverBatchId });
    if (batch.status !== 'DRAFT') throw conflict('adjustment_not_draft', 'Opening balances can be imported only into a DRAFT reconciliation batch.', { status: batch.status });
    const linkedOpeningBatches = await findActiveOpeningBatchesForCutover(tx, cutoverBatchId);
    if (linkedOpeningBatches.length !== 1 || linkedOpeningBatches[0].id !== batch.id) throw conflict('multiple_opening_imports', 'Only one active OPENING_BALANCE batch may be linked to a LEGACY_CUTOVER.', { cutoverBatchId, linkedOpeningBatchIds: linkedOpeningBatches.map((openingBatch) => openingBatch.id), batchId });
    await assertDraftConingSettlementsClear(tx);
    const evidence = payload?.evidenceSnapshot || batch.evidenceSnapshot;
    const verifiedUsers = await verifyEvidenceUsers(tx, evidence);
    const identities = { preparer: verifiedUsers.preparer.id, verifier: verifiedUsers.verifier.id };
    const existingLines = await tx.inventoryAdjustmentLine.findMany({ where: { batchId }, select: { sourceId: true } });
    const existingIds = new Set(existingLines.map((line) => line.sourceId));
    const sourceIdentities = payload.lines.map((line) => requireNonEmptyString(line?.sourceIdentity, 'sourceIdentity', 250));
    if (new Set(sourceIdentities).size !== sourceIdentities.length) throw badRequest('duplicate_source_identity', 'Opening-balance source identities must be unique within the import.');
    for (const sourceIdentity of sourceIdentities) {
      if (existingIds.has(sourceIdentity)) throw conflict('duplicate_opening_import', 'An opening-balance line with this source identity is already linked to the batch.', { sourceIdentity });
      const duplicate = await tx.inventoryAdjustmentLine.findFirst({
        where: { sourceType: 'OPENING_BALANCE', sourceId: sourceIdentity, batch: { kind: { in: ['LEGACY_CUTOVER', 'OPENING_BALANCE'] } } },
        select: { id: true, batchId: true },
      });
      if (duplicate) throw conflict('duplicate_opening_import', 'This opening sourceIdentity already exists in an applicable reconciliation batch.', { sourceIdentity, batchId: duplicate.batchId });
    }

    const created = [];
    for (let index = 0; index < payload.lines.length; index += 1) {
      const line = payload.lines[index];
      const classification = String(line?.classification || '').trim().toUpperCase();
      if (['DAMAGED', 'UNCERTAIN'].includes(classification)) throw badRequest('opening_classification_required', 'Damaged or uncertain opening goods must be classified before import.', { sourceIdentity: line.sourceIdentity, classification });
      if (!['LOOSE', 'UNPACKED', 'PACKED'].includes(classification)) throw badRequest('invalid_opening_classification', 'Opening classification must be LOOSE, UNPACKED, or PACKED.', { sourceIdentity: line.sourceIdentity });
      const sourceIdentity = sourceIdentities[index];
      if (classification === 'PACKED') {
        const result = await createOpeningPackedUnit(tx, batch, line, actorUserId, idempotencyKey, index + 1);
        const adjustmentLine = await tx.inventoryAdjustmentLine.create({ data: { batchId, sourceType: 'OPENING_BALANCE', sourceId: sourceIdentity, countDelta: 0, weightDeltaKg: 0, sourceBarcode: result.barcode, sourceItemSnapshot: serialize(result.sourceItemSnapshot), sourceLotSnapshot: serialize(result.sourceLotSnapshot), sourceConeSnapshot: serialize(result.sourceConeSnapshot), replacementUnitId: result.unit.id, ...actorCreateFields(actorUserId) } });
        created.push({ classification, sourceIdentity, adjustmentLine, openingBatch: result.openingBatch, unit: result.unit });
      } else {
        const result = await createOpeningConingSource(tx, batch, line, actorUserId, idempotencyKey, index + 1);
        const adjustmentLine = await tx.inventoryAdjustmentLine.create({ data: { batchId, sourceType: 'OPENING_BALANCE', sourceId: sourceIdentity, countDelta: 0, weightDeltaKg: 0, sourceBarcode: result.barcode, sourceItemSnapshot: serialize(result.sourceItemSnapshot), sourceLotSnapshot: serialize(result.sourceLotSnapshot), sourceConeSnapshot: serialize(result.sourceConeSnapshot), replacementSourceId: result.row.id, ...actorCreateFields(actorUserId) } });
        created.push({ classification, sourceIdentity, adjustmentLine, row: result.row, issue: result.issue });
      }
    }
    const updated = await tx.inventoryAdjustmentBatch.update({ where: { id: batch.id }, data: { status: 'APPLIED', appliedAt: new Date(), appliedByUserId: actorUserId || null, evidenceSnapshot: serialize({ ...evidence, cutoverBatchId, preparerUserId: identities.preparer, verifierUserId: identities.verifier }), ...actorUpdateFields(actorUserId) }, include: { lines: { orderBy: { createdAt: 'asc' } } } });
    await writeAdjustmentAudit(tx, { batchId: batch.id, action: 'import_opening_balances', actorUserId, payload: { lineCount: created.length, preparer: identities.preparer, verifier: identities.verifier, cutoverBatchId } });
    return serialize({ batch: updated, imported: created });
  } });
}
