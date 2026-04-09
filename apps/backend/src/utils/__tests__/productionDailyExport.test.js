import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PRODUCTION_DAILY_EXPORT_DAYS,
  enumerateDatesInclusive,
  getInclusiveDayCount,
  parseDateOnly,
  validateProductionDailyExportRequest,
} from '../productionDailyExport.js';
import {
  buildItemSummary,
  buildMachineSummary,
  buildYarnSummary,
  getMachineSummaryGroupLabel,
} from '../pdf/productionDailyExportSummary.js';
import { buildProductionDailyExportData } from '../pdf/productionDailyExportData.js';
import {
  createProductionDailyExportPdfDocument,
  generateProductionDailyExportPdf,
} from '../pdf/productionDailyExportPdf.js';

function createDbStub({
  items = [],
  inboundItems = [],
  lots = [],
  machines = [],
  holoDailyMetrics = [],
  holoOtherWastageItems = [],
  holoOtherWastageMetrics = [],
  cutterRows = [],
  holoRows = [],
  coningRows = [],
} = {}) {
  return {
    item: {
      findMany: async ({ where }) => {
        const ids = new Set(where?.id?.in || []);
        return items.filter((item) => ids.has(item.id));
      },
    },
    inboundItem: {
      findMany: async ({ where }) => {
        const ids = new Set(where?.id?.in || []);
        return inboundItems.filter((item) => ids.has(item.id));
      },
    },
    lot: {
      findMany: async ({ where }) => {
        const lotNos = new Set(where?.lotNo?.in || []);
        return lots.filter((lot) => lotNos.has(lot.lotNo));
      },
    },
    machine: {
      findMany: async ({ where } = {}) => {
        const allowed = new Set(where?.processType?.in || []);
        if (allowed.size === 0) return machines;
        return machines.filter((machine) => allowed.has(machine.processType));
      },
    },
    holoDailyMetric: {
      findMany: async ({ where } = {}) => {
        if (!where?.date) return holoDailyMetrics;
        return holoDailyMetrics.filter((row) => row.date === where.date);
      },
    },
    holoOtherWastageItem: {
      findMany: async () => holoOtherWastageItems,
    },
    holoOtherWastageMetric: {
      findMany: async ({ where } = {}) => {
        if (!where?.date) return holoOtherWastageMetrics;
        return holoOtherWastageMetrics.filter((row) => row.date === where.date);
      },
    },
    receiveFromCutterMachineRow: {
      findMany: async () => cutterRows,
    },
    receiveFromHoloMachineRow: {
      findMany: async () => holoRows,
    },
    receiveFromConingMachineRow: {
      findMany: async () => coningRows,
    },
  };
}

function getDocumentText(doc) {
  return doc.internal.pages
    .slice(1)
    .flatMap((page) => (Array.isArray(page) ? page : [String(page)]))
    .join('\n');
}

function getDocumentPageTexts(doc) {
  return doc.internal.pages
    .slice(1)
    .map((page) => (Array.isArray(page) ? page.join('\n') : String(page)));
}

test('parseDateOnly rejects malformed and impossible dates', () => {
  assert.equal(parseDateOnly(''), null);
  assert.equal(parseDateOnly('2026-02-30'), null);
  assert.equal(parseDateOnly('2026/03/09'), null);
  assert.ok(parseDateOnly('2026-03-09'));
});

test('enumerateDatesInclusive returns every day in range', () => {
  const fromDate = parseDateOnly('2026-03-09');
  const toDate = parseDateOnly('2026-03-11');
  assert.equal(getInclusiveDayCount(fromDate, toDate), 3);
  assert.deepEqual(enumerateDatesInclusive(fromDate, toDate), [
    '2026-03-09',
    '2026-03-10',
    '2026-03-11',
  ]);
});

