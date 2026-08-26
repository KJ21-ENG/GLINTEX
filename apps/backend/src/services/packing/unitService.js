import prisma from '../../lib/prisma.js';
import { runIdempotent } from '../inventory/idempotency.js';
import { UNIT_STATUSES, BATCH_STATUSES, PACKING_EVENT_TYPES } from './constants.js';
import {
  actorCreateFields,
  actorUpdateFields,
  createPackedUnitEvent,
  lockRecord,
  packedUnitInclude,
} from './common.js';
import {
  badRequest,
  conflict,
  notFound,
  optionalString,
  parseNonNegativeNumber,
  parsePositiveInt,
  requireNonEmptyString,
} from './errors.js';
import {
  consumeReservedSources,
  effectiveRecipeSnapshot,
  findBatchForUpdate,
  refreshBatchProgress,
} from './batchService.js';
import { allocatePackingUnitBarcode, allocateUnitSequence } from './sequence.js';
import { serialize } from './serialization.js';
import { transitionUnit } from './transitionService.js';
import { generatePackedUnitLabel } from './labelService.js';
import { assertParentCapacity, assertParentLevel, assertRecipeBaseComposition, assertUnitChildrenAtSeal } from './packingTopology.js';
import { createPackingRepackingBatchInTransaction } from './repackingService.js';
import { calculatePackingUnitVariance } from './varianceMath.js';

const SEALED_STATUSES = [
  UNIT_STATUSES.LABEL_PENDING,
  UNIT_STATUSES.QUALITY_HOLD,
  UNIT_STATUSES.AVAILABLE,
  UNIT_STATUSES.RESERVED,
  UNIT_STATUSES.RETURNED_PENDING_INSPECTION,
];

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function findUnitForUpdate(tx, id, include = true) {
  await lockRecord(tx, 'PackedUnit', id, 'packed_unit_not_found', 'Packed Unit not found.');
  const unit = await tx.packedUnit.findUnique({ where: { id: String(id) }, ...(include ? { include: packedUnitInclude } : {}) });
  if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit not found.', { id });
  return unit;
}

async function assertUnitNotReservedForPacking(tx, unitId) {
  const reservation = await tx.packingBatchSource.findFirst({
    where: { sourceType: 'PACKED_UNIT', sourceId: unitId, batch: { status: { in: [BATCH_STATUSES.CONFIRMED, BATCH_STATUSES.IN_PROGRESS, BATCH_STATUSES.PARTIALLY_COMPLETED] } } },
    select: { batchId: true },
  });
  if (reservation) throw conflict('unit_reserved_for_packing', 'This Packed Unit is reserved as a source for another Packing batch.', { batchId: reservation.batchId });
}

function getEffectiveRecipe(batch, recipe) {
  const snapshot = effectiveRecipeSnapshot(batch.recipeSnapshot);
  return snapshot && typeof snapshot === 'object' ? snapshot : serialize(recipe);
}

function recipeLevel(recipeSnapshot, levelIndex) {
  const level = Array.isArray(recipeSnapshot?.levels)
    ? recipeSnapshot.levels.find((entry) => Number(entry.levelIndex) === Number(levelIndex))
    : null;
  if (!level) throw badRequest('recipe_level_not_found', 'The requested container level is not defined by the recipe.', { levelIndex });
  return level;
}

function requirePhysicalValues(payload) {
  const baseCount = parsePositiveInt(payload?.baseCount, 'baseCount');
  const grossWeightKg = parseNonNegativeNumber(payload?.grossWeightKg, 'grossWeightKg');
  const tareWeightKg = parseNonNegativeNumber(payload?.tareWeightKg, 'tareWeightKg');
  const netWeightKg = parseNonNegativeNumber(payload?.netWeightKg, 'netWeightKg');
  if (grossWeightKg + 0.000001 < tareWeightKg) throw badRequest('invalid_weights', 'Gross weight cannot be lower than tare weight.');
  if (Math.abs((grossWeightKg - tareWeightKg) - netWeightKg) > 0.002) throw badRequest('weight_conservation_failed', 'Gross, tare, and net weight must reconcile within 0.002 kg.');
  return { baseCount, grossWeightKg, tareWeightKg, netWeightKg };
}

function assertSalvageConservation(unit, salvageableBaseCount, salvageableWeightKg) {
  const salvageCount = Number(salvageableBaseCount || 0);
  const salvageWeight = Number(salvageableWeightKg || 0);
  if (salvageCount < 0 || salvageWeight < 0 || salvageCount > Number(unit.baseCount) || salvageWeight > Number(unit.netWeightKg) + 0.001) {
    throw badRequest('damage_exceeds_content', 'Salvageable content cannot exceed the sealed unit content.');
  }
  if ((salvageCount === 0) !== (salvageWeight <= 0.001)) {
    throw badRequest('salvage_conservation_failed', 'Salvageable count and weight must both be positive or both be zero.');
  }
  return { baseCount: salvageCount, netWeightKg: salvageWeight };
}

async function createSalvageUnit(tx, unit, salvage, actorUserId, idempotencyKey, reason) {
  if (salvage.baseCount <= 0 || salvage.netWeightKg <= 0.001) return null;
  const sequence = await allocateUnitSequence(tx, unit.batchId, unit.levelIndex);
  const barcode = await allocatePackingUnitBarcode(tx, unit.batch?.batchNo, unit.levelIndex, sequence);
  const salvageUnit = await tx.packedUnit.create({
    data: {
      batchId: unit.batchId,
      recipeId: unit.recipeId,
      packageTypeId: unit.packageTypeId,
      parentUnitId: null,
      levelIndex: unit.levelIndex,
      unitSequence: sequence,
      barcode,
      isStockUnit: true,
      status: UNIT_STATUSES.DAMAGED,
      itemId: unit.itemId,
      wrapperId: unit.wrapperId,
      colorId: unit.colorId,
      coneTypeId: unit.coneTypeId,
      customerId: unit.customerId,
      nominalGram: unit.nominalGram,
      baseCount: salvage.baseCount,
      grossWeightKg: salvage.netWeightKg + Number(unit.tareWeightKg || 0),
      tareWeightKg: unit.tareWeightKg,
      netWeightKg: salvage.netWeightKg,
      labelPrintCount: 1,
      sealedAt: new Date(),
      qualityReleasedAt: null,
      splitFromUnitId: unit.id,
      ...actorCreateFields(actorUserId),
    },
    include: packedUnitInclude,
  });
  await createPackedUnitEvent(tx, {
    batchId: unit.batchId,
    unitId: salvageUnit.id,
    type: PACKING_EVENT_TYPES.UNIT_DAMAGED,
    reason,
    payload: { salvageIdentity: true, splitFromUnitId: unit.id, baseCount: salvage.baseCount, netWeightKg: salvage.netWeightKg },
    idempotencyKey: `${idempotencyKey}:salvage-damaged`,
    actorUserId,
  });
  return salvageUnit;
}

