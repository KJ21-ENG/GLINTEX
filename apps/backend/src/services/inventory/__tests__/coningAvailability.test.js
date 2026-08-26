import assert from 'node:assert/strict';
import test from 'node:test';
import { getConingAvailabilityBatch } from '../coningBalance.js';

test('batch Coning availability loads shared consumption sources once for a lot view', async () => {
  const calls = { receives: 0, items: 0, issues: 0, takebacks: 0, packing: 0, adjustments: 0 };
  const client = {
    receiveFromConingMachineRow: {
      findMany: async () => {
        calls.receives += 1;
        return [
          { id: 'source-1', barcode: 'RCO-1', coneCount: 10, netWeight: 2, dispatchedCount: 1, dispatchedWeight: 0.1, isDeleted: false, issue: { itemId: 'item-1' }, box: null },
          { id: 'source-2', barcode: 'RCO-2', coneCount: 8, netWeight: 1.6, dispatchedCount: 0, dispatchedWeight: 0, isDeleted: false, issue: { itemId: 'item-1' }, box: null },
        ];
      },
    },
    item: { findMany: async () => { calls.items += 1; return [{ id: 'item-1', name: 'Yarn' }]; } },
    $queryRaw: async () => { calls.issues += 1; return [{ receivedRowRefs: [{ rowId: 'source-1', issueRolls: 2, issueWeight: 0.4 }] }]; },
    issueTakeBackLine: {
      findMany: async () => { calls.takebacks += 1; return [{ sourceId: 'source-1', count: 1, weight: 0.2, takeBack: { isReverse: false } }]; },
    },
    packingBatchSource: {
      findMany: async () => { calls.packing += 1; return [{ sourceId: 'source-1', batch: { status: 'IN_PROGRESS' }, reservedBaseCount: 3, reservedNetWeightKg: 0.6, consumedBaseCount: 1, consumedNetWeightKg: 0.2, releasedBaseCount: 0, releasedNetWeightKg: 0 }]; },
    },
    inventoryAdjustmentLine: {
      findMany: async () => { calls.adjustments += 1; return [{ sourceId: 'source-1', countDelta: 1, weightDeltaKg: 0.1 }]; },
    },
  };

  const balances = await getConingAvailabilityBatch(client, ['source-2', 'source-1', 'source-1']);
  assert.equal(balances.get('source-1').available.count, 6);
  assert.equal(balances.get('source-1').available.weight, 1.2);
  assert.equal(balances.get('source-2').available.count, 8);
  assert.deepEqual(calls, { receives: 1, items: 1, issues: 1, takebacks: 1, packing: 1, adjustments: 1 });
});
