import assert from 'node:assert/strict';
import test from 'node:test';
import { getChallanHistorySummary } from '../dispatchHistorySummary.js';

test('history headers preserve migrated legacy line and weight totals before detail load', () => {
  assert.deepEqual(
    getChallanHistorySummary({ id: 'legacy:DC/25-26/004', lineCount: 610, totalNetWeightKg: '123.456' }),
    { lineCount: 610, totalWeight: 123.456 },
  );
});

test('loaded detail lines remain authoritative for an opened challan', () => {
  assert.deepEqual(
    getChallanHistorySummary({ lineCount: 99, totalNetWeightKg: 99, lines: [{ netWeightKg: '1.255' }, { netWeightKg: '2.345' }] }),
    { lineCount: 2, totalWeight: 3.6 },
  );
});
