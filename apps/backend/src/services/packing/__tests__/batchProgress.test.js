import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCompletePackingHierarchy } from '../batchService.js';

const recipe = {
  stockUnitLevelIndex: 1,
  levels: [{ levelIndex: 1 }, { levelIndex: 2 }, { levelIndex: 3 }],
};

test('a multi-level batch cannot complete while a higher-level parent is still open', () => {
  const batch = {
    recipe,
    units: [
      { levelIndex: 1, status: 'AVAILABLE' },
      { levelIndex: 2, status: 'IN_PROGRESS' },
      { levelIndex: 3, status: 'AVAILABLE' },
    ],
  };
  assert.equal(hasCompletePackingHierarchy(batch), false);
  assert.equal(hasCompletePackingHierarchy({
    ...batch,
    units: batch.units.map((unit) => unit.levelIndex === 2 ? { ...unit, status: 'AVAILABLE' } : unit),
  }), true);
});

test('a stock-only recipe keeps the existing completion rule', () => {
  assert.equal(hasCompletePackingHierarchy({ recipe: { stockUnitLevelIndex: 1, levels: [{ levelIndex: 1 }] }, units: [] }), true);
});
