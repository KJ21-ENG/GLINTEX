import assert from 'node:assert/strict';
import test from 'node:test';

import { readLearningCandidates, readOwnerTasks, readProductionSummary } from '../readService.js';

function fakeDatabase({ cutter = [], holo = [], coning = [] } = {}) {
  return {
    receiveFromCutterMachineRow: { findMany: async () => cutter },
    receiveFromHoloMachineRow: { findMany: async () => holo },
    receiveFromConingMachineRow: { findMany: async () => coning },
  };
}

test('production summary applies documented quantity and weight precedence', async () => {
  const result = await readProductionSummary(fakeDatabase({
    cutter: [{ date: '2026-08-10', bobbinQuantity: 4, netWt: 8.125, totalKg: 99 }],
    holo: [{ date: '2026-08-10', rollCount: 3, rollWeight: null, grossWeight: 10, tareWeight: 1.25 }],
    coning: [{ date: '2026-08-10', coneCount: 20, netWeight: null, coneWeight: 7.5555, grossWeight: 99, tareWeight: 1 }],
  }), { dateFrom: '2026-08-10', dateTo: '2026-08-10', process: 'all' });

  assert.deepEqual(result.processes.cutter, [{ date: '2026-08-10', records: 1, quantity: 4, netKg: 8.125 }]);
  assert.deepEqual(result.processes.holo, [{ date: '2026-08-10', records: 1, quantity: 3, netKg: 8.75 }]);
  assert.deepEqual(result.processes.coning, [{ date: '2026-08-10', records: 1, quantity: 20, netKg: 7.556 }]);
  assert.deepEqual(result.rowLimitReached, []);
});

test('production summary rejects ranges longer than 93 days', async () => {
  await assert.rejects(
    readProductionSummary(fakeDatabase(), { dateFrom: '2026-01-01', dateTo: '2026-08-10' }),
    error => error.code === 'validation_error' && error.status === 400,
  );
});

test('production summary reports when its bounded row cap is reached', async () => {
  const rows = Array.from({ length: 20_000 }, () => ({
    date: '2026-08-10',
    bobbinQuantity: 1,
    netWt: 1,
    totalKg: 1,
  }));
  const result = await readProductionSummary(fakeDatabase({ cutter: rows }), {
    dateFrom: '2026-08-10',
    dateTo: '2026-08-10',
    process: 'cutter',
  });

  assert.deepEqual(result.rowLimitReached, ['cutter']);
  assert.equal(result.processes.cutter[0].records, 20_000);
});

test('task and learning reads reject unsupported controlled filters before querying', async () => {
  await assert.rejects(
    readOwnerTasks({}, { status: 'almost_done' }),
    error => error.code === 'validation_error' && error.status === 400,
  );
  await assert.rejects(
    readLearningCandidates({}, { category: 'SELF_MODIFICATION' }),
    error => error.code === 'validation_error' && error.status === 400,
  );
});
