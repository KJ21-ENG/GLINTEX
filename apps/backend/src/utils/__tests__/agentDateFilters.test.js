import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentDateFilterMetadata,
  buildRecordDateWhere,
  formatAgentRecordDate,
  normalizeAgentDateBasis,
} from '../agentDateFilters.js';

test('record-date ranges cover the full Asia/Kolkata calendar day', () => {
  const where = buildRecordDateWhere({ dateFrom: '2026-08-15', dateTo: '2026-08-15' });

  assert.equal(where.createdAt.gte.toISOString(), '2026-08-14T18:30:00.000Z');
  assert.equal(where.createdAt.lt.toISOString(), '2026-08-15T18:30:00.000Z');
});

test('record dates expose the operator-facing local calendar date', () => {
  assert.equal(formatAgentRecordDate('2026-08-15T05:54:00.000Z'), '2026-08-15');
  assert.equal(formatAgentRecordDate('2026-08-14T18:29:59.999Z'), '2026-08-14');
  assert.equal(formatAgentRecordDate('not-a-date'), null);
});

test('date basis metadata distinguishes stored business dates from record timestamps', () => {
  assert.equal(normalizeAgentDateBasis(undefined), 'business');
  assert.equal(normalizeAgentDateBasis('record'), 'record');
  assert.equal(normalizeAgentDateBasis('unknown'), null);
  assert.deepEqual(buildAgentDateFilterMetadata({
    dateFrom: '2026-08-15',
    dateTo: '2026-08-15',
    dateBasis: 'record',
  }), {
    basis: 'record',
    field: 'createdAt',
    timeZone: 'Asia/Kolkata',
    dateFrom: '2026-08-15',
    dateTo: '2026-08-15',
  });
});
