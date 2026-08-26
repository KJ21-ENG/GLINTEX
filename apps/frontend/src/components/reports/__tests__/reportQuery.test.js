import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPackingReportQuery, mergePackingReportFilters } from '../reportQuery.js';

test('production refresh query carries both dates selected in the visible controls', () => {
  const afterFrom = mergePackingReportFilters({}, { dateFrom: '2026-08-01' });
  const afterBoth = mergePackingReportFilters(afterFrom, { dateTo: '2026-08-23' });
  assert.deepEqual(buildPackingReportQuery(afterBoth, 'production'), {
    limit: 100,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-23',
  });
});

test('optional date bounds remain absent until selected', () => {
  assert.deepEqual(buildPackingReportQuery(mergePackingReportFilters({}, { dateFrom: '2026-08-01' }), 'production'), {
    limit: 100,
    dateFrom: '2026-08-01',
  });
  assert.deepEqual(buildPackingReportQuery(mergePackingReportFilters({}, { dateFrom: '', dateTo: '' }), 'production'), { limit: 100 });
});

test('report query keeps status and reconciliation kind scoped to their supported tabs', () => {
  assert.deepEqual(buildPackingReportQuery({ status: 'COMPLETED', kind: 'MANUAL_CORRECTION' }, 'production'), { limit: 100 });
  assert.deepEqual(buildPackingReportQuery({ status: 'APPLIED', kind: 'MANUAL_CORRECTION' }, 'reconciliation'), {
    limit: 100,
    status: 'APPLIED',
    kind: 'MANUAL_CORRECTION',
  });
});
