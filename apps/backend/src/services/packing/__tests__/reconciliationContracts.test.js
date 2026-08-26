import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReversalBoundary, calculateAdjustmentPreviewBalance } from '../reconciliationService.js';

test('an applied original adjustment can be reversed once', () => {
  assert.doesNotThrow(() => assertReversalBoundary({ id: 'IAB-original', status: 'APPLIED', evidenceSnapshot: {} }));
});

test('an applied append-only reversal cannot be reversed again', () => {
  assert.throws(
    () => assertReversalBoundary({
      id: 'IAB-reversal',
      status: 'APPLIED',
      evidenceSnapshot: { reversalOfBatchId: 'IAB-original' },
    }),
    (error) => error?.code === 'adjustment_reversal_not_allowed'
      && error?.details?.reversalOfBatchId === 'IAB-original',
  );
});

test('adjustment previews add numeric Decimal values instead of concatenating strings', () => {
  assert.deepEqual(
    calculateAdjustmentPreviewBalance({ count: '70', weight: '17.25', countDelta: 1, weightDeltaKg: 0.1 }),
    { before: { count: 70, weight: 17.25 }, after: { count: 71, weight: 17.35 } },
  );
});
