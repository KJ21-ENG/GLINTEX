import prisma from '../../lib/prisma.js';
import { runIdempotent } from '../inventory/idempotency.js';
import { lockPackedSources, lockPackingSourcesForPackedUnits } from '../inventory/coningBalance.js';
import { BATCH_STATUSES, PACKING_EVENT_TYPES, UNIT_STATUSES } from './constants.js';
import {
  actorCreateFields,
  actorUpdateFields,
  actorId,
  assertEnumValue,
  batchInclude,
  createPackedUnitEvent,
  recipeInclude,
  packedUnitInclude,
} from './common.js';
import { badRequest, conflict, notFound, optionalString, parseNonNegativeNumber, parsePositiveInt, requireNonEmptyString } from './errors.js';
import { allocatePackingBatchNo } from './sequence.js';
import { serialize } from './serialization.js';
import { validatePackingRepackingSources } from './repackingValidation.js';
import { transitionUnit } from './transitionService.js';

export function buildRepackingSourceTransition(unit, { repackingBatchId, reason }) {
  return {
    beforeStatus: unit?.status || null,
    afterStatus: UNIT_STATUSES.REPACKED,
    payload: {
      sourceBatchId: unit?.batchId || null,
      sourceStatus: unit?.status || null,
      repackingBatchId,
    },
    reason,
  };
}

