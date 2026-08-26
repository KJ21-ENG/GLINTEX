import assert from 'node:assert/strict';
import test from 'node:test';
import { getProcessStockViewAlignment } from '../stockViewRouting.js';

test('Packed Stock remains selected when the process changes or is non-cutter', () => {
  assert.deepEqual(getProcessStockViewAlignment('packed', 'coning'), { view: 'packed', clearUrl: false });
  assert.deepEqual(getProcessStockViewAlignment('packed', 'holo'), { view: 'packed', clearUrl: false });
});

test('process alignment still clears legacy view URLs for process-owned views', () => {
  assert.deepEqual(getProcessStockViewAlignment('jumbo', 'coning'), { view: 'jumbo', clearUrl: true });
  assert.deepEqual(getProcessStockViewAlignment('bobbins', 'holo'), { view: 'holo', clearUrl: true });
  assert.deepEqual(getProcessStockViewAlignment('combined', 'coning'), { view: 'combined', clearUrl: false });
});
