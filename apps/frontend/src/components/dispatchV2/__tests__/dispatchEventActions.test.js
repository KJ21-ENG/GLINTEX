import assert from 'node:assert/strict';
import test from 'node:test';
import { canReverseDispatchEvent, canShowChallanMutationActions } from '../dispatchEventActions.js';

test('fresh corrected events expose one reverse action', () => {
  assert.equal(canReverseDispatchEvent(
    { id: 'event-1', type: 'LINE_CORRECTED', lineId: 'line-1' },
    [{ id: 'line-1', sourceType: 'CUTTER' }],
  ), true);
});

test('already-reversed events are excluded from refreshed event lineage', () => {
  const corrected = { id: 'event-1', type: 'LINE_CORRECTED', lineId: 'line-1', reason: 'display text is not state' };
  const reversal = { id: 'event-2', type: 'DISPATCH_EVENT_REVERSED', lineId: 'line-1', reversalOfEventId: 'event-1' };
  assert.equal(canReverseDispatchEvent(
    corrected,
    [{ id: 'line-1', sourceType: 'CUTTER' }],
    [corrected, reversal],
  ), false);
});

test('packed and unsupported events do not expose unsafe reverse actions', () => {
  assert.equal(canReverseDispatchEvent(
    { id: 'event-2', type: 'LINE_CORRECTED', lineId: 'line-2' },
    [{ id: 'line-2', sourceType: 'PACKED' }],
  ), false);
  assert.equal(canReverseDispatchEvent(
    { id: 'event-3', type: 'CHALLAN_CREATED', lineId: 'line-1' },
    [{ id: 'line-1', sourceType: 'CUTTER' }],
  ), false);
});

test('direct reversal lineage remains excluded even without the full event list', () => {
  assert.equal(canReverseDispatchEvent(
    { id: 'event-4', type: 'LINE_RETURNED', lineId: 'line-1', reversalOfEventId: 'event-0' },
    [{ id: 'line-1', sourceType: 'CUTTER' }],
  ), false);
});

test('partial-return challans keep controls on remaining lines and terminal returns expose diagnostic controls', () => {
  const partial = { status: 'PARTIALLY_RETURNED' };
  assert.equal(canShowChallanMutationActions(partial, { canWrite: true, line: { events: [{ type: 'LINE_RETURNED' }] } }), false);
  assert.equal(canShowChallanMutationActions(partial, { canWrite: true, line: { events: [] } }), true);
  assert.equal(canShowChallanMutationActions({ status: 'RETURNED' }, { canWrite: true, line: { sourceType: 'PACKED', events: [{ type: 'LINE_RETURNED' }] } }), true);
  assert.equal(canShowChallanMutationActions({ status: 'RETURNED', isLegacyReconstruction: true }, { canWrite: true }), false);
});
