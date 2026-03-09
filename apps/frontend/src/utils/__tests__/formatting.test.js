import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getInclusiveUtcDayRange,
  parseDateOnlyUTC,
} from '../formatting.js';

test('parseDateOnlyUTC validates strict YYYY-MM-DD dates', () => {
  assert.equal(parseDateOnlyUTC(''), null);
  assert.equal(parseDateOnlyUTC('2026-02-30'), null);
  assert.equal(parseDateOnlyUTC('2026/03/09'), null);
  assert.ok(parseDateOnlyUTC('2026-03-09'));
});

test('getInclusiveUtcDayRange counts dates in UTC across DST boundaries', () => {
  assert.equal(getInclusiveUtcDayRange('2026-03-09', '2026-03-09'), 1);
  assert.equal(getInclusiveUtcDayRange('2026-03-02', '2026-03-08'), 7);
  assert.equal(getInclusiveUtcDayRange('2026-03-05', '2026-03-12'), 8);
  assert.equal(getInclusiveUtcDayRange('2026-03-12', '2026-03-05'), 0);
  assert.equal(getInclusiveUtcDayRange('bad', '2026-03-12'), 0);
});