test('validateProductionDailyExportRequest enforces process and range rules', () => {
  assert.equal(validateProductionDailyExportRequest({
    process: 'all',
    from: '2026-03-09',
    to: '2026-03-09',
  }).ok, false);

  assert.equal(validateProductionDailyExportRequest({
    process: 'cutter',
    from: '2026-03-10',
    to: '2026-03-09',
  }).ok, false);

  const tooWideTo = `2026-03-${String(9 + MAX_PRODUCTION_DAILY_EXPORT_DAYS).padStart(2, '0')}`;
  const tooWide = validateProductionDailyExportRequest({
    process: 'holo',
    from: '2026-03-09',
    to: tooWideTo,
  });
  assert.equal(tooWide.ok, false);
  assert.match(tooWide.error, /limited to/i);

  const valid = validateProductionDailyExportRequest({
    process: 'coning',
    from: '2026-03-09',
    to: '2026-03-12',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.totalDays, 4);

  const crossMonth = validateProductionDailyExportRequest({
    process: 'cutter',
    from: '2026-03-30',
    to: '2026-04-02',
  });
  assert.equal(crossMonth.ok, true);
  assert.equal(crossMonth.totalDays, 4);
});

test('buildMachineSummary groups machine totals by prefix and preserves detail labels', () => {
  const rows = [
    { machine: 'H1-A1', quantity: 4, net: 10.125 },
    { machine: 'H1-A2', quantity: 3, net: 11.25 },
    { machine: 'H1-B1', quantity: 2, net: 2.625 },
    { machine: 'PlainMachine', quantity: 5, net: 5 },
    { machine: '', quantity: 1, net: 1.5 },
  ];

  assert.equal(getMachineSummaryGroupLabel('H1-A1'), 'H1');
  assert.equal(getMachineSummaryGroupLabel('PlainMachine'), 'PlainMachine');
  assert.equal(getMachineSummaryGroupLabel(''), 'Unassigned');

  assert.deepEqual(buildMachineSummary(rows), [
    { machine: 'H1', totalQuantity: 9, totalNetProduction: 24 },
    { machine: 'PlainMachine', totalQuantity: 5, totalNetProduction: 5 },
    { machine: 'Unassigned', totalQuantity: 1, totalNetProduction: 1.5 },
  ]);

  assert.deepEqual(rows.map((row) => row.machine), [
    'H1-A1',
    'H1-A2',
    'H1-B1',
    'PlainMachine',
    '',
  ]);
});

test('buildItemSummary totals quantity and net by item label', () => {
  const rows = [
    { item: 'Item A', quantity: 4, net: 10.2 },
    { item: 'Item A', quantity: 3, net: 1.8 },
    { item: 'Item B', quantity: 2, net: 5.5 },
    { item: '', quantity: 1, net: 0.75 },
  ];

  assert.deepEqual(buildItemSummary(rows), [
    { item: 'Item A', totalQuantity: 7, totalNetProduction: 12 },
    { item: 'Item B', totalQuantity: 2, totalNetProduction: 5.5 },
    { item: 'Unassigned', totalQuantity: 1, totalNetProduction: 0.75 },
  ]);
});

test('buildYarnSummary totals quantity and net by yarn label', () => {
  const rows = [
    { yarn: 'Yarn A', quantity: 4, net: 10.2 },
    { yarn: 'Yarn A', quantity: 3, net: 1.8 },
    { yarn: 'Yarn B', quantity: 2, net: 5.5 },
    { yarn: '', quantity: 1, net: 0.75 },
  ];

  assert.deepEqual(buildYarnSummary(rows), [
    { yarn: 'Unassigned', totalQuantity: 1, totalNetProduction: 0.75 },
    { yarn: 'Yarn A', totalQuantity: 7, totalNetProduction: 12 },
    { yarn: 'Yarn B', totalQuantity: 2, totalNetProduction: 5.5 },
  ]);
});

test('buildProductionDailyExportData normalizes cutter rows with injected db and yarn/item-first sorting', async () => {
  const db = createDbStub({
    items: [
      { id: 'item-a', name: 'Item A' },
      { id: 'item-b', name: 'Item B' },
    ],
    inboundItems: [
      { id: 'piece-1', itemId: 'item-a', lotNo: 'LOT-1' },
    ],
    cutterRows: [
      {
        pieceId: 'piece-2',
        yarnName: 'Yarn B',
        itemName: 'Item B',
        cut: 'Cut 2',
        cutMaster: null,
        machineNo: 'H1-A2',
        issue: { itemId: 'item-b', lotNo: 'LOT-2', machine: { name: 'H1-A2' } },
        operator: { name: 'Worker 2' },
        employee: '',
        box: { name: 'Crate 2' },
        bobbin: { name: 'Roll B' },
        pktTypeName: '',
        pcsTypeName: '',
        bobbinQuantity: 3,
        grossWt: 9,
        tareWt: 0.75,
        netWt: 8.25,
      },
      {
        pieceId: 'piece-1',
        yarnName: 'Yarn A',
        itemName: '',
        cut: '',
        cutMaster: { name: 'Cut 1' },
        machineNo: 'H1-A1',
        issue: { itemId: 'item-a', lotNo: 'LOT-1', machine: { name: 'H1-A1' } },
        operator: null,
        employee: 'Worker 1',
        box: { name: 'Crate 1' },
        bobbin: { name: 'Roll A' },
        pktTypeName: '',
        pcsTypeName: '',
        bobbinQuantity: 4,
        grossWt: 12.5,
        tareWt: 1.25,
        netWt: 11.25,
      },
    ],
  });

  const data = await buildProductionDailyExportData({
    process: 'cutter',
    date: '2026-03-09',
    db,
  });

  assert.equal(data.rows[0].yarn, 'Yarn A');
  assert.equal(data.rows[0].item, 'Item A');
  assert.equal(data.rows[0].cut, 'Cut 1');
  assert.equal(data.rows[0].worker, 'Worker 1');
  assert.equal(data.rows[1].yarn, 'Yarn B');
  assert.deepEqual(data.machineSummary, [
    { machine: 'H1', totalQuantity: 7, totalNetProduction: 19.5 },
  ]);
  assert.deepEqual(data.itemSummary, [
    { item: 'Item A', totalQuantity: 4, totalNetProduction: 11.25 },
    { item: 'Item B', totalQuantity: 3, totalNetProduction: 8.25 },
  ]);
  assert.deepEqual(data.yarnSummary, [
    { yarn: 'Yarn A', totalQuantity: 4, totalNetProduction: 11.25 },
    { yarn: 'Yarn B', totalQuantity: 3, totalNetProduction: 8.25 },
  ]);
});

test('buildProductionDailyExportData normalizes holo rows using trace fallbacks', async () => {
  const db = createDbStub({
    items: [
      { id: 'item-holo', name: 'Item Holo' },
    ],
    machines: [
      { id: 'machine-1', name: 'H1-A1', processType: 'holo' },
      { id: 'machine-2', name: 'H1-A2', processType: 'holo' },
      { id: 'machine-3', name: 'H2-A1', processType: 'holo' },
    ],
    holoDailyMetrics: [
      { date: '2026-03-09', baseMachine: 'H1', hours: 12, wastage: 0.25 },
    ],
    holoOtherWastageItems: [
      { id: 'other-2', name: 'Core Waste' },
      { id: 'other-1', name: 'Packing Damage' },
    ],
    holoOtherWastageMetrics: [
      { date: '2026-03-09', otherWastageItemId: 'other-1', wastage: 0.75 },
    ],
    holoRows: [
      {
        grossWeight: 8,
        tareWeight: 1,
        rollWeight: null,
        rollCount: 2,
        machineNo: '',
        box: { name: 'Crate H' },
        rollType: { name: 'Roll H' },
        operator: { name: 'Worker H' },
        issue: {
          id: 'issue-holo-1',
          itemId: 'item-holo',
          machine: { name: 'H1-A1' },
          cut: null,
          yarn: null,
          twist: null,
          receivedRowRefs: '["row-1"]',
        },
      },
    ],
  });

  const data = await buildProductionDailyExportData({
    process: 'holo',
    date: '2026-03-09',
    db,
    helpers: {
      resolveHoloIssueDetails: async () => ({
        cutName: 'Trace Cut',
        yarnName: 'Trace Yarn',
      }),
    },
  });

  assert.equal(data.rows[0].yarn, 'Trace Yarn');
  assert.equal(data.rows[0].item, 'Item Holo');
  assert.equal(data.rows[0].cut, 'Trace Cut');
  assert.equal(data.rows[0].net, 7);
  assert.deepEqual(data.yarnSummary, [
    { yarn: 'Trace Yarn', totalQuantity: 2, totalNetProduction: 7 },
  ]);
  assert.deepEqual(data.machineSummary, [
    { machine: 'H1', totalQuantity: 2, totalNetProduction: 7 },
  ]);
  assert.deepEqual(data.holoHoursWastageSummary, [
    { machine: 'H1', hours: 12, wastage: 0.25 },
    { machine: 'H2', hours: 0, wastage: 0 },
  ]);
  assert.deepEqual(data.otherWastageSummary, [
    { item: 'Core Waste', wastage: 0 },
    { item: 'Packing Damage', wastage: 0.75 },
  ]);
});

test('buildProductionDailyExportData normalizes coning rows using trace fallbacks and unassigned item fallback', async () => {
  const db = createDbStub({
    coningRows: [
      {
        coneCount: 6,
        grossWeight: 13,
        tareWeight: 1,
        netWeight: 12,
        machineNo: '',
        box: { name: 'Crate C' },
        operator: { name: 'Worker C' },
        issue: {
          id: 'issue-cone-1',
          itemId: 'item-cone',
          machine: { name: 'H1-A3' },
          cut: null,
          yarn: { name: 'Direct Yarn' },
          twist: null,
          receivedRowRefs: '["row-2"]',
        },
      },
    ],
  });

  const data = await buildProductionDailyExportData({
    process: 'coning',
    date: '2026-03-09',
    db,
    helpers: {
      resolveConingTraceDetails: async () => ({
        cutName: 'Trace Cut',
        yarnName: 'Trace Yarn',
        rollTypeName: 'Trace Roll',
      }),
    },
  });

  assert.equal(data.rows[0].yarn, 'Trace Yarn');
  assert.equal(data.rows[0].item, 'Unassigned');
  assert.equal(data.rows[0].cut, 'Trace Cut');
  assert.equal(data.rows[0].rollType, 'Trace Roll');
  assert.deepEqual(data.yarnSummary, [
    { yarn: 'Trace Yarn', totalQuantity: 6, totalNetProduction: 12 },
  ]);
  assert.deepEqual(data.machineSummary, [
    { machine: 'H1', totalQuantity: 6, totalNetProduction: 12 },
  ]);
});

test('createProductionDailyExportPdfDocument renders yarn/item headers and all three summaries', async () => {
  const rows = [
    {
      yarn: 'Cotton 40s',
      item: 'Item A',
      cut: 'Cut 1',
      machine: 'H1-A1',
      worker: 'Worker 1',
      crates: 'Crate 1',
      rollType: 'Roll A',
      quantity: 4,
      gross: 12.5,
      tare: 1.25,
      net: 11.25,
    },
    {
      yarn: 'Cotton 40s',
      item: 'Item B',
      cut: 'Cut 2',
      machine: 'H1-A2',
      worker: 'Worker 2',
      crates: 'Crate 2',
      rollType: 'Roll B',
      quantity: 3,
      gross: 9,
      tare: 0.75,
      net: 8.25,
    },
  ];

  const doc = await createProductionDailyExportPdfDocument({
    process: 'cutter',
    processLabel: 'Cutter',
    date: '2026-03-09',
    rows,
    machineSummary: buildMachineSummary(rows),
    itemSummary: buildItemSummary(rows),
    yarnSummary: buildYarnSummary(rows),
    meta: {
      noData: false,
      rowCount: 2,
      totalQuantity: 7,
      totalGross: 21.5,
      totalTare: 2,
      totalNet: 19.5,
    },
  });

  const pdfBuffer = await generateProductionDailyExportPdf({
    process: 'cutter',
    processLabel: 'Cutter',
    date: '2026-03-09',
    rows,
    machineSummary: buildMachineSummary(rows),
    itemSummary: buildItemSummary(rows),
    yarnSummary: buildYarnSummary(rows),
    meta: {
      noData: false,
      rowCount: 2,
      totalQuantity: 7,
      totalGross: 21.5,
      totalTare: 2,
      totalNet: 19.5,
    },
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 0);

  const pdfText = getDocumentText(doc);
  assert.match(pdfText, /YARN/);
  assert.match(pdfText, /ITEM/);
  assert.match(pdfText, /Machine Summary/);
  assert.match(pdfText, /Item Summary/);
  assert.match(pdfText, /Yarn Summary/);
  assert.ok((pdfText.match(/QTY/g) || []).length >= 3);
  assert.doesNotMatch(pdfText, /OVERVIEW/);
  assert.doesNotMatch(pdfText, /Others/);
  assert.doesNotMatch(pdfText, /Production Details/);
  assert.match(pdfText, /H1-A1/);
  assert.match(pdfText, /H1-A2/);
  assert.match(pdfText, /H1/);
  assert.match(pdfText, /Cotton 40s/);
});

test('createProductionDailyExportPdfDocument renders Holo Hours & Wastage summary for holo exports', async () => {
  const rows = [
    {
      yarn: 'Trace Yarn',
      item: 'Item Holo',
      cut: 'Trace Cut',
      machine: 'H1-A1',
      worker: 'Worker H',
      crates: 'Crate H',
      rollType: 'Roll H',
      quantity: 2,
      gross: 8,
      tare: 1,
      net: 7,
    },
  ];

  const doc = await createProductionDailyExportPdfDocument({
    process: 'holo',
    processLabel: 'Holo',
    date: '2026-03-09',
    rows,
    machineSummary: buildMachineSummary(rows),
    itemSummary: buildItemSummary(rows),
    yarnSummary: buildYarnSummary(rows),
    holoHoursWastageSummary: [
      { machine: 'H1', hours: 12, wastage: 0.25 },
      { machine: 'H2', hours: 0, wastage: 0 },
    ],
    otherWastageSummary: [
      { item: 'Core Waste', wastage: 0.15 },
      { item: 'Packing Damage', wastage: 0.35 },
    ],
    meta: {
      noData: false,
      rowCount: 1,
      totalQuantity: 2,
      totalGross: 8,
      totalTare: 1,
      totalNet: 7,
    },
  });

  const pdfText = getDocumentText(doc);
  assert.match(pdfText, /Holo Hours & Wastage/);
  assert.match(pdfText, /HOURS/);
  assert.match(pdfText, /WASTAGE/);
  assert.match(pdfText, /H1/);
  assert.match(pdfText, /Others/);
  assert.match(pdfText, /Core Waste/);
  assert.match(pdfText, /Packing Damage/);
});

test('createProductionDailyExportPdfDocument renders empty-state exports', async () => {
  const doc = await createProductionDailyExportPdfDocument({
    process: 'cutter',
    processLabel: 'Cutter',
    date: '2026-03-09',
    rows: [],
    machineSummary: [],
    itemSummary: [],
    yarnSummary: [],
    meta: {
      noData: true,
      rowCount: 0,
      totalQuantity: 0,
      totalGross: 0,
      totalTare: 0,
      totalNet: 0,
    },
  });

  const pdfText = getDocumentText(doc);
  assert.match(pdfText, /No data available/);
  assert.match(pdfText, /selected date/);
});

test('createProductionDailyExportPdfDocument paginates large side-by-side summaries', async () => {
  const rows = [{
    yarn: 'Cotton 40s',
    item: 'Item A',
    cut: 'Cut 1',
    machine: 'H1-A1',
    worker: 'Worker 1',
    crates: 'Crate 1',
    rollType: 'Roll A',
    quantity: 4,
    gross: 12.5,
    tare: 1.25,
    net: 11.25,
  }];
  const machineSummary = Array.from({ length: 70 }, (_, index) => ({
    machine: `H${index + 1}`,
    totalQuantity: index + 1,
    totalNetProduction: index + 1,
  }));
  const itemSummary = Array.from({ length: 70 }, (_, index) => ({
    item: `Long Item Name ${index + 1} With Extra Text To Force Table Rendering`,
    totalQuantity: index + 1,
    totalNetProduction: index + 1.5,
  }));
  const yarnSummary = Array.from({ length: 70 }, (_, index) => ({
    yarn: `Long Yarn Name ${index + 1} With Extra Text To Force Table Rendering`,
    totalQuantity: index + 1,
    totalNetProduction: index + 1.25,
  }));

  const doc = await createProductionDailyExportPdfDocument({
    process: 'cutter',
    processLabel: 'Cutter',
    date: '2026-03-09',
    rows,
    machineSummary,
    itemSummary,
    yarnSummary,
    meta: {
      noData: false,
      rowCount: 1,
      totalQuantity: 4,
      totalGross: 12.5,
      totalTare: 1.25,
      totalNet: 11.25,
    },
  });

  const pageTexts = getDocumentPageTexts(doc);
  const machineSummaryTitleOccurrences = pageTexts.filter((page) => page.includes('Machine Summary')).length;
  const yarnSummaryTitleOccurrences = pageTexts.filter((page) => page.includes('Yarn Summary')).length;

  assert.ok(doc.getNumberOfPages() >= 2);
  assert.ok(machineSummaryTitleOccurrences >= 2);
  assert.ok(yarnSummaryTitleOccurrences >= 2);
});