export async function createPackingRepackingBatchInTransaction(tx, { payload, actorUserId, idempotencyKey }) {
  const recipeId = requireNonEmptyString(payload?.recipeId, 'recipeId', 100);
  const sourceUnitIds = Array.isArray(payload?.sourceUnitIds) ? payload.sourceUnitIds.map((value) => String(value || '').trim()).filter(Boolean) : [];
  if (!sourceUnitIds.length) throw badRequest('sources_required', 'At least one Packed Unit source is required for repacking.');
  const reason = requireNonEmptyString(payload?.notes || payload?.reason, 'notes', 1000);
  const customerId = optionalString(payload?.customerId, 100);
  const uniqueSourceIdentities = [...new Set(sourceUnitIds)];
  const recipe = await tx.packingRecipe.findUnique({ where: { id: recipeId }, include: recipeInclude });
    if (!recipe) throw notFound('recipe_not_found', 'Packing recipe not found.', { id: recipeId });
    if (recipe.status !== 'ACTIVE') throw conflict('recipe_not_active', 'Only an ACTIVE recipe can create a Repacking batch.');
    const units = await tx.packedUnit.findMany({ where: { OR: [{ id: { in: uniqueSourceIdentities } }, { barcode: { in: uniqueSourceIdentities } }], isStockUnit: true }, include: packedUnitInclude });
    const foundByIdentity = new Map();
    for (const unit of units) {
      foundByIdentity.set(unit.id, unit);
      if (unit.barcode) foundByIdentity.set(unit.barcode, unit);
    }
    const selected = uniqueSourceIdentities.map((identity) => foundByIdentity.get(identity)).filter(Boolean);
    if (selected.length !== uniqueSourceIdentities.length) throw notFound('packed_source_not_found', 'One or more Repacking sources were not found.', { sourceUnitIds: uniqueSourceIdentities });
    const sourceIds = selected.map((unit) => unit.id).sort();
    await lockPackedSources(tx, sourceIds);
    await lockPackingSourcesForPackedUnits(tx, sourceIds);
    const lockedUnits = await tx.packedUnit.findMany({ where: { id: { in: sourceIds } }, include: packedUnitInclude });
    const activeReservations = await tx.packingBatchSource.findMany({
      where: { sourceType: 'PACKED_UNIT', sourceId: { in: sourceIds }, batch: { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'] } } },
      select: { sourceId: true, reservedBaseCount: true, reservedNetWeightKg: true, consumedBaseCount: true, consumedNetWeightKg: true, releasedBaseCount: true, releasedNetWeightKg: true },
    });
    if (activeReservations.length) throw conflict('packed_source_reserved', 'One or more Packed Units are already reserved by an active Packing batch.', { sourceIds: activeReservations.map((row) => row.sourceId) });
    const sourceSet = new Map(lockedUnits.map((unit) => [unit.id, unit]));
    const ordered = sourceIds.map((id) => sourceSet.get(id));
    await validatePackingRepackingSources(tx, ordered, recipe, customerId);
    const effectiveCustomerId = customerId || recipe.customerId || null;
    if (effectiveCustomerId) {
      const customer = await tx.customer.findUnique({ where: { id: effectiveCustomerId } });
      if (!customer || customer.isActive === false) throw badRequest('customer_inactive', 'An inactive or missing Customer cannot be used for repacking.');
      if (recipe.customerId && recipe.customerId !== effectiveCustomerId) throw badRequest('recipe_customer_restricted', 'The output recipe is restricted to a different Customer.');
    }
    const batchNo = await allocatePackingBatchNo(tx);
    const plannedBaseCount = ordered.reduce((total, unit) => total + Number(unit.baseCount || 0), 0);
    const plannedNetWeightKg = ordered.reduce((total, unit) => total + Number(unit.netWeightKg || 0), 0);
    const createdBatch = await tx.packingBatch.create({
      data: {
        batchNo,
        kind: 'REPACKING',
        status: BATCH_STATUSES.CONFIRMED,
        recipeId,
        recipeSnapshot: serialize(recipe),
        customerId: effectiveCustomerId,
        deliveryMode: recipe.deliveryMode,
        plannedBaseCount,
        plannedNetWeightKg,
        notes: reason,
        confirmedAt: new Date(),
        ...actorCreateFields(actorUserId),
      },
    });
    for (const unit of ordered) {
      await tx.packingBatchSource.create({
        data: {
          batchId: createdBatch.id,
          sourceType: 'PACKED_UNIT',
          sourceId: unit.id,
          sourceBarcode: unit.barcode,
          sourceItemSnapshot: serialize({ id: unit.itemId, name: unit.item?.name }),
          sourceLotSnapshot: serialize({ batchId: unit.batchId, batchNo: unit.batch?.batchNo }),
          sourceRecipeSnapshot: serialize({ recipeId: unit.recipeId, familyKey: unit.recipe?.familyKey, version: unit.recipe?.version }),
          sourceCustomerSnapshot: serialize({ customerId: unit.customerId }),
          reservedBaseCount: unit.baseCount,
          reservedNetWeightKg: unit.netWeightKg,
          ...actorCreateFields(actorUserId),
        },
      });
      await createPackedUnitEvent(tx, { batchId: createdBatch.id, type: PACKING_EVENT_TYPES.SOURCE_RESERVED, payload: { sourceType: 'PACKED_UNIT', sourceId: unit.id, reservedBaseCount: unit.baseCount, reservedNetWeightKg: unit.netWeightKg }, idempotencyKey: `${idempotencyKey}:reserve:${unit.id}`, actorUserId });
      if (unit.status !== UNIT_STATUSES.REPACKED) {
        const transition = buildRepackingSourceTransition(unit, { repackingBatchId: createdBatch.id, reason });
        transitionUnit(unit.status, transition.afterStatus);
        await tx.packedUnit.update({ where: { id: unit.id }, data: { status: transition.afterStatus, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
        await createPackedUnitEvent(tx, {
          batchId: createdBatch.id,
          unitId: unit.id,
          type: PACKING_EVENT_TYPES.UNIT_REPACKED,
          reason: transition.reason,
          payload: transition.payload,
          idempotencyKey: `${idempotencyKey}:unit-repacked:${unit.id}`,
          actorUserId,
        });
      }
    }
    await createPackedUnitEvent(tx, { batchId: createdBatch.id, type: PACKING_EVENT_TYPES.BATCH_CONFIRMED, payload: { kind: 'REPACKING', sourceUnitIds: ordered.map((unit) => unit.id), plannedBaseCount, plannedNetWeightKg }, idempotencyKey: `${idempotencyKey}:batch`, actorUserId });
    const batch = await tx.packingBatch.findUnique({ where: { id: createdBatch.id }, include: batchInclude });
  return serialize(batch);
}

export async function createPackingRepackingBatch({ payload, actorUserId, idempotencyKey, client = prisma }) {
  return runIdempotent({ operation: 'packing.repacking_batch.create', idempotencyKey, actorUserId, client, work: async (tx) => createPackingRepackingBatchInTransaction(tx, { payload, actorUserId, idempotencyKey }) });
}
