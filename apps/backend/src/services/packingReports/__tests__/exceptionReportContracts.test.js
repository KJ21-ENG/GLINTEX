import assert from 'node:assert/strict';
import test from 'node:test';
import { EXCEPTION_EVENT_TYPES, getPackingExceptionsReport, serializeVarianceEvent } from '../index.js';

function fakeClient({ packedEvents = [], qualityHoldUnits = [], dispatchEvents = [] } = {}) {
  return {
    packedUnitEvent: {
      findMany: async () => packedEvents,
    },
    packedUnit: {
      findMany: async () => qualityHoldUnits,
    },
    dispatchEvent: {
      findMany: async () => dispatchEvents,
    },
  };
}

test('exceptions include sealed variance events and current quality-hold units', async () => {
  assert.equal(EXCEPTION_EVENT_TYPES.includes('UNIT_SEALED'), true);
  const report = await getPackingExceptionsReport({ limit: 100 }, fakeClient({
    packedEvents: [{
      id: 'sealed-1',
      type: 'UNIT_SEALED',
      createdAt: new Date('2026-08-23T10:00:00Z'),
      reason: null,
      payload: { plannedNetWeightKg: 1, actualNetWeightKg: 1.25, variancePercent: 25 },
      unit: {
        id: 'unit-1',
        barcode: 'PK-1',
        status: 'AVAILABLE',
        baseCount: 1,
        netWeightKg: 1.25,
        customer: { name: 'Acme' },
        packageType: { kind: 'STOCK' },
        item: { name: 'Yarn' },
        batch: {
          id: 'batch-1',
          batchNo: 'B-1',
          plannedBaseCount: 1,
          plannedNetWeightKg: 1,
          recipe: { warningVariancePercent: 2, approvalVariancePercent: 5 },
        },
      },
    }],
    qualityHoldUnits: [{
      id: 'unit-hold-1',
      barcode: 'PK-HOLD-1',
      status: 'QUALITY_HOLD',
      createdAt: new Date('2026-08-23T09:00:00Z'),
      updatedAt: new Date('2026-08-23T09:30:00Z'),
      batch: { id: 'batch-2', batchNo: 'B-2' },
      customer: { name: 'Acme' },
    }],
  }));

  assert.deepEqual(report.report.rows.map((row) => row.type).sort(), ['QUALITY_HOLD', 'UNIT_SEALED']);
  const variance = report.report.rows.find((row) => row.type === 'UNIT_SEALED');
  assert.equal(variance.severity, 'APPROVAL_REQUIRED');
  assert.equal(variance.variancePercent, 25);
  assert.equal(report.report.rows.find((row) => row.type === 'QUALITY_HOLD').unitStatus, 'QUALITY_HOLD');
});

test('variance reports derive per-unit planned weight and recompute stale event percentages', () => {
  const row = serializeVarianceEvent({
    id: 'sealed-hierarchy-child',
    type: 'UNIT_SEALED',
    payload: { plannedNetWeightKg: 5.02, actualNetWeightKg: 1.255, variancePercent: 75 },
    unit: {
      id: 'unit-child',
      baseCount: 10,
      netWeightKg: 1.255,
      nominalGram: '125.5',
      batch: { id: 'batch-1', batchNo: 'B-1', plannedBaseCount: 40, plannedNetWeightKg: 5.02, recipe: { warningVariancePercent: 2, approvalVariancePercent: 5 } },
    },
  });
  assert.equal(row.plannedBaseCount, 10);
  assert.equal(row.plannedNetWeightKg, 1.255);
  assert.equal(row.varianceNetWeightKg, 0);
  assert.equal(row.variancePercent, 0);
  assert.equal(row.severity, 'NORMAL');

  const equalLegacyRow = serializeVarianceEvent({
    id: 'sealed-equal',
    type: 'UNIT_SEALED',
    payload: { plannedNetWeightKg: 13.6, actualNetWeightKg: 13.6, variancePercent: 9900 },
    unit: { id: 'unit-equal', baseCount: null, netWeightKg: 13.6, nominalGram: null, batch: { plannedNetWeightKg: 13.6, recipe: {} } },
  });
  assert.equal(equalLegacyRow.variancePercent, 0);
  assert.equal(equalLegacyRow.severity, 'NORMAL');
});
