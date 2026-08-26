import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRepackingSourceTransition } from '../repackingService.js';

test('repacking source transition retires the source with durable batch lineage', () => {
  assert.deepEqual(
    buildRepackingSourceTransition({ id: 'unit-1', batchId: 'source-batch-1', status: 'DAMAGED' }, { repackingBatchId: 'repacking-batch-1', reason: 'Repack damaged return' }),
    {
      beforeStatus: 'DAMAGED',
      afterStatus: 'REPACKED',
      payload: { sourceBatchId: 'source-batch-1', sourceStatus: 'DAMAGED', repackingBatchId: 'repacking-batch-1' },
      reason: 'Repack damaged return',
    },
  );
});