async function latestReturnCondition(tx, unitId) {
  const event = await tx.packedUnitEvent.findFirst({
    where: { unitId, type: PACKING_EVENT_TYPES.UNIT_RETURNED },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    opened: payload.opened === true,
    physicallyChanged: payload.physicallyChanged === true,
  };
}

async function assertBatchCanBuild(tx, batchId) {
  const batch = await findBatchForUpdate(tx, batchId, true);
  if (![BATCH_STATUSES.IN_PROGRESS, BATCH_STATUSES.PARTIALLY_COMPLETED].includes(batch.status)) throw conflict('batch_not_buildable', 'Physical containers can be created only while a batch is IN_PROGRESS or PARTIALLY_COMPLETED.');
  return batch;
}

export async function createPackingUnit({ batchId, payload, actorUserId, idempotencyKey, client = prisma }) {
  const id = requireNonEmptyString(batchId, 'batchId', 100);
  const levelIndex = parsePositiveInt(payload?.levelIndex, 'levelIndex');
  const packageTypeId = requireNonEmptyString(payload?.packageTypeId, 'packageTypeId', 100);
  const physical = requirePhysicalValues(payload);
  const parentUnitId = optionalString(payload?.parentUnitId, 100);
  return runIdempotent({ operation: 'packing.unit.create', idempotencyKey, actorUserId, client, work: async (tx) => {
    const batch = await assertBatchCanBuild(tx, id);
    const recipeSnapshot = getEffectiveRecipe(batch, batch.recipe);
    const level = recipeLevel(recipeSnapshot, levelIndex);
    const topologyLevel = assertRecipeBaseComposition(recipeSnapshot, levelIndex, physical.baseCount);
    if (String(level.packageTypeId) !== packageTypeId) throw badRequest('package_type_level_mismatch', 'The package type must match the selected recipe level.', { levelIndex, expectedPackageTypeId: level.packageTypeId, packageTypeId });
    if (parentUnitId) await lockRecord(tx, 'PackedUnit', parentUnitId, 'parent_unit_not_found', 'Parent Packed Unit not found.');
    const parent = parentUnitId ? await tx.packedUnit.findUnique({ where: { id: parentUnitId } }) : null;
    if (parentUnitId && (!parent || parent.batchId !== id)) throw badRequest('parent_unit_invalid', 'Parent container must belong to this batch.');
    if (parent) {
      assertParentLevel(recipeSnapshot, levelIndex, parent);
      await assertParentCapacity(tx, parent, topologyLevel);
    }
    if (parent && [UNIT_STATUSES.DISPATCHED, UNIT_STATUSES.DAMAGED, UNIT_STATUSES.REPACKED, UNIT_STATUSES.SPLIT_CONSUMED, UNIT_STATUSES.VOIDED].includes(parent.status)) throw badRequest('parent_unit_invalid', 'The selected parent container cannot accept another child.', { status: parent.status });
    const itemId = recipeSnapshot.itemId || batch.recipe.itemId;
    const wrapperId = recipeSnapshot.wrapperId || batch.recipe.wrapperId;
    const colorId = recipeSnapshot.colorId || batch.recipe.colorId;
    const coneTypeId = recipeSnapshot.coneTypeId || batch.recipe.coneTypeId;
    if (!itemId || !wrapperId || !colorId || !coneTypeId) throw badRequest('recipe_incomplete', 'The batch recipe is missing required physical identity masters.');
    const nominalGram = payload?.nominalGram === undefined || payload?.nominalGram === ''
      ? numberOrZero(recipeSnapshot.nominalGram ?? batch.recipe.nominalGram)
      : parseNonNegativeNumber(payload.nominalGram, 'nominalGram');
    const unitSequence = await allocateUnitSequence(tx, id, levelIndex);
    const created = await tx.packedUnit.create({
      data: {
        batchId: id,
        recipeId: batch.recipeId,
        packageTypeId,
        parentUnitId,
        levelIndex,
        unitSequence,
        barcode: null,
        isStockUnit: Number(recipeSnapshot.stockUnitLevelIndex || batch.recipe.stockUnitLevelIndex) === levelIndex,
        status: UNIT_STATUSES.IN_PROGRESS,
        itemId,
        wrapperId,
        colorId,
        coneTypeId,
        customerId: batch.customerId,
        nominalGram,
        ...physical,
        ...actorCreateFields(actorUserId),
      },
      include: packedUnitInclude,
    });
    if (parent && [UNIT_STATUSES.QUALITY_HOLD, UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(parent.status)) {
      if (parent.status !== UNIT_STATUSES.QUALITY_HOLD) transitionUnit(parent.status, UNIT_STATUSES.OPENED);
      await tx.packedUnit.update({ where: { id: parent.id }, data: { status: UNIT_STATUSES.OPENED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
      await createPackedUnitEvent(tx, { batchId: id, unitId: parent.id, type: PACKING_EVENT_TYPES.UNIT_SPLIT, reason: 'Parent hierarchy was physically amended.', payload: { childUnitId: created.id, beforeStatus: parent.status, afterStatus: UNIT_STATUSES.OPENED }, idempotencyKey: `${idempotencyKey}:parent-open`, actorUserId });
    }
    return serialize(created);
  } });
}

export async function sealPackingUnit({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const unitId = requireNonEmptyString(id, 'id', 100);
  const physical = payload?.baseCount === undefined ? null : requirePhysicalValues(payload);
  const reason = optionalString(payload?.reason, 1000);
  const confirmAboveApprovalVariance = payload?.confirmAboveApprovalVariance === true;
  return runIdempotent({ operation: 'packing.unit.seal', idempotencyKey, actorUserId, client, work: async (tx) => {
    const unitBefore = await findUnitForUpdate(tx, unitId, true);
    const batch = await assertBatchCanBuild(tx, unitBefore.batchId);
    const unit = await tx.packedUnit.findUnique({ where: { id: unitId }, include: packedUnitInclude });
    if (![UNIT_STATUSES.IN_PROGRESS, UNIT_STATUSES.LABEL_PENDING].includes(unit.status)) throw conflict('unit_not_sealable', 'Only an IN_PROGRESS or LABEL_PENDING unit can be sealed.', { status: unit.status });
    if (unit.status === UNIT_STATUSES.LABEL_PENDING) return recoverPendingSeal(tx, unit, actorUserId, idempotencyKey, batch);
    if (!physical) throw badRequest('physical_values_required', 'baseCount, grossWeightKg, tareWeightKg, and netWeightKg are required to seal an IN_PROGRESS unit.');
    const recipeSnapshot = getEffectiveRecipe(batch, unit.recipe);
    assertRecipeBaseComposition(recipeSnapshot, unit.levelIndex, physical.baseCount);
    await assertUnitChildrenAtSeal(tx, unit, recipeSnapshot);
    const warningVariancePercent = numberOrZero(recipeSnapshot.warningVariancePercent ?? unit.recipe.warningVariancePercent ?? 2);
    const approvalVariancePercent = numberOrZero(recipeSnapshot.approvalVariancePercent ?? unit.recipe.approvalVariancePercent ?? 5);
    const variance = calculatePackingUnitVariance({
      nominalGram: unit.nominalGram,
      baseCount: physical.baseCount,
      netWeightKg: physical.netWeightKg,
      warningVariancePercent,
      approvalVariancePercent,
    });
    const { expectedNetWeightKg: expectedWeight, variancePercent } = variance;
    if (variancePercent > warningVariancePercent + 0.000001 && !reason) throw badRequest('variance_reason_required', 'A reason is required above the recipe warning variance threshold.', { variancePercent, warningVariancePercent });
    if (variancePercent > approvalVariancePercent + 0.000001 && (!confirmAboveApprovalVariance || !reason)) throw badRequest('variance_approval_required', 'Explicit confirmation and a reason are required above the recipe approval variance threshold.', { variancePercent, approvalVariancePercent });

    const output = await tx.packedUnit.aggregate({ where: { batchId: batch.id, isStockUnit: true, status: { notIn: [UNIT_STATUSES.IN_PROGRESS, UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.VOIDED] }, NOT: { id: unitId } }, _sum: { baseCount: true, netWeightKg: true } });
    const projectedOutput = Number(output._sum.baseCount || 0) + (unit.isStockUnit ? physical.baseCount : 0);
    const projectedWeight = Number(output._sum.netWeightKg || 0) + (unit.isStockUnit ? physical.netWeightKg : 0);
    if (projectedOutput > Number(batch.plannedBaseCount) || projectedWeight > Number(batch.plannedNetWeightKg) + 0.001) throw badRequest('batch_target_amendment_required', 'Sealing this unit would exceed the current batch target. Amend the target first.');

    if (unit.isStockUnit && unit.status === UNIT_STATUSES.IN_PROGRESS) {
      await consumeReservedSources(tx, batch, { baseCount: physical.baseCount, netWeightKg: physical.netWeightKg, actorUserId, idempotencyKey });
    }
    const level = recipeLevel(recipeSnapshot, unit.levelIndex);
    const needsBarcode = unit.isStockUnit || level.barcodeEnabled === true;
    const barcode = needsBarcode ? (unit.barcode || await allocatePackingUnitBarcode(tx, batch.batchNo, unit.levelIndex, unit.unitSequence)) : null;
    const requiresQualityHold = recipeSnapshot.requiresQualityHold === true || unit.recipe.requiresQualityHold === true;
    const nextStatus = requiresQualityHold ? UNIT_STATUSES.QUALITY_HOLD : (batch.customerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE);
    const sealingEvidence = {
      planned: { baseCount: variance.expectedBaseCount, netWeightKg: variance.expectedNetWeightKg },
      batchPlanned: { baseCount: batch.plannedBaseCount, netWeightKg: batch.plannedNetWeightKg },
      actual: physical,
      ...variance,
      variancePercent,
      warningVariancePercent,
      approvalVariancePercent,
      confirmedAboveApprovalVariance: confirmAboveApprovalVariance,
      reason,
      requiresQualityHold,
      nextStatus,
      levelIndex: unit.levelIndex,
      isStockUnit: unit.isStockUnit,
    };
    if (unit.status === UNIT_STATUSES.IN_PROGRESS) transitionUnit(unit.status, needsBarcode ? UNIT_STATUSES.LABEL_PENDING : nextStatus);
    const pending = await tx.packedUnit.update({
      where: { id: unitId },
      data: {
        ...physical,
        barcode: barcode || unit.barcode || null,
        status: needsBarcode ? UNIT_STATUSES.LABEL_PENDING : nextStatus,
        labelPrintCount: needsBarcode ? Number(unit.labelPrintCount || 0) : Number(unit.labelPrintCount || 0),
        sealedAt: new Date(),
        qualityReleasedAt: null,
        version: { increment: 1 },
        ...actorUpdateFields(actorUserId),
      },
      include: packedUnitInclude,
    });
    let label = null;
    if (needsBarcode) {
      try {
        label = generatePackedUnitLabel(pending);
      } catch (error) {
        await createPackedUnitEvent(tx, {
          batchId: batch.id,
          unitId,
          type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING,
          reason: error?.message || 'Label generation failed.',
          payload: { recoveryMode: 'INITIAL_SEAL', barcode, error: error?.code || 'label_generation_failed', available: false, sealingEvidence },
          idempotencyKey: `${idempotencyKey}:label-pending`,
          actorUserId,
        });
        return serialize({ unit: pending, batch, label: null, labelPending: true, sealingEvidence });
      }
    }
    if (pending.status !== nextStatus) transitionUnit(pending.status, nextStatus);
    const updated = await tx.packedUnit.update({
      where: { id: unitId },
      data: {
        status: nextStatus,
        labelPrintCount: needsBarcode ? Math.max(1, Number(pending.labelPrintCount || 0)) : Number(pending.labelPrintCount || 0),
        qualityReleasedAt: requiresQualityHold ? null : new Date(),
        version: { increment: 1 },
        ...actorUpdateFields(actorUserId),
      },
      include: packedUnitInclude,
    });
    await createPackedUnitEvent(tx, {
      batchId: batch.id,
      unitId,
      type: PACKING_EVENT_TYPES.UNIT_SEALED,
      reason,
      payload: {
        before: serialize(unit),
        after: serialize(updated),
        planned: { baseCount: variance.expectedBaseCount, netWeightKg: variance.expectedNetWeightKg },
        batchPlanned: { baseCount: batch.plannedBaseCount, netWeightKg: batch.plannedNetWeightKg },
        actual: physical,
        ...variance,
        variancePercent,
        warningVariancePercent,
        approvalVariancePercent,
        confirmedAboveApprovalVariance: confirmAboveApprovalVariance,
        label,
      },
      idempotencyKey: `${idempotencyKey}:event`,
      actorUserId,
    });
    const progressed = await refreshBatchProgress(tx, batch.id, actorUserId, idempotencyKey);
    return serialize({ unit: updated, batch: progressed, label, labelPending: false, sealingEvidence });
  } });
}

async function runUnitAction({ operation, id, actorUserId, idempotencyKey, client, work }) {
  const unitId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation, idempotencyKey, actorUserId, client, work: async (tx) => {
    const unit = await findUnitForUpdate(tx, unitId, true);
    await assertUnitNotReservedForPacking(tx, unit.id);
    return work(tx, unit);
  } });
}

async function recoverPendingSeal(tx, unit, actorUserId, idempotencyKey, batchOverride = null) {
  const pendingEvent = await tx.packedUnitEvent.findFirst({
    where: { unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, payload: true, reason: true },
  });
  const existingSealed = await tx.packedUnitEvent.findFirst({ where: { unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_SEALED }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  if (existingSealed) return recoverPostSealReprint(tx, unit, pendingEvent, existingSealed, actorUserId, idempotencyKey);
  const sealingEvidence = pendingEvent?.payload?.sealingEvidence;
  if (!pendingEvent || !sealingEvidence || typeof sealingEvidence !== 'object') throw conflict('seal_evidence_missing', 'The persisted sealing evidence required to recover this LABEL_PENDING unit is missing.');
  const batch = batchOverride || await findBatchForUpdate(tx, unit.batchId, true);
  let label;
  try {
    label = generatePackedUnitLabel(unit);
  } catch (error) {
    const pending = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.LABEL_PENDING, qualityReleasedAt: null, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, {
      batchId: unit.batchId,
      unitId: unit.id,
      type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING,
      reason: error?.message || 'Label generation failed during seal recovery.',
      payload: { recoveryMode: 'INITIAL_SEAL', barcode: unit.barcode, available: false, recoveryAttempt: true, sealingEvidence, error: error?.code || 'label_generation_failed' },
      idempotencyKey: `${idempotencyKey}:recovery-label-pending`,
      actorUserId,
    });
    return serialize({ unit: pending, batch, label: null, labelPending: true, sealingEvidence, recovery: { recoveryMode: 'INITIAL_SEAL', outcome: 'LABEL_PENDING', originalSealPendingEventId: pendingEvent.id, sealingEvidence } });
  }
  const actual = sealingEvidence.actual || {};
  if (Number(unit.baseCount) !== Number(actual.baseCount)
      || Math.abs(Number(unit.grossWeightKg) - Number(actual.grossWeightKg)) > 0.002
      || Math.abs(Number(unit.tareWeightKg) - Number(actual.tareWeightKg)) > 0.002
      || Math.abs(Number(unit.netWeightKg) - Number(actual.netWeightKg)) > 0.002) {
    throw conflict('seal_evidence_mismatch', 'The LABEL_PENDING unit no longer matches its persisted original sealing evidence.', { unitId: unit.id });
  }
  const nextStatus = sealingEvidence.nextStatus || (sealingEvidence.requiresQualityHold ? UNIT_STATUSES.QUALITY_HOLD : (unit.customerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE));
  if (![UNIT_STATUSES.QUALITY_HOLD, UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(nextStatus)) throw conflict('seal_evidence_invalid', 'The persisted sealing evidence has an invalid final unit status.', { unitId: unit.id, nextStatus });
  transitionUnit(unit.status, nextStatus);
  const updated = await tx.packedUnit.update({
    where: { id: unit.id },
    data: { status: nextStatus, qualityReleasedAt: nextStatus === UNIT_STATUSES.QUALITY_HOLD ? null : new Date(), labelPrintCount: { increment: 1 }, version: { increment: 1 }, ...actorUpdateFields(actorUserId) },
    include: packedUnitInclude,
  });
  const sealedEvent = await createPackedUnitEvent(tx, {
    batchId: batch.id,
    unitId: unit.id,
    type: PACKING_EVENT_TYPES.UNIT_SEALED,
    reason: sealingEvidence.reason || pendingEvent.reason || null,
    payload: { before: serialize(unit), after: serialize(updated), ...sealingEvidence, label, recoveredFromLabelPending: true },
    idempotencyKey: `${pendingEvent.id}:unit-sealed`,
    actorUserId,
  });
  await createPackedUnitEvent(tx, {
    batchId: batch.id,
    unitId: unit.id,
    type: PACKING_EVENT_TYPES.UNIT_LABEL_REPRINTED,
    reason: 'Recovered the original seal after LABEL_PENDING label generation.',
    payload: { barcode: unit.barcode, labelPrintCount: updated.labelPrintCount, label, recoveryOfPendingEventId: pendingEvent.id },
    idempotencyKey: `${pendingEvent.id}:label-recovered`,
    actorUserId,
  });
  const progressed = await refreshBatchProgress(tx, batch.id, actorUserId, `${pendingEvent.id}:recovery`);
  return serialize({ unit: updated, batch: progressed, label, labelPending: false, sealingEvidence, recovery: { recoveryMode: 'INITIAL_SEAL', outcome: 'SEALED_RECOVERED', originalSealPendingEventId: pendingEvent.id, sealedEventId: sealedEvent.id, sealingEvidence } });
}

async function recoverPostSealReprint(tx, unit, pendingEvent, existingSealed, actorUserId, idempotencyKey) {
  const evidence = pendingEvent?.payload?.recoveryMode === 'POST_SEAL_REPRINT' ? pendingEvent.payload : null;
  if (!pendingEvent || !evidence) throw conflict('reprint_evidence_missing', 'The persisted post-seal reprint evidence required to recover this LABEL_PENDING unit is missing.');
  const priorStatus = evidence.preFailureStatus;
  if (![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.QUALITY_HOLD].includes(priorStatus)) throw conflict('reprint_status_invalid', 'The persisted post-seal reprint status is not an eligible Packed Unit status.', { priorStatus });
  if (evidence.labelIdentity && (evidence.labelIdentity.barcode !== unit.barcode || evidence.labelIdentity.itemId !== unit.itemId || Number(evidence.labelIdentity.baseCount) !== Number(unit.baseCount))) throw conflict('reprint_evidence_mismatch', 'The LABEL_PENDING unit no longer matches its persisted post-seal label identity.');
  let label;
  try {
    label = generatePackedUnitLabel(unit);
  } catch (error) {
    const pending = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.LABEL_PENDING, qualityReleasedAt: null, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, {
      batchId: unit.batchId,
      unitId: unit.id,
      type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING,
      reason: error?.message || 'Label generation failed during post-seal reprint recovery.',
      payload: { ...evidence, recoveryMode: 'POST_SEAL_REPRINT', recoveryAttempt: true, error: error?.code || 'label_generation_failed', available: false },
      idempotencyKey: `${idempotencyKey}:post-seal-label-pending`,
      actorUserId,
    });
    return serialize({ unit: pending, label: null, labelPending: true, recovery: { outcome: 'POST_SEAL_LABEL_PENDING', originalSealEventId: existingSealed.id, pendingEventId: pendingEvent.id } });
  }
  transitionUnit(unit.status, priorStatus);
  const updated = await tx.packedUnit.update({
    where: { id: unit.id },
    data: {
      status: priorStatus,
      qualityReleasedAt: evidence.preFailureQualityReleasedAt ? new Date(evidence.preFailureQualityReleasedAt) : null,
      labelPrintCount: { increment: 1 },
      version: { increment: 1 },
      ...actorUpdateFields(actorUserId),
    },
    include: packedUnitInclude,
  });
  const event = await createPackedUnitEvent(tx, {
    batchId: unit.batchId,
    unitId: unit.id,
    type: PACKING_EVENT_TYPES.UNIT_LABEL_REPRINTED,
    reason: evidence.reprintReason || evidence.reason || 'Recovered post-seal label reprint.',
    payload: { recoveryMode: 'POST_SEAL_REPRINT', originalSealEventId: existingSealed.id, pendingEventId: pendingEvent.id, barcode: unit.barcode, labelPrintCount: updated.labelPrintCount, label, beforeStatus: unit.status, afterStatus: updated.status, preFailureStatus: priorStatus },
    idempotencyKey: `${pendingEvent.id}:post-seal-recovered`,
    actorUserId,
  });
  return serialize({ unit: updated, label, labelPending: false, recovery: { outcome: 'POST_SEAL_REPRINT_RECOVERED', originalSealEventId: existingSealed.id, pendingEventId: pendingEvent.id, reprintEventId: event.id, preFailureStatus: priorStatus } });
}

export async function reprintPackingUnitLabel({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runUnitAction({ operation: 'packing.unit.reprint_label', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    if (!unit.barcode || !SEALED_STATUSES.includes(unit.status)) throw conflict('unit_not_labelable', 'Only a sealed, identifiable unit can be reprinted.');
    if (unit.status === UNIT_STATUSES.LABEL_PENDING) return recoverPendingSeal(tx, unit, actorUserId, idempotencyKey);
    let label;
    try {
      label = generatePackedUnitLabel(unit);
    } catch (error) {
      const pending = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.LABEL_PENDING, qualityReleasedAt: null, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
      const previousPending = await tx.packedUnitEvent.findFirst({ where: { unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { payload: true } });
      await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_LABEL_PENDING, reason: error?.message || 'Label generation failed.', payload: { recoveryMode: 'POST_SEAL_REPRINT', preFailureStatus: unit.status, preFailureQualityReleasedAt: unit.qualityReleasedAt ? new Date(unit.qualityReleasedAt).toISOString() : null, reprintReason: reason, labelIdentity: { barcode: unit.barcode, itemId: unit.itemId, itemName: unit.item?.name || null, baseCount: unit.baseCount }, available: false, sealingEvidence: previousPending?.payload?.sealingEvidence || null, error: error?.code || 'label_generation_failed' }, idempotencyKey: `${idempotencyKey}:pending`, actorUserId });
      return serialize({ unit: pending, label: null, labelPending: true });
    }
    const nextStatus = unit.status === UNIT_STATUSES.LABEL_PENDING
      ? (unit.recipe?.requiresQualityHold ? UNIT_STATUSES.QUALITY_HOLD : (unit.customerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE))
      : unit.status;
    if (nextStatus !== unit.status) transitionUnit(unit.status, nextStatus);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: nextStatus, qualityReleasedAt: nextStatus === UNIT_STATUSES.QUALITY_HOLD ? null : new Date(), labelPrintCount: { increment: 1 }, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_LABEL_REPRINTED, reason, payload: { barcode: unit.barcode, labelPrintCount: updated.labelPrintCount, label, beforeStatus: unit.status, afterStatus: updated.status }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize({ unit: updated, label, labelPending: false });
  } });
}

export async function replacePackingUnitBarcode({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runUnitAction({ operation: 'packing.unit.replace_barcode', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    if (!unit.barcode || !SEALED_STATUSES.includes(unit.status)) throw conflict('unit_not_replaceable', 'Only a sealed, identifiable unit can have its barcode replaced.');
    const sequence = await allocateUnitSequence(tx, unit.batchId, unit.levelIndex);
    const barcode = await allocatePackingUnitBarcode(tx, unit.batch?.batchNo, unit.levelIndex, sequence);
    const replacement = await tx.packedUnit.create({
      data: {
        batchId: unit.batchId,
        recipeId: unit.recipeId,
        packageTypeId: unit.packageTypeId,
        parentUnitId: unit.parentUnitId,
        levelIndex: unit.levelIndex,
        unitSequence: sequence,
        barcode,
        isStockUnit: unit.isStockUnit,
        status: unit.status,
        itemId: unit.itemId,
        wrapperId: unit.wrapperId,
        colorId: unit.colorId,
        coneTypeId: unit.coneTypeId,
        customerId: unit.customerId,
        nominalGram: unit.nominalGram,
        baseCount: unit.baseCount,
        grossWeightKg: unit.grossWeightKg,
        tareWeightKg: unit.tareWeightKg,
        netWeightKg: unit.netWeightKg,
        labelPrintCount: 1,
        sealedAt: unit.sealedAt,
        qualityReleasedAt: unit.qualityReleasedAt,
        splitFromUnitId: unit.splitFromUnitId,
        ...actorCreateFields(actorUserId),
      },
      include: packedUnitInclude,
    });
    // Barcode replacement is an identity exception, represented by the new
    // replacement row plus an append-only event rather than a normal status
    // transition.
    await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.VOIDED, replacedByUnitId: replacement.id, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_BARCODE_REPLACED, reason, payload: { oldBarcode: unit.barcode, newBarcode: barcode, replacementUnitId: replacement.id }, idempotencyKey: `${idempotencyKey}:old`, actorUserId });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: replacement.id, type: PACKING_EVENT_TYPES.UNIT_BARCODE_REPLACED, reason, payload: { oldUnitId: unit.id, oldBarcode: unit.barcode, newBarcode: barcode }, idempotencyKey: `${idempotencyKey}:new`, actorUserId });
    return serialize({ replacedUnit: unit, replacementUnit: replacement, generatedIdentity: { id: replacement.id, barcode: replacement.barcode, batchId: replacement.batchId, levelIndex: replacement.levelIndex, unitSequence: replacement.unitSequence } });
  } });
}

