import prisma from '../../lib/prisma.js';
import { runIdempotent } from '../inventory/idempotency.js';
import { PACKING_EVENT_TYPES, UNIT_STATUSES } from './constants.js';
import { actorUpdateFields, createPackedUnitEvent, lockRecord, packedUnitInclude } from './common.js';
import { badRequest, conflict, notFound, requireNonEmptyString } from './errors.js';
import { serialize } from './serialization.js';
import { transitionUnit } from './transitionService.js';

async function findUnitForUpdate(tx, id) {
  await lockRecord(tx, 'PackedUnit', id, 'packed_unit_not_found', 'Packed Unit not found.');
  const unit = await tx.packedUnit.findUnique({ where: { id: String(id) }, include: packedUnitInclude });
  if (!unit) throw notFound('packed_unit_not_found', 'Packed Unit not found.', { id });
  if (!unit.isStockUnit) throw badRequest('not_stock_unit', 'Only independently actionable stock units can be reserved.');
  const packingReservation = await tx.packingBatchSource.findFirst({
    where: { sourceType: 'PACKED_UNIT', sourceId: unit.id, batch: { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'] } } },
    select: { batchId: true },
  });
  if (packingReservation) throw conflict('unit_reserved_for_packing', 'This Packed Unit is reserved as a source for another Packing batch.', { batchId: packingReservation.batchId });
  return unit;
}

async function assertCustomer(tx, customerId, unit) {
  const id = requireNonEmptyString(customerId, 'customerId', 100);
  const customer = await tx.customer.findUnique({ where: { id } });
  if (!customer) throw notFound('customer_not_found', 'Customer not found.', { customerId: id });
  if (customer.isActive === false) throw badRequest('customer_inactive', 'Inactive customers cannot receive new reservations.', { customerId: id });
  if (unit.recipe?.customerId && unit.recipe.customerId !== id) throw badRequest('recipe_customer_restricted', 'This recipe is restricted to a different Customer.', { recipeCustomerId: unit.recipe.customerId, customerId: id });
  return id;
}

export async function reservePackedUnit({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  return runIdempotent({ operation: 'packed_stock.reserve', idempotencyKey, actorUserId, client, work: async (tx) => {
    const unit = await findUnitForUpdate(tx, id);
    const customerId = await assertCustomer(tx, payload?.customerId, unit);
    if (unit.status === UNIT_STATUSES.RESERVED) {
      if (unit.customerId === customerId) return serialize(unit);
      throw conflict('unit_already_reserved', 'Packed Unit is already reserved to another Customer.', { customerId: unit.customerId });
    }
    if (![UNIT_STATUSES.AVAILABLE].includes(unit.status)) throw conflict('unit_not_reservable', 'Packed Unit is not currently available for reservation.', { status: unit.status });
    transitionUnit(unit.status, UNIT_STATUSES.RESERVED);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { customerId, status: UNIT_STATUSES.RESERVED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RESERVED, reason: payload?.reason || null, payload: { beforeCustomerId: unit.customerId, afterCustomerId: customerId }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function releasePackedUnitReservation({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runIdempotent({ operation: 'packed_stock.release_reservation', idempotencyKey, actorUserId, client, work: async (tx) => {
    const unit = await findUnitForUpdate(tx, id);
    if (unit.status !== UNIT_STATUSES.RESERVED) throw conflict('unit_not_reserved', 'Only a RESERVED Packed Unit can release its reservation.', { status: unit.status });
    transitionUnit(unit.status, UNIT_STATUSES.AVAILABLE);
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { customerId: null, status: UNIT_STATUSES.AVAILABLE, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RESERVATION_RELEASED, reason, payload: { beforeCustomerId: unit.customerId, afterCustomerId: null }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function reassignPackedUnitReservation({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runIdempotent({ operation: 'packed_stock.reassign_reservation', idempotencyKey, actorUserId, client, work: async (tx) => {
    const unit = await findUnitForUpdate(tx, id);
    if (unit.status !== UNIT_STATUSES.RESERVED) throw conflict('unit_not_reserved', 'Only a RESERVED Packed Unit can be reassigned.', { status: unit.status });
    const customerId = await assertCustomer(tx, payload?.customerId, unit);
    if (customerId === unit.customerId) throw badRequest('same_customer', 'The new Customer must differ from the current reservation.');
    const updated = await tx.packedUnit.update({ where: { id: unit.id }, data: { customerId, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: packedUnitInclude });
    await createPackedUnitEvent(tx, { batchId: unit.batchId, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_RESERVATION_REASSIGNED, reason, payload: { beforeCustomerId: unit.customerId, afterCustomerId: customerId }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}
