import { jsonValue, round, toNumber } from './reportUtils.js';

// WP-02 owns the notification event calls. These pure formatters keep the
// batch-level and exceptional payload shapes stable without touching the
// existing notification infrastructure.
export const PACKING_NOTIFICATION_EVENTS = Object.freeze({
  BATCH_COMPLETED: 'packing_batch_completed',
  BATCH_SHORT_CLOSED: 'packing_batch_short_closed',
  QUALITY_VARIANCE_EXCEPTION: 'packing_quality_variance_exception',
  DAMAGE_WRITE_OFF: 'packing_damage_write_off',
  RECONCILIATION_APPLIED: 'packing_reconciliation_applied',
  RECONCILIATION_REVERSED: 'packing_reconciliation_reversed',
  CUSTOMER_READY: 'packing_customer_ready',
});

export function formatPackingBatchNotification(batch = {}, options = {}) {
  return {
    batchId: batch.id || null,
    batchNo: batch.batchNo || null,
    kind: batch.kind || null,
    status: batch.status || null,
    recipeId: batch.recipeId || null,
    customerId: batch.customerId || null,
    customerName: options.customerName || batch.customer?.name || null,
    deliveryMode: batch.deliveryMode || null,
    plannedBaseCount: toNumber(batch.plannedBaseCount),
    plannedNetWeightKg: toNumber(batch.plannedNetWeightKg),
    actualBaseCount: toNumber(options.actualBaseCount),
    actualNetWeightKg: toNumber(options.actualNetWeightKg),
    variancePercent: options.variancePercent === null || options.variancePercent === undefined ? null : round(options.variancePercent),
    reason: options.reason || batch.shortCloseReason || batch.voidReason || null,
    createdByUserId: batch.createdByUserId || null,
    updatedByUserId: batch.updatedByUserId || null,
  };
}

export function formatPackingExceptionNotification(event = {}, options = {}) {
  return {
    eventId: event.id || null,
    eventType: event.type || null,
    batchId: event.batchId || event.batch?.id || null,
    batchNo: event.batch?.batchNo || options.batchNo || null,
    unitId: event.unitId || event.unit?.id || null,
    barcode: event.unit?.barcode || options.barcode || null,
    reason: event.reason || options.reason || null,
    payload: jsonValue(event.payload, {}),
    actorUserId: event.actorUserId || null,
  };
}

export function formatPackingReconciliationNotification(batch = {}, options = {}) {
  return {
    adjustmentBatchId: batch.id || null,
    batchNo: batch.batchNo || null,
    kind: batch.kind || null,
    status: batch.status || null,
    effectiveAt: batch.effectiveAt || null,
    countDelta: toNumber(options.countDelta),
    weightDeltaKg: round(options.weightDeltaKg),
    reason: batch.reason || options.reason || null,
    evidenceSnapshot: jsonValue(batch.evidenceSnapshot, {}),
    createdByUserId: batch.createdByUserId || null,
    appliedByUserId: batch.appliedByUserId || null,
    reversedByUserId: batch.reversedByUserId || null,
  };
}