export async function releasePackingUnitQuality({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runUnitAction({ operation: 'packing.unit.release_quality', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    if (unit.status !== UNIT_STATUSES.QUALITY_HOLD) throw conflict('unit_not_on_quality_hold', 'Only a QUALITY_HOLD unit can be released.');
    const nextStatus = unit.customerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE;
    transitionUnit(unit.status, nextStatus);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: nextStatus, qualityReleasedAt: new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_QUALITY_RELEASED, reason, payload: { beforeStatus: unit.status, afterStatus: nextStatus }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function returnPackingUnit({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  const opened = payload?.opened === true;
  const physicallyChanged = payload?.physicallyChanged === true;
  return runUnitAction({ operation: 'packing.unit.return', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    if (unit.status !== UNIT_STATUSES.DISPATCHED) throw conflict('unit_not_returnable', 'Only a DISPATCHED Packed Unit can be returned.');
    transitionUnit(unit.status, UNIT_STATUSES.RETURNED_PENDING_INSPECTION);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.RETURNED_PENDING_INSPECTION, customerId: null, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RETURNED, reason, payload: { beforeStatus: unit.status, afterStatus: updated.status, opened, physicallyChanged, customerId: unit.customerId }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function inspectPackingUnitReturn({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  const outcome = String(payload?.outcome || '').trim().toUpperCase();
  if (!['AVAILABLE', 'RESERVED', 'DAMAGED', 'REPACKED'].includes(outcome)) throw badRequest('invalid_return_outcome', 'Return outcome must be AVAILABLE, RESERVED, DAMAGED, or REPACKED.');
  return runUnitAction({ operation: 'packing.unit.inspect_return', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    if (unit.status !== UNIT_STATUSES.RETURNED_PENDING_INSPECTION) throw conflict('unit_not_pending_inspection', 'Only a returned unit can be inspected.');
    const nextStatus = outcome;
    if (nextStatus === UNIT_STATUSES.RESERVED) {
      const customerId = optionalString(payload?.customerId, 100);
      if (!customerId) throw badRequest('reservation_customer_required', 'A returned unit needs an explicit current Customer assignment before it can be RESERVED.');
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.isActive === false) throw badRequest('customer_inactive', 'The explicitly assigned return Customer is missing or inactive.');
      if (unit.recipe?.customerId && unit.recipe.customerId !== customerId) throw badRequest('recipe_customer_restricted', 'The returned unit recipe is restricted to a different Customer.');
      unit.customerId = customerId;
    }
    const condition = await latestReturnCondition(tx, unit.id);
    if ((condition.opened || condition.physicallyChanged) && nextStatus !== UNIT_STATUSES.REPACKED) {
      throw badRequest('repacking_required', 'Opened or physically changed returns must enter a real Repacking batch.');
    }
    if (nextStatus === UNIT_STATUSES.REPACKED) {
      const repackingBatch = await createPackingRepackingBatchInTransaction(tx, {
        payload: {
          recipeId: unit.recipeId,
          sourceUnitIds: [unit.id],
          customerId: payload?.customerId || null,
          notes: reason,
        },
        actorUserId,
        idempotencyKey: `${idempotencyKey}:repacking`,
      });
      const pendingRepackingUnit = await tx.packedUnit.findUnique({ where: { id: unit.id }, include: packedUnitInclude });
      await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RETURN_INSPECTED, reason, payload: { beforeStatus: unit.status, afterStatus: unit.status, condition, repackingBatch, pendingRepacking: true }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
      return serialize({ unit: pendingRepackingUnit, repackingBatch, pendingRepacking: true });
    }
    if (nextStatus === UNIT_STATUSES.DAMAGED) {
      const salvageableBaseCount = parsePositiveInt(payload?.salvageableBaseCount ?? 0, 'salvageableBaseCount', { allowZero: true });
      const salvageableWeightKg = parseNonNegativeNumber(payload?.salvageableWeightKg ?? 0, 'salvageableWeightKg');
      const damaged = await applyDamageInTransaction(tx, unit, { salvageableBaseCount, salvageableWeightKg, actorUserId, idempotencyKey, reason, condition });
      await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RETURN_INSPECTED, reason, payload: { beforeStatus: unit.status, afterStatus: damaged.unit.status, condition, damage: damaged }, idempotencyKey: `${idempotencyKey}:inspection`, actorUserId });
      return serialize(damaged);
    }
    if (nextStatus === UNIT_STATUSES.AVAILABLE) unit.customerId = null;
    transitionUnit(unit.status, nextStatus);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: nextStatus, customerId: unit.customerId, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RETURN_INSPECTED, reason, payload: { beforeStatus: unit.status, afterStatus: nextStatus, condition, customerId: updated.customerId }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

async function applyDamageInTransaction(tx, unit, { salvageableBaseCount, salvageableWeightKg, actorUserId, idempotencyKey, reason, condition = null }) {
  if (![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.RETURNED_PENDING_INSPECTION, UNIT_STATUSES.DAMAGED].includes(unit.status)) throw conflict('unit_not_damageable', 'This Packed Unit cannot be marked damaged in its current state. Release QUALITY_HOLD through the canonical quality boundary first.', { status: unit.status });
  const salvage = assertSalvageConservation(unit, salvageableBaseCount, salvageableWeightKg);
  const writtenOff = {
    baseCount: Number(unit.baseCount) - salvage.baseCount,
    netWeightKg: Math.max(0, Number(unit.netWeightKg) - salvage.netWeightKg),
  };
  const beforeStatus = unit.status;
  if (unit.status !== UNIT_STATUSES.DAMAGED) {
    transitionUnit(unit.status, UNIT_STATUSES.DAMAGED);
    await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.DAMAGED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
  }
  await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_DAMAGED, reason, payload: { beforeStatus, afterStatus: UNIT_STATUSES.DAMAGED, original: { baseCount: unit.baseCount, netWeightKg: unit.netWeightKg }, salvageable: salvage, condition }, idempotencyKey: `${idempotencyKey}:damage`, actorUserId });
  const salvageUnit = await createSalvageUnit(tx, unit, salvage, actorUserId, idempotencyKey, reason);
  let updated = await tx.packedUnit.findUnique({ where: { id: unit.id }, include: packedUnitInclude });
  if (salvageUnit) {
    transitionUnit(UNIT_STATUSES.DAMAGED, UNIT_STATUSES.REPACKED);
    updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.REPACKED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_SPLIT, reason, payload: { salvageUnitId: salvageUnit.id, salvage, writtenOff }, idempotencyKey: `${idempotencyKey}:split`, actorUserId });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_REPACKED, reason, payload: { salvageUnitId: salvageUnit.id, writtenOff }, idempotencyKey: `${idempotencyKey}:repacked`, actorUserId });
  }
  if (writtenOff.baseCount > 0 || writtenOff.netWeightKg > 0.001) {
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_WRITTEN_OFF, reason, payload: { writtenOff, excludedFromRepacking: true }, idempotencyKey: `${idempotencyKey}:writeoff`, actorUserId });
  }
  return { unit: updated, salvageUnit, salvageable: salvage, writtenOff };
}

export async function damagePackingUnit({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  const salvageableBaseCount = parsePositiveInt(payload?.salvageableBaseCount ?? 0, 'salvageableBaseCount', { allowZero: true });
  const salvageableWeightKg = parseNonNegativeNumber(payload?.salvageableWeightKg ?? 0, 'salvageableWeightKg');
  return runUnitAction({ operation: 'packing.unit.damage', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    return serialize(await applyDamageInTransaction(tx, unit, { salvageableBaseCount, salvageableWeightKg, actorUserId, idempotencyKey, reason }));
  } });
}

export async function writeOffPackingUnit({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  const writtenOffBaseCount = parsePositiveInt(payload?.writtenOffBaseCount ?? 0, 'writtenOffBaseCount', { allowZero: true });
  const writtenOffWeightKg = parseNonNegativeNumber(payload?.writtenOffWeightKg ?? 0, 'writtenOffWeightKg');
  return runUnitAction({ operation: 'packing.unit.write_off', id, actorUserId, idempotencyKey, client, work: async (tx, unit) => {
    if (![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.RETURNED_PENDING_INSPECTION, UNIT_STATUSES.DAMAGED].includes(unit.status)) throw conflict('unit_not_writable_off', 'This Packed Unit cannot be written off in its current state. Release QUALITY_HOLD through the canonical quality boundary first.', { status: unit.status });
    if (writtenOffBaseCount > Number(unit.baseCount) || writtenOffWeightKg > Number(unit.netWeightKg) + 0.001) throw badRequest('writeoff_exceeds_content', 'Written-off content cannot exceed the sealed unit content.');
    const salvageableBaseCount = Number(unit.baseCount) - writtenOffBaseCount;
    const salvageableWeightKg = Math.max(0, Number(unit.netWeightKg) - writtenOffWeightKg);
    return serialize(await applyDamageInTransaction(tx, unit, { salvageableBaseCount, salvageableWeightKg, actorUserId, idempotencyKey, reason }));
  } });
}

export async function getPackingUnit(id, client = prisma) {
  const unit = await client.packedUnit.findUnique({ where: { id: String(id) }, include: packedUnitInclude });
  if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit not found.', { id });
  return unit;
}

export async function getPackingUnitHistory({ id, cursor, limit = 50, client = prisma } = {}) {
  const unitId = requireNonEmptyString(id, 'id', 100);
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const unit = await client.packedUnit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit not found.', { id: unitId });
  const where = { unitId };
  if (cursor) {
    const marker = await client.packedUnitEvent.findUnique({ where: { id: String(cursor) }, select: { id: true, unitId: true, createdAt: true } });
    if (!marker || marker.unitId !== unitId) throw badRequest('invalid_cursor', 'Packed Unit history cursor is invalid.', { cursor });
    where.OR = [{ createdAt: { lt: marker.createdAt } }, { createdAt: marker.createdAt, id: { lt: marker.id } }];
  }
  const rows = await client.packedUnitEvent.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { batch: { select: { id: true, batchNo: true, kind: true } } },
  });
  const hasMore = rows.length > take;
  const events = hasMore ? rows.slice(0, take) : rows;
  return { events, nextCursor: hasMore ? events[events.length - 1].id : null };
}

