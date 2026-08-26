import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPackingNotificationRequest,
  FALLBACK_TEMPLATES,
} from '../packingNotifications.js';
import { PACKING_NOTIFICATION_EVENTS } from '../../services/packingReports/notificationFormatters.js';

test('reconciliation notifications carry authoritative event identity, actor, reason, and exact deltas', () => {
  const request = buildPackingNotificationRequest(PACKING_NOTIFICATION_EVENTS.RECONCILIATION_APPLIED, {
    batch: {
      id: 'adj-1',
      batchNo: 'ADJ-1',
      kind: 'MANUAL_CORRECTION',
      status: 'APPLIED',
      reason: 'Audited correction',
      lines: [{ countDelta: 2, weightDeltaKg: '0.125' }],
      idempotencyKey: 'apply-key',
      appliedByUserId: 'user-1',
    },
  });
  assert.equal(request.event, 'packing_reconciliation_applied');
  assert.equal(request.payload.adjustmentBatchId, 'adj-1');
  assert.equal(request.payload.countDelta, 2);
  assert.equal(request.payload.weightDeltaKg, 0.125);
  assert.equal(request.payload.createdByUserId, 'user-1');
  assert.equal(request.source, 'packing:packing_reconciliation_applied:apply-key');
  assert.match(FALLBACK_TEMPLATES[request.event], /{{batchNo}}/);
});

test('packing exception aliases resolve to the canonical quality or damage event names', () => {
  const quality = buildPackingNotificationRequest(PACKING_NOTIFICATION_EVENTS.QUALITY_VARIANCE_EXCEPTION, {
    event: { id: 'event-1', type: 'UNIT_QUALITY_HOLD', batchId: 'batch-1', unitId: 'unit-1', payload: { status: 'QUALITY_HOLD' } },
    barcode: 'PK-1',
  });
  const damage = buildPackingNotificationRequest(PACKING_NOTIFICATION_EVENTS.DAMAGE_WRITE_OFF, {
    event: { id: 'event-2', type: 'UNIT_DAMAGED', unitId: 'unit-2', reason: 'Damaged', payload: {} },
    barcode: 'PK-2',
  });
  assert.equal(quality.payload.eventType, 'UNIT_QUALITY_HOLD');
  assert.equal(damage.payload.eventType, 'UNIT_DAMAGED');
  assert.notEqual(quality.source, damage.source);
});
