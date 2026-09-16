import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDb } from '../dataHelpers.js';

test('normalizeDb preserves holo other wastage categories from the bootstrap slices', () => {
  const category = { id: 'cat-1', name: 'Cutter', isActive: true };
  const normalized = normalizeDb({
    holo_other_wastage_items: [{ id: 'item-1', name: 'FIRKI SAFAI', categoryId: 'cat-1' }],
    holo_other_wastage_categories: [category],
  });

  assert.deepEqual(normalized.holo_other_wastage_categories, [category]);
  assert.deepEqual(normalized.holo_other_wastage_items, [{ id: 'item-1', name: 'FIRKI SAFAI', categoryId: 'cat-1' }]);
});

test('normalizeDb defaults holo other wastage categories to an empty array', () => {
  const normalized = normalizeDb({ holo_other_wastage_items: [] });

  assert.deepEqual(normalized.holo_other_wastage_categories, []);
});

test('normalizeDb keeps holo other wastage categories across repeated normalization', () => {
  const categories = [{ id: 'cat-1', name: 'Cutter', isActive: true }];
  const first = normalizeDb({ holo_other_wastage_categories: categories });
  const second = normalizeDb(first);

  assert.deepEqual(second.holo_other_wastage_categories, categories);
});