export async function dispatchWholePackedUnit({ id, customerId, actorUserId, client = prisma }) {
  const unitId = requireNonEmptyString(id, 'id', 100);
  return client.$transaction(async (tx) => {
    const unit = await findUnitForUpdate(tx, unitId, true);
    await assertUnitNotReservedForPacking(tx, unit.id);
    if (![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(unit.status)) throw conflict('unit_not_dispatchable', 'Packed Unit is not available for Dispatch.', { status: unit.status });
    if (unit.customerId && unit.customerId !== String(customerId)) throw conflict('customer_reservation_mismatch', 'Packed Unit is reserved to a different Customer.');
    transitionUnit(unit.status, UNIT_STATUSES.DISPATCHED);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.DISPATCHED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    return serialize(updated);
  });
}

export async function splitPackedUnitForDispatch({ id, customerId, dispatchedBaseCount, dispatchedNetWeightKg, reason, actorUserId, idempotencyKey = null, client = prisma }) {
  const unitId = requireNonEmptyString(id, 'id', 100);
  const why = requireNonEmptyString(reason, 'reason', 1000);
  const count = parsePositiveInt(dispatchedBaseCount, 'dispatchedBaseCount');
  const weight = parseNonNegativeNumber(dispatchedNetWeightKg, 'dispatchedNetWeightKg', { allowZero: false });
  return client.$transaction(async (tx) => {
    const unit = await findUnitForUpdate(tx, unitId, true);
    await assertUnitNotReservedForPacking(tx, unit.id);
    if (![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED].includes(unit.status)) throw conflict('unit_not_splitable', 'Packed Unit is not available for a partial Dispatch.', { status: unit.status });
    if (!unit.recipe?.allowPartialDispatch) throw conflict('partial_dispatch_not_allowed', 'The active recipe does not allow partial Dispatch.');
    if (unit.customerId && unit.customerId !== String(customerId)) throw conflict('customer_reservation_mismatch', 'Packed Unit is reserved to a different Customer.');
    const residualCount = Number(unit.baseCount) - count;
    const residualWeight = Number(unit.netWeightKg) - weight;
    if (residualCount <= 0 || residualWeight <= 0) throw badRequest('invalid_partial_split', 'Partial Dispatch must leave a positive residual count and weight.');
    const unitSequence = await allocateUnitSequence(tx, unit.batchId, unit.levelIndex);
    const dispatchedBarcode = await allocatePackingUnitBarcode(tx, unit.batch?.batchNo, unit.levelIndex, unitSequence);
    const residualSequence = await allocateUnitSequence(tx, unit.batchId, unit.levelIndex);
    const residualBarcode = await allocatePackingUnitBarcode(tx, unit.batch?.batchNo, unit.levelIndex, residualSequence);
    const nextCustomerId = unit.customerId || String(customerId || '') || null;
    const baseData = {
      batchId: unit.batchId,
      recipeId: unit.recipeId,
      packageTypeId: unit.packageTypeId,
      parentUnitId: unit.parentUnitId,
      levelIndex: unit.levelIndex,
      isStockUnit: unit.isStockUnit,
      itemId: unit.itemId,
      wrapperId: unit.wrapperId,
      colorId: unit.colorId,
      coneTypeId: unit.coneTypeId,
      customerId: nextCustomerId,
      nominalGram: unit.nominalGram,
      sealedAt: new Date(),
      qualityReleasedAt: unit.qualityReleasedAt,
      ...actorCreateFields(actorUserId),
    };
    const dispatched = await tx.packedUnit.create({ data: { ...baseData, unitSequence, barcode: dispatchedBarcode, status: UNIT_STATUSES.DISPATCHED, baseCount: count, grossWeightKg: weight + Number(unit.tareWeightKg), tareWeightKg: unit.tareWeightKg, netWeightKg: weight, labelPrintCount: 1, splitFromUnitId: unit.id }, include: packedUnitInclude });
    const residual = await tx.packedUnit.create({ data: { ...baseData, unitSequence: residualSequence, barcode: residualBarcode, status: nextCustomerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE, baseCount: residualCount, grossWeightKg: residualWeight + Number(unit.tareWeightKg), tareWeightKg: unit.tareWeightKg, netWeightKg: residualWeight, labelPrintCount: 1, splitFromUnitId: unit.id }, include: packedUnitInclude });
    // Both physical identities must have valid authoritative labels before the
    // source is retired. Any label-generation error aborts this transaction,
    // so Dispatch cannot leave behind an unlabeled residual balance.
    const dispatchedLabel = generatePackedUnitLabel(dispatched);
    const residualLabel = generatePackedUnitLabel(residual);
    transitionUnit(unit.status, UNIT_STATUSES.SPLIT_CONSUMED);
    await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.SPLIT_CONSUMED, replacedByUnitId: residual.id, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_SPLIT, reason: why, payload: { dispatchedUnitId: dispatched.id, residualUnitId: residual.id, before: { baseCount: unit.baseCount, netWeightKg: unit.netWeightKg }, dispatched: { baseCount: count, netWeightKg: weight, label: dispatchedLabel }, residual: { baseCount: residualCount, netWeightKg: residualWeight, label: residualLabel } }, idempotencyKey: `dispatch-split:${idempotencyKey || unit.id}`, actorUserId });
    return serialize({ originalUnit: unit, dispatchedUnit: dispatched, dispatchedLabel, residualUnit: residual, residualLabel });
  });
}
