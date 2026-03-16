import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHoloWeeklyExportData, validateHoloWeeklyExportRequest } from '../holoWeeklyExport.js';
import { createHoloWeeklyExportPdfDocument, generateHoloWeeklyExportPdf } from '../pdf/holoWeeklyExportPdf.js';

function createDbStub({
  items = [],
  machines = [],
  rateRows = [],
  metricRows = [],
  holoRows = [],
} = {}) {
  return {
    machine: {
      findMany: async () => machines,
    },
    holoProductionPerHour: {
      findMany: async () => rateRows,
    },
    holoDailyMetric: {
      findMany: async () => metricRows,
    },
    receiveFromHoloMachineRow: {
      findMany: async () => holoRows,
    },
    item: {
      findMany: async ({ where }) => {
        const ids = new Set(where?.id?.in || []);
        return items.filter((item) => ids.has(item.id));
      },
    },
  };
}

function getDocumentText(doc) {
  return doc.internal.pages
    .slice(1)
    .flatMap((page) => (Array.isArray(page) ? page : [String(page)]))
    .join('\n');
}

test('validateHoloWeeklyExportRequest rejects non-holo or invalid date ranges', () => {
  assert.equal(validateHoloWeeklyExportRequest({ process: 'cutter', from: '2026-03-10', to: '2026-03-12' }).ok, false);
  assert.equal(validateHoloWeeklyExportRequest({ process: 'holo', from: 'bad', to: '2026-03-12' }).ok, false);
  assert.equal(validateHoloWeeklyExportRequest({ process: 'holo', from: '2026-03-13', to: '2026-03-12' }).ok, false);
  assert.equal(validateHoloWeeklyExportRequest({ process: 'holo', from: '2026-03-10', to: '2026-03-12' }).ok, true);
});

test('buildHoloWeeklyExportData computes totals, hours, warnings, and legacy distinct-rate averaging', async () => {
  const db = createDbStub({
    items: [{ id: 'item-1', name: 'Item A' }],
    machines: [
      { id: 'm1a1', name: 'H1-A1', processType: 'holo', spindle: 60 },
      { id: 'm1a2', name: 'H1-A2', processType: 'holo', spindle: 60 },
      { id: 'm2a1', name: 'H2-A1', processType: 'holo', spindle: 50 },
    ],
    rateRows: [
      {
        id: 'rate-exact',
        yarn: { id: 'y-1', name: 'Yarn A' },
        cut: { id: 'c-1', name: 'Cut A' },
        cutMatcher: 'c-1',
        productionPerHourKg: 0.005,
      },
      {
        id: 'rate-any',
        yarn: { id: 'y-2', name: 'Yarn B' },
        cut: null,
        cutMatcher: 'ANY',
        productionPerHourKg: 0.004,
      },
    ],
    metricRows: [
      { id: 'metric-1', date: '2026-03-10', baseMachine: 'H1', hours: 13, wastage: 1.2 },
      { id: 'metric-2', date: '2026-03-11', baseMachine: 'H1', hours: 10, wastage: 0.8 },
      { id: 'metric-3', date: '2026-03-10', baseMachine: 'H2', hours: 8, wastage: 0.1 },
    ],
    holoRows: [
      {
        date: '2026-03-10',
        grossWeight: 12,
        tareWeight: 2,
        rollWeight: 10,
        rollCount: 4,
        machineNo: '',
        box: { name: 'Crate 1' },
        rollType: { name: 'Roll 1' },
        operator: { name: 'Operator 1' },
        issue: {
          id: 'issue-1',
          itemId: 'item-1',
          machine: { name: 'H1-A1' },
          cut: { name: 'Cut A' },
          yarn: { name: 'Yarn A' },
          twist: null,
          receivedRowRefs: [],
        },
      },
      {
        date: '2026-03-11',
        grossWeight: 8,
        tareWeight: 2,
        rollWeight: 6,
        rollCount: 3,
        machineNo: '',
        box: { name: 'Crate 2' },
        rollType: { name: 'Roll 2' },
        operator: { name: 'Operator 2' },
        issue: {
          id: 'issue-2',
          itemId: 'item-1',
          machine: { name: 'H1-A2' },
          cut: null,
          yarn: { name: 'Yarn B' },
          twist: null,
          receivedRowRefs: [],
        },
      },
    ],
  });

  const data = await buildHoloWeeklyExportData({ from: '2026-03-10', to: '2026-03-11', db });
  const h1 = data.rows.find((row) => row.baseMachine === 'H1');
  const h2 = data.rows.find((row) => row.baseMachine === 'H2');

  assert.equal(h1.totalProduction, 16);
  assert.equal(h1.totalHours, 23);
  assert.equal(h1.dailyHours, 24);
  assert.equal(h1.dayCount, 0.958);
  assert.equal(h1.averageProductionDisplay, 16.696);
  assert.equal(h1.idealProduction, 12.96);
  assert.equal(h1.difference, 3.736);

  assert.equal(h2.totalProduction, 0);
  assert.equal(h2.totalHours, 8);
  assert.equal(h2.dailyHours, 12);
  assert.equal(h2.dayCount, 0.667);
  assert.equal(h2.averageProductionDisplay, 0);
  assert.equal(h2.idealProduction, 0);
  assert.equal(h2.difference, 0);

  assert.deepEqual(data.warnings, [
    { date: '2026-03-11', machines: ['H2'] },
  ]);
});

