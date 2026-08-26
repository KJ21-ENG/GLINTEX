import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePackingUnitVariance, decimalUnitWeightKg } from '../varianceMath.js';

test('unit variance uses exact decimal nominal grams before rounding', () => {
  assert.equal(decimalUnitWeightKg('125.5', 20), 2.51);
  assert.deepEqual(
    calculatePackingUnitVariance({ nominalGram: '125.5', baseCount: 20, netWeightKg: '2.510', warningVariancePercent: '2', approvalVariancePercent: '5' }),
    { expectedBaseCount: 20, expectedNetWeightKg: 2.51, actualBaseCount: 20, actualNetWeightKg: 2.51, varianceNetWeightKg: 0, variancePercent: 0, varianceSeverity: 'NORMAL' },
  );
});
