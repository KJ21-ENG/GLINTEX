import { sendNotification } from './notifications.js';
import {
  formatPackingBatchNotification,
  formatPackingExceptionNotification,
  formatPackingReconciliationNotification,
  PACKING_NOTIFICATION_EVENTS,
} from '../services/packingReports/notificationFormatters.js';

const FALLBACK_TEMPLATES = Object.freeze({
  [PACKING_NOTIFICATION_EVENTS.BATCH_COMPLETED]: 'Packing batch {{batchNo}} completed.',
  [PACKING_NOTIFICATION_EVENTS.BATCH_SHORT_CLOSED]: 'Packing batch {{batchNo}} was short closed. Reason: {{reason}}',
  [PACKING_NOTIFICATION_EVENTS.QUALITY_VARIANCE_EXCEPTION]: 'Packing quality or variance exception for batch {{batchNo}}, unit {{barcode}}. Reason: {{reason}}',
  [PACKING_NOTIFICATION_EVENTS.DAMAGE_WRITE_OFF]: 'Packing damage or write-off recorded for unit {{barcode}}. Reason: {{reason}}',
  [PACKING_NOTIFICATION_EVENTS.RECONCILIATION_APPLIED]: 'Packing reconciliation {{batchNo}} was applied. Reason: {{reason}}',
  [PACKING_NOTIFICATION_EVENTS.RECONCILIATION_REVERSED]: 'Packing reconciliation {{batchNo}} was reversed. Reason: {{reason}}',
  [PACKING_NOTIFICATION_EVENTS.CUSTOMER_READY]: 'Packing batch {{batchNo}} is ready for customer delivery.',
});

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function reconciliationTotals(batch = {}, payload = {}) {
  const lines = Array.isArray(batch.lines) ? batch.lines : [];
  return {
    countDelta: payload.countDelta ?? lines.reduce((sum, line) => sum + numberOrZero(line.countDelta), 0),
    weightDeltaKg: payload.weightDeltaKg ?? lines.reduce((sum, line) => sum + numberOrZero(line.weightDeltaKg), 0),
  };
}

function notificationIdentity(event, payload = {}) {
  const batch = payload.batch || payload.reversal || payload;
  const identity = payload.eventId || payload.idempotencyKey || batch?.idempotencyKey || batch?.id || payload.batchId || payload.unitId || payload.barcode || 'unknown';
  return `packing:${event}:${String(identity).replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 80)}`;
}

function dispatch(event, payload, { source = notificationIdentity(event, payload) } = {}) {
  try {
    return Promise.resolve(sendNotification(event, payload, {
      fallbackTemplate: FALLBACK_TEMPLATES[event],
      source,
    })).catch((error) => {
      console.error('Packing notification failed', error);
      return null;
    });
  } catch (error) {
    console.error('Packing notification failed', error);
    return Promise.resolve(null);
  }
}

export function buildPackingNotificationRequest(event, payload = {}) {
  const batch = payload.batch || payload.reversal || payload;
  if (event === PACKING_NOTIFICATION_EVENTS.RECONCILIATION_APPLIED || event === PACKING_NOTIFICATION_EVENTS.RECONCILIATION_REVERSED) {
    const totals = reconciliationTotals(batch, payload);
    return {
      event,
      payload: {
        ...formatPackingReconciliationNotification(batch, { ...payload, ...totals }),
        eventId: payload.eventId || `${event}:${batch?.id || payload.batchId || 'unknown'}`,
        createdByUserId: payload.createdByUserId || batch?.appliedByUserId || batch?.reversedByUserId || batch?.createdByUserId || null,
      },
      source: notificationIdentity(event, payload),
    };
  }
  if (event === PACKING_NOTIFICATION_EVENTS.QUALITY_VARIANCE_EXCEPTION || event === PACKING_NOTIFICATION_EVENTS.DAMAGE_WRITE_OFF) {
    return {
      event,
      payload: {
        ...formatPackingExceptionNotification(payload.event || payload, payload),
        createdByUserId: payload.createdByUserId || null,
      },
      source: notificationIdentity(event, payload),
    };
  }
  return {
    event,
    payload: {
      ...formatPackingBatchNotification(batch, payload),
      createdByUserId: payload.createdByUserId || batch?.createdByUserId || null,
    },
    source: notificationIdentity(event, payload),
  };
}

function notifyFormatted(event, payload) {
  const request = buildPackingNotificationRequest(event, payload);
  return dispatch(request.event, request.payload, { source: request.source });
}

export function notifyPackingBatchCompleted(payload = {}) {
  return notifyFormatted(PACKING_NOTIFICATION_EVENTS.BATCH_COMPLETED, payload);
}

export function notifyPackingBatchShortClosed(payload = {}) {
  return notifyFormatted(PACKING_NOTIFICATION_EVENTS.BATCH_SHORT_CLOSED, payload);
}

export function notifyPackingCustomerReady(payload = {}) {
  return notifyFormatted(PACKING_NOTIFICATION_EVENTS.CUSTOMER_READY, payload);
}

export function notifyPackingBatchVariance(payload = {}) {
  const warningVariancePercent = Number(payload.warningVariancePercent);
  const approvalVariancePercent = Number(payload.approvalVariancePercent);
  const maxVariancePercent = Number(payload.maxVariancePercent);
  const warningExceeded = Number.isFinite(maxVariancePercent) && Number.isFinite(warningVariancePercent) && maxVariancePercent > warningVariancePercent + 0.000001;
  const approvalExceeded = Number.isFinite(maxVariancePercent) && Number.isFinite(approvalVariancePercent) && maxVariancePercent > approvalVariancePercent + 0.000001;
  if (!warningExceeded && !approvalExceeded) return Promise.resolve(null);
  return notifyFormatted(PACKING_NOTIFICATION_EVENTS.QUALITY_VARIANCE_EXCEPTION, {
    ...payload,
    event: {
      id: payload.eventId || null,
      type: PACKING_NOTIFICATION_EVENTS.QUALITY_VARIANCE_EXCEPTION,
      batchId: payload.batchId || null,
      reason: payload.reason || null,
      payload: { ...payload, warningExceeded, approvalExceeded },
    },
  });
}

export function notifyPackingException(event, payload = {}) {
  const normalizedEvent = event === 'packing_quality_hold' || event === 'packing_variance_exception'
    ? PACKING_NOTIFICATION_EVENTS.QUALITY_VARIANCE_EXCEPTION
    : event === 'packing_damage' || event === 'packing_write_off'
      ? PACKING_NOTIFICATION_EVENTS.DAMAGE_WRITE_OFF
      : event;
  return notifyFormatted(normalizedEvent, payload);
}

export function notifyPackingReconciliation(action, payload = {}) {
  const event = action === 'reversed'
    ? PACKING_NOTIFICATION_EVENTS.RECONCILIATION_REVERSED
    : PACKING_NOTIFICATION_EVENTS.RECONCILIATION_APPLIED;
  return notifyFormatted(event, payload);
}

export { FALLBACK_TEMPLATES };
