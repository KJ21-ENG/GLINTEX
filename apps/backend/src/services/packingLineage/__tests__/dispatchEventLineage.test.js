import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchEventNodeData } from '../index.js';

test('Dispatch reversal events retain authoritative lineage fields', () => {
  assert.deepEqual(dispatchEventNodeData({
    id: 'event-1',
    type: 'DISPATCH_EVENT_REVERSED',
    reason: 'Correction',
    payload: { restored: true },
    reversalOfEventId: 'event-0',
    idempotencyKey: 'reverse-1',
    actorUserId: 'user-1',
  }, { id: 'line-1', challanId: 'challan-1' }), {
    dispatchEventId: 'event-1',
    eventType: 'DISPATCH_EVENT_REVERSED',
    reason: 'Correction',
    payload: { restored: true },
    reversalOfEventId: 'event-0',
    idempotencyKey: 'reverse-1',
    actorUserId: 'user-1',
    lineId: 'line-1',
    challanId: 'challan-1',
  });
});
