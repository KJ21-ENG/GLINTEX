import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReceiveMachineContainsFilter,
  buildReceiveMachineInFilter,
  resolveDisplayedReceiveMachineName,
} from '../receiveHistoryFilters.js';

test('non-coning receive machine filters use the receive row machine number', () => {
  assert.deepEqual(buildReceiveMachineInFilter(['H1-A1'], { process: 'holo' }), {
    machineNo: { in: ['H1-A1'] },
  });
  assert.deepEqual(buildReceiveMachineContainsFilter('H1', { process: 'cutter' }), {
    machineNo: { contains: 'H1', mode: 'insensitive' },
  });
});

test('coning receive machine filters follow the displayed machine fallback', () => {
  assert.deepEqual(buildReceiveMachineInFilter(['Coning Machine'], { process: 'coning' }), {
    OR: [
      { machineNo: { in: ['Coning Machine'] } },
      {
        AND: [
          {
            OR: [
              { machineNo: null },
              { machineNo: '' },
            ],
          },
          { issue: { machine: { name: { in: ['Coning Machine'] } } } },
        ],
      },
    ],
  });
});

test('coning receive contains filters preserve explicit machine precedence', () => {
  assert.deepEqual(buildReceiveMachineContainsFilter('coning', { process: 'coning' }), {
    OR: [
      { machineNo: { contains: 'coning', mode: 'insensitive' } },
      {
        AND: [
          {
            OR: [
              { machineNo: null },
              { machineNo: '' },
            ],
          },
          { issue: { machine: { name: { contains: 'coning', mode: 'insensitive' } } } },
        ],
      },
    ],
  });
});

test('coning receive rows resolve their displayed machine in the initial API response', () => {
  assert.equal(resolveDisplayedReceiveMachineName({
    machineNo: null,
    issue: { machine: { name: 'Coning Machine' } },
  }, { process: 'coning' }), 'Coning Machine');

  assert.equal(resolveDisplayedReceiveMachineName({
    machineNo: 'PALTI-UTM',
    issue: { machine: { name: 'Coning Machine' } },
  }, { process: 'coning' }), 'PALTI-UTM');
});
