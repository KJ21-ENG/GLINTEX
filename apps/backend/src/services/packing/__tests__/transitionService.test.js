import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionBatch } from '../transitionService.js';

test('completed batches reject void and unspecified transitions without a replacement status', () => {
  for (const next of ['VOIDED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NOT_A_STATUS']) {
    assert.throws(
      () => transitionBatch('COMPLETED', next),
      (error) => error?.code === 'invalid_batch_transition' && error?.details?.current === 'COMPLETED' && error?.details?.next === next,
    );
  }
});

test('short-closed and voided batches remain terminal', () => {
  for (const current of ['SHORT_CLOSED', 'VOIDED']) {
    assert.throws(() => transitionBatch(current, 'IN_PROGRESS'), (error) => error?.code === 'invalid_batch_transition');
  }
});
