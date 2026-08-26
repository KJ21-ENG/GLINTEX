import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPackedStockQuery, packedStockFilterKey } from '../packedStockQuery.js';

test('Packed Stock query uses stable primitive filter values and preserves pagination', () => {
  const filters = { status: ['AVAILABLE', 'RESERVED'], customerId: 'customer-1', search: 'PKU-', batchKind: 'INITIAL' };
  assert.deepEqual(buildPackedStockQuery(filters, 50, 'cursor-1'), {
    status: 'AVAILABLE,RESERVED',
    customerId: 'customer-1',
    search: 'PKU-',
    batchKind: 'INITIAL',
    limit: 50,
    cursor: 'cursor-1',
  });
  assert.equal(packedStockFilterKey(filters), packedStockFilterKey({ ...filters, status: ['AVAILABLE', 'RESERVED'] }));
});

test('Packed Stock query omits an empty cursor on the first page', () => {
  assert.deepEqual(buildPackedStockQuery({ status: [], customerId: '', search: '', batchKind: '' }, 50), {
    status: '',
    customerId: '',
    search: '',
    batchKind: '',
    limit: 50,
  });
});
