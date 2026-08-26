import { Prisma } from '@prisma/client';
import { PACKING_EVENT_TYPES } from './constants.js';
import { badRequest, conflict, notFound } from './errors.js';
import { serialize } from './serialization.js';

export function actorCreateFields(actorUserId) {
  return actorUserId ? { createdByUserId: String(actorUserId), updatedByUserId: String(actorUserId) } : {};
}

export function actorUpdateFields(actorUserId) {
  return actorUserId ? { updatedByUserId: String(actorUserId) } : {};
}

export function actorId(actor) {
  return actor?.userId || actor?.id || null;
}

export function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeMasterName(value) {
  return normalizeWhitespace(value).toLocaleLowerCase();
}

export function assertEnumValue(value, allowed, field) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!allowed.includes(normalized)) throw badRequest('invalid_enum', `${field} is invalid.`, { field, allowed });
  return normalized;
}

export function assertVersion(expectedVersion, currentVersion) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') return;
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected)) throw badRequest('invalid_version', 'expectedVersion must be an integer.');
  if (expected !== Number(currentVersion)) {
    throw conflict('stale_version', 'The record changed since it was loaded. Refresh and retry.', {
      expectedVersion: expected,
      currentVersion: Number(currentVersion),
    });
  }
}

export async function lockRecord(tx, tableName, id, notFoundCode, message) {
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM ${Prisma.raw(`"${tableName}"`)}
    WHERE "id" = ${String(id)}
    FOR UPDATE
  `);
  if (!rows.length) throw notFound(notFoundCode, message, { id });
}

export async function createPackedUnitEvent(tx, {
  batchId = null,
  unitId = null,
  type,
  reason = null,
  payload = {},
  idempotencyKey,
  actorUserId = null,
}) {
  if (!Object.values(PACKING_EVENT_TYPES).includes(type)) {
    throw badRequest('invalid_event_type', 'The requested Packing event type is not supported.', { type });
  }
  const exceptional = new Set([
    PACKING_EVENT_TYPES.BATCH_TARGET_AMENDED,
    PACKING_EVENT_TYPES.BATCH_SHORT_CLOSED,
    PACKING_EVENT_TYPES.BATCH_VOIDED,
    PACKING_EVENT_TYPES.SOURCE_RELEASED,
    PACKING_EVENT_TYPES.UNIT_LABEL_REPRINTED,
    PACKING_EVENT_TYPES.UNIT_LABEL_PENDING,
    PACKING_EVENT_TYPES.UNIT_BARCODE_REPLACED,
    PACKING_EVENT_TYPES.UNIT_QUALITY_RELEASED,
    PACKING_EVENT_TYPES.UNIT_RESERVATION_RELEASED,
    PACKING_EVENT_TYPES.UNIT_RESERVATION_REASSIGNED,
    PACKING_EVENT_TYPES.UNIT_RETURNED,
    PACKING_EVENT_TYPES.UNIT_RETURN_INSPECTED,
    PACKING_EVENT_TYPES.UNIT_SPLIT,
    PACKING_EVENT_TYPES.UNIT_DAMAGED,
    PACKING_EVENT_TYPES.UNIT_WRITTEN_OFF,
    PACKING_EVENT_TYPES.UNIT_REPACKED,
    PACKING_EVENT_TYPES.ADMINISTRATIVE_AMENDMENT,
    PACKING_EVENT_TYPES.EVENT_REVERSED,
  ]);
  if (exceptional.has(type) && !String(reason || '').trim()) {
    throw badRequest('event_reason_required', 'A reason is required for this Packing event.', { type });
  }
  return tx.packedUnitEvent.create({
    data: {
      batchId,
      unitId,
      type,
      reason: reason ? String(reason).trim() : null,
      payload: serialize(payload),
      idempotencyKey: String(idempotencyKey),
      actorUserId: actorUserId ? String(actorUserId) : null,
    },
  });
}

export function assertBatchTransition(current, next) {
  const allowed = {
    DRAFT: ['CONFIRMED', 'VOIDED'],
    CONFIRMED: ['IN_PROGRESS', 'VOIDED'],
    IN_PROGRESS: ['PARTIALLY_COMPLETED'],
    PARTIALLY_COMPLETED: ['COMPLETED', 'SHORT_CLOSED'],
    COMPLETED: [],
    SHORT_CLOSED: [],
    VOIDED: [],
  };
  if (!allowed[current]?.includes(next)) {
    throw conflict('invalid_batch_transition', `Packing batch cannot transition from ${current} to ${next}.`, { current, next });
  }
}

export const recipeInclude = {
  levels: {
    orderBy: { levelIndex: 'asc' },
    include: { packageType: true },
  },
  item: true,
  wrapper: true,
  color: true,
  coneType: true,
  customer: true,
};

export const batchInclude = {
  recipe: { include: recipeInclude },
  customer: true,
  sources: { orderBy: { createdAt: 'asc' } },
  units: {
    orderBy: [{ levelIndex: 'asc' }, { unitSequence: 'asc' }],
    include: {
      packageType: true,
      item: true,
      wrapper: true,
      color: true,
      coneType: true,
      customer: true,
      parentUnit: { select: { id: true, barcode: true, levelIndex: true, status: true } },
      childUnits: { select: { id: true, barcode: true, levelIndex: true, baseCount: true, netWeightKg: true, status: true } },
    },
  },
};

export const packedUnitInclude = {
  batch: { select: { id: true, batchNo: true, kind: true, status: true, recipeId: true, deliveryMode: true } },
  recipe: { select: { id: true, familyKey: true, version: true, status: true, customerId: true, allowPartialDispatch: true, requiresQualityHold: true, stockUnitLevelIndex: true } },
  packageType: true,
  item: true,
  wrapper: true,
  color: true,
  coneType: true,
  customer: true,
  splitFromUnit: { select: { id: true, status: true } },
  parentUnit: { select: { id: true, barcode: true, levelIndex: true, status: true, baseCount: true, netWeightKg: true } },
  childUnits: { select: { id: true, barcode: true, levelIndex: true, status: true, baseCount: true, netWeightKg: true, customerId: true } },
};