test('buildHoloWeeklyExportData blocks when spindle is missing', async () => {
  const db = createDbStub({
    machines: [{ id: 'm1a1', name: 'H1-A1', processType: 'holo', spindle: null }],
    rateRows: [],
    metricRows: [],
    holoRows: [],
  });

  await assert.rejects(
    () => buildHoloWeeklyExportData({ from: '2026-03-10', to: '2026-03-10', db }),
    (err) => err?.details?.error === 'missing_spindle'
  );
});

test('buildHoloWeeklyExportData ignores shared all-process machines for holo weekly rows and mapping checks', async () => {
  const db = createDbStub({
    items: [{ id: 'item-1', name: 'Item A' }],
    machines: [
      { id: 'm1a1', name: 'H1-A1', processType: 'holo', spindle: 60 },
      { id: 'x1a1', name: 'X1-A1', processType: 'all', spindle: null },
    ],
    rateRows: [{
      id: 'rate-1',
      yarn: { id: 'y-1', name: 'Yarn A' },
      cut: { id: 'c-1', name: 'Cut A' },
      cutMatcher: 'c-1',
      productionPerHourKg: 0.005,
    }],
    metricRows: [{ id: 'metric-1', date: '2026-03-10', baseMachine: 'H1', hours: 12, wastage: 0.4 }],
    holoRows: [
      {
        date: '2026-03-10',
        grossWeight: 9,
        tareWeight: 1,
        rollWeight: 8,
        rollCount: 2,
        machineNo: '',
        box: { name: 'Crate 1' },
        rollType: { name: 'Roll 1' },
        operator: { name: 'Operator 1' },
        issue: {
          id: 'issue-1',
          itemId: 'item-1',
          machine: { name: 'H1-A1' },
          cut: { name: 'Cut A' },
          yarn: { name: 'Yarn A' },
          twist: null,
          receivedRowRefs: [],
        },
      },
      {
        date: '2026-03-10',
        grossWeight: 7,
        tareWeight: 1,
        rollWeight: 6,
        rollCount: 2,
        machineNo: '',
        box: { name: 'Crate 2' },
        rollType: { name: 'Roll 2' },
        operator: { name: 'Operator 2' },
        issue: {
          id: 'issue-2',
          itemId: 'item-1',
          machine: { name: 'X1-A1' },
          cut: { name: 'Cut Missing' },
          yarn: { name: 'Yarn Missing' },
          twist: null,
          receivedRowRefs: [],
        },
      },
    ],
  });

  const data = await buildHoloWeeklyExportData({ from: '2026-03-10', to: '2026-03-10', db });
  assert.deepEqual(data.rows.map((row) => row.baseMachine), ['H1']);
  assert.equal(data.rows[0].totalProduction, 8);
});

test('buildHoloWeeklyExportData blocks when production per hour mapping is missing', async () => {
  const db = createDbStub({
    items: [{ id: 'item-1', name: 'Item A' }],
    machines: [{ id: 'm1a1', name: 'H1-A1', processType: 'holo', spindle: 60 }],
    rateRows: [],
    metricRows: [],
    holoRows: [{
      date: '2026-03-10',
      grossWeight: 10,
      tareWeight: 2,
      rollWeight: 8,
      rollCount: 2,
      machineNo: '',
      box: { name: 'Crate 1' },
      rollType: { name: 'Roll 1' },
      operator: { name: 'Operator 1' },
      issue: {
        id: 'issue-1',
        itemId: 'item-1',
        machine: { name: 'H1-A1' },
        cut: { name: 'Cut Z' },
        yarn: { name: 'Yarn Z' },
        twist: null,
        receivedRowRefs: [],
      },
    }],
  });

  await assert.rejects(
    () => buildHoloWeeklyExportData({ from: '2026-03-10', to: '2026-03-10', db }),
    (err) => err?.details?.error === 'missing_production_per_hour'
  );
});

test('buildHoloWeeklyExportData renders zero-hour machines with #DIV/0! and negative difference based on zero average', async () => {
  const db = createDbStub({
    items: [{ id: 'item-1', name: 'Item A' }],
    machines: [{ id: 'm1a1', name: 'H1-A1', processType: 'holo', spindle: 100 }],
    rateRows: [{
      id: 'rate-1',
      yarn: { id: 'y-1', name: 'Yarn A' },
      cut: { id: 'c-1', name: 'Cut A' },
      cutMatcher: 'c-1',
      productionPerHourKg: 0.2,
    }],
    metricRows: [],
    holoRows: [{
      date: '2026-03-10',
      grossWeight: 7,
      tareWeight: 1,
      rollWeight: 6,
      rollCount: 2,
      machineNo: '',
      box: { name: 'Crate 1' },
      rollType: { name: 'Roll 1' },
      operator: { name: 'Operator 1' },
      issue: {
        id: 'issue-1',
        itemId: 'item-1',
        machine: { name: 'H1-A1' },
        cut: { name: 'Cut A' },
        yarn: { name: 'Yarn A' },
        twist: null,
        receivedRowRefs: [],
      },
    }],
  });

  const data = await buildHoloWeeklyExportData({ from: '2026-03-10', to: '2026-03-10', db });
  const row = data.rows[0];
  assert.equal(row.averageProductionDisplay, '#DIV/0!');
  assert.equal(row.dailyHours, 12);
  assert.equal(row.idealProduction, 240);
  assert.equal(row.difference, -240);
  assert.equal(row.highlightShortfall, true);
});

test('createHoloWeeklyExportPdfDocument renders warnings and weekly columns', async () => {
  const doc = await createHoloWeeklyExportPdfDocument({
    from: '2026-03-10',
    to: '2026-03-11',
    warnings: [{ date: '2026-03-11', machines: ['H2', 'H3'] }],
    rows: [{
      baseMachine: 'H1',
      totalProduction: 16,
      totalHours: 23,
      dayCount: 0.958,
      averageProductionDisplay: 16.701,
      dailyHours: 24,
      idealProduction: 10.8,
      difference: 5.901,
      highlightShortfall: false,
    }],
  });
  const buffer = await generateHoloWeeklyExportPdf({
    from: '2026-03-10',
    to: '2026-03-11',
    warnings: [{ date: '2026-03-11', machines: ['H2', 'H3'] }],
    rows: [{
      baseMachine: 'H1',
      totalProduction: 16,
      totalHours: 23,
      dayCount: 0.958,
      averageProductionDisplay: 16.701,
      dailyHours: 24,
      idealProduction: 10.8,
      difference: 5.901,
      highlightShortfall: false,
    }],
  });
  const text = getDocumentText(doc);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.match(text, /Holo Weekly Production Sheet/);
  assert.match(text, /Missing daily metrics were treated as 0/);
  assert.match(text, /Total Production/);
  assert.match(text, /Average Production/);
  assert.match(text, /Ideal Production/);
  assert.match(text, /Difference/);
  assert.match(text, /H1/);
});
