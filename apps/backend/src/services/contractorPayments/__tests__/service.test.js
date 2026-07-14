import test from 'node:test';
import assert from 'node:assert/strict';

import { computePayablePreview, resolveRow, resolveConeTypeId, recomputeSettlementTotals, diffSettlementProduction } from '../service.js';
import { generateContractorSettlementPdf, groupLines } from '../../../utils/pdf/contractorSettlementPdf.js';

// Minimal Prisma stub — computePayablePreview only reads (findMany) and does no
// writes, so a plain in-memory stub is sufficient (no DB required).
function makeStub({
  assignments = [], rates = [],
  cutterRows = [], holoRows = [], coningRows = [],
  items = [], yarns = [], cuts = [], twists = [], coneTypes = [],
  claimedLines = [], holoIssues = [], coningIssues = [],
} = {}) {
  const rowsForDate = (rows, args = {}) => {
    const date = args.where?.OR?.find((condition) => condition.date !== undefined)?.date;
    if (!date) return rows;
    const matches = (value) => typeof date === 'string'
      ? value === date
      : value >= date.gte && value <= date.lte;
    return rows.filter((row) => matches(row.date || row.issue?.date));
  };
  return {
    contractorAssignment: { findMany: async () => assignments },
    contractorRate: { findMany: async () => rates },
    receiveFromCutterMachineRow: { findMany: async (args) => rowsForDate(cutterRows, args) },
    receiveFromHoloMachineRow: { findMany: async (args) => rowsForDate(holoRows, args) },
    receiveFromConingMachineRow: { findMany: async (args) => rowsForDate(coningRows, args) },
    issueToHoloMachine: { findMany: async () => holoIssues },
    issueToConingMachine: { findMany: async () => coningIssues },
    item: { findMany: async () => items },
    yarn: { findMany: async () => yarns },
    cut: { findMany: async () => cuts },
    twist: { findMany: async () => twists },
    coneType: { findMany: async () => coneTypes },
    contractorSettlementLine: { findMany: async () => claimedLines },
  };
}

const MASTERS = {
  items: [{ id: 'I1', name: 'S/S 40', side: 'SINGLE' }, { id: 'I2', name: 'Plain', side: 'UNKNOWN' }],
  yarns: [{ id: 'Y1', name: '40s' }],
  cuts: [{ id: 'C1', name: '40' }],
  twists: [{ id: 'T1', name: 'TW' }],
  coneTypes: [{ id: 'CT1', name: 'Big' }],
};

function coningRow(over = {}) {
  return {
    id: over.id || 'r1',
    date: over.date || '2026-03-05',
    netWeight: over.netWeight ?? 10,
    coneWeight: over.coneWeight,
    grossWeight: over.grossWeight,
    tareWeight: over.tareWeight,
    isDeleted: false,
    createdBy: over.createdBy || 'manual',
    barcode: over.barcode || 'B1',
    issue: {
      id: 'i1', date: '2026-03-05', lotNo: over.lotNo || 'L1',
      yarnId: over.yarnId ?? 'Y1', cutId: over.cutId ?? 'C1', twistId: over.twistId ?? 'T1',
      itemId: over.itemId ?? 'I1',
      receivedRowRefs: over.receivedRowRefs ?? [{ coneTypeId: 'CT1' }],
    },
  };
}

const CONING_ASSIGN = [{ id: 'a1', contractorId: 'K', process: 'coning' }];
const CONING_RATE_BASE = { id: 'rateBase', process: 'coning', yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: null, coneTypeId: null, ratePerKg: 8 };

async function preview(stub, extra = {}) {
  return computePayablePreview(stub, { contractorId: 'K', process: 'coning', date: '2026-03-05', ...extra });
}

test('resolveConeTypeId parses array and JSON-string refs', () => {
  assert.equal(resolveConeTypeId({ receivedRowRefs: [{ coneTypeId: 'CT1' }] }), 'CT1');
  assert.equal(resolveConeTypeId({ receivedRowRefs: '[{"coneTypeId":"CT2"}]' }), 'CT2');
  assert.equal(resolveConeTypeId({ receivedRowRefs: [] }), null);
  assert.equal(resolveConeTypeId({ receivedRowRefs: 'not json' }), null);
});

test('eligible coning row produces a payable line at the matched rate', async () => {
  const stub = makeStub({ ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE], coningRows: [coningRow()] });
  const res = await preview(stub);
  assert.equal(res.blockers.length, 0);
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].ratePerKg, 8);
  assert.equal(res.lines[0].netKg, 10);
  assert.equal(res.lines[0].amount, 80);
  assert.equal(res.lines[0].side, 'SINGLE');
  assert.equal(res.productionAmount, 80);
});

test('range preview includes payable rows from both boundary dates', async () => {
  const stub = makeStub({
    ...MASTERS,
    assignments: CONING_ASSIGN,
    rates: [CONING_RATE_BASE],
    coningRows: [
      coningRow({ id: 'start', date: '2026-03-05' }),
      coningRow({ id: 'end', date: '2026-03-06', barcode: 'B2' }),
      coningRow({ id: 'outside', date: '2026-03-07', barcode: 'B3' }),
    ],
  });
  const res = await preview(stub, { from: '2026-03-05', to: '2026-03-06' });
  assert.equal(res.from, '2026-03-05');
  assert.equal(res.to, '2026-03-06');
  assert.deepEqual(res.lines.map((l) => l.sourceRowId), ['start', 'end']);
});

test('cone-type override wins over the base rate', async () => {
  const coneRate = { ...CONING_RATE_BASE, id: 'rateCone', coneTypeId: 'CT1', ratePerKg: 11 };
  const stub = makeStub({ ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE, coneRate], coningRows: [coningRow()] });
  const res = await preview(stub);
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].rateId, 'rateCone');
  assert.equal(res.lines[0].ratePerKg, 11);
  assert.equal(res.lines[0].amount, 110);
});

test('excludes opening, purchased, non-positive, and claimed rows', async () => {
  const rows = [
    coningRow({ id: 'ok' }),
    coningRow({ id: 'opening', createdBy: 'opening' }),
    coningRow({ id: 'purchase', lotNo: 'CP-001' }),
    coningRow({ id: 'zero', netWeight: 0, coneWeight: 0, grossWeight: 0 }),
    coningRow({ id: 'old', date: '2025-12-01' }), // outside selected report date
    coningRow({ id: 'claimed' }),
  ];
  const stub = makeStub({
    ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE], coningRows: rows,
    claimedLines: [{ sourceRowId: 'claimed', settlementId: 'other' }],
  });
  const res = await preview(stub);
  assert.deepEqual(res.lines.map((l) => l.sourceRowId), ['ok']);
  assert.equal(res.excluded.opening, 1);
  assert.equal(res.excluded.purchased, 1);
  assert.equal(res.excluded.nonPositiveKg, 1);
  assert.equal(res.excluded.claimed, 1);
});

test('excludeSettlementId re-admits rows claimed by that settlement only', async () => {
  // Two claimed rows: one owned by the settlement being re-previewed ('self'),
  // one owned by another settlement. The stub emulates the claim query's
  // filters (candidate ids + optional NOT settlementId), so this test fails if
  // the exclusion filter is dropped or inverted.
  const claims = [
    { sourceRowId: 'mine', settlementId: 'self' },
    { sourceRowId: 'other', settlementId: 'sX' },
  ];
  const stub = makeStub({
    ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE],
    coningRows: [coningRow({ id: 'mine' }), coningRow({ id: 'other', barcode: 'B2' })],
  });
  stub.contractorSettlementLine.findMany = async ({ where }) => claims
    .filter((c) => where.sourceRowId.in.includes(c.sourceRowId))
    .filter((c) => (where.NOT ? c.settlementId !== where.NOT.settlementId : true));

  const withExclude = await preview(stub, { excludeSettlementId: 'self' });
  assert.deepEqual(withExclude.lines.map((l) => l.sourceRowId), ['mine']);
  assert.equal(withExclude.excluded.claimed, 1); // the other settlement's row stays claimed

  const withoutExclude = await preview(stub);
  assert.equal(withoutExclude.lines.length, 0);
  assert.equal(withoutExclude.excluded.claimed, 2);
});

test('coning Cut comes from the holo lineage, not the denormalized issue cutId', async () => {
  // The coning issue carries a stale cutId 'C1', but its receivedRowRefs trace
  // through a holo receive row to a holo issue whose Cut is 'C2'. Rate
  // matching must price the traced 'C2' (₹11), not the stale 'C1' (₹8).
  const rateC2 = { ...CONING_RATE_BASE, id: 'rateC2', cutId: 'C2', ratePerKg: 11 };
  const stub = makeStub({
    ...MASTERS,
    cuts: [...MASTERS.cuts, { id: 'C2', name: '60' }],
    assignments: CONING_ASSIGN,
    rates: [CONING_RATE_BASE, rateC2],
    coningRows: [coningRow({ receivedRowRefs: [{ rowId: 'HR1', coneTypeId: 'CT1' }] })],
    holoRows: [{ id: 'HR1', issueId: 'HI1', isDeleted: false }],
    holoIssues: [{ id: 'HI1', cutId: 'C2' }],
  });
  const res = await preview(stub);
  assert.equal(res.blockers.length, 0);
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].cutId, 'C2');
  assert.equal(res.lines[0].rateId, 'rateC2');
  assert.equal(res.lines[0].amount, 110);
});

test('coning Cut traces through a cut-less holo issue down to the cutter row', async () => {
  // The holo issue has NO cutId, so the trace must continue through the holo
  // issue's own receivedRowRefs to the cutter receive row, whose cutId is the
  // truth — not fall back to the coning issue's stale 'C1'.
  const rateC2 = { ...CONING_RATE_BASE, id: 'rateC2', cutId: 'C2', ratePerKg: 11 };
  const stub = makeStub({
    ...MASTERS,
    cuts: [...MASTERS.cuts, { id: 'C2', name: '60' }],
    assignments: CONING_ASSIGN,
    rates: [CONING_RATE_BASE, rateC2],
    coningRows: [coningRow({ receivedRowRefs: [{ rowId: 'HR1' }] })],
    holoRows: [{ id: 'HR1', issueId: 'HI1' }],
    holoIssues: [{ id: 'HI1', cutId: null, receivedRowRefs: [{ rowId: 'CR1' }] }],
    cutterRows: [{ id: 'CR1', cutId: 'C2' }],
  });
  const res = await preview(stub);
  assert.equal(res.blockers.length, 0);
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].cutId, 'C2');
  assert.equal(res.lines[0].amount, 110);
});

test('re-coning refs recurse to the parent coning issue for the Cut', async () => {
  // The coning issue references a PARENT coning receive row (re-coning); the
  // trace must recurse into the parent issue's lineage (here its own cutId,
  // having no refs of its own) instead of using the stale 'C1'.
  const rateC2 = { ...CONING_RATE_BASE, id: 'rateC2', cutId: 'C2', ratePerKg: 11 };
  const parentRow = {
    id: 'PR1', issueId: 'PI1', date: '2025-01-01', netWeight: 0, isDeleted: false,
    createdBy: 'manual', barcode: 'PB1',
    issue: { id: 'PI1', date: '2025-01-01', yarnId: 'Y1', cutId: 'C2', itemId: 'I1', receivedRowRefs: [] },
  };
  const stub = makeStub({
    ...MASTERS,
    cuts: [...MASTERS.cuts, { id: 'C2', name: '60' }],
    assignments: CONING_ASSIGN,
    rates: [CONING_RATE_BASE, rateC2],
    coningRows: [coningRow({ receivedRowRefs: [{ rowId: 'PR1' }] }), parentRow],
    coningIssues: [{ id: 'PI1', cutId: 'C2', receivedRowRefs: [] }],
  });
  const res = await preview(stub);
  assert.equal(res.lines.length, 1); // parentRow itself is excluded (0 kg)
  assert.equal(res.lines[0].cutId, 'C2');
  assert.equal(res.lines[0].amount, 110);
});

test('partially resolvable lineage blocks the row instead of using the partial Cut', async () => {
  // One ref resolves to a Cut, the other resolves to nothing: the available
  // lineage is incomplete, so the row must block — not silently accept the
  // single resolved Cut (and not fall back to the denormalized issue cutId).
  const stub = makeStub({
    ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE],
    coningRows: [coningRow({ receivedRowRefs: [{ rowId: 'HR1' }, { rowId: 'HR-GONE' }] })],
    holoRows: [{ id: 'HR1', issueId: 'HI1' }],
    holoIssues: [{ id: 'HI1', cutId: 'C1' }],
  });
  const res = await preview(stub);
  assert.equal(res.lines.length, 0);
  assert.equal(res.blockers.length, 1);
  assert.equal(res.blockers[0].reason, 'missing_quality');
});

test('conflicting traced Cuts block the row instead of falling back silently', async () => {
  // Two refs tracing to holo issues with DIFFERENT cuts: the lineage is
  // ambiguous, so the row must become a visible blocker — not silently use the
  // denormalized issue cutId to pick a rate.
  const stub = makeStub({
    ...MASTERS,
    cuts: [...MASTERS.cuts, { id: 'C2', name: '60' }],
    assignments: CONING_ASSIGN,
    rates: [CONING_RATE_BASE],
    coningRows: [coningRow({ receivedRowRefs: [{ rowId: 'HR1' }, { rowId: 'HR2' }] })],
    holoRows: [{ id: 'HR1', issueId: 'HI1' }, { id: 'HR2', issueId: 'HI2' }],
    holoIssues: [{ id: 'HI1', cutId: 'C1' }, { id: 'HI2', cutId: 'C2' }],
  });
  const res = await preview(stub);
  assert.equal(res.lines.length, 0);
  assert.equal(res.blockers.length, 1);
  assert.equal(res.blockers[0].reason, 'missing_quality');
});

test('coning rows price via a cut-less wildcard rate; a pinned Cut outranks it', async () => {
  const generic = { ...CONING_RATE_BASE, id: 'generic', cutId: null, ratePerKg: 7 };
  const pinned = { ...CONING_RATE_BASE, id: 'pinned', ratePerKg: 8 }; // pins C1
  const stub = makeStub({
    ...MASTERS, cuts: [...MASTERS.cuts, { id: 'C2', name: '60' }],
    assignments: CONING_ASSIGN, rates: [generic, pinned],
    coningRows: [coningRow({ id: 'a' }), coningRow({ id: 'b', cutId: 'C2', barcode: 'B2' })],
  });
  const res = await preview(stub);
  assert.equal(res.blockers.length, 0);
  const rateByRow = Object.fromEntries(res.lines.map((l) => [l.sourceRowId, l.rateId]));
  assert.equal(rateByRow.a, 'pinned'); // cut C1 → pinned override
  assert.equal(rateByRow.b, 'generic'); // cut C2 → wildcard
});

test('a coning row with no Cut anywhere is payable via a cut-less rate (Cut optional)', async () => {
  const generic = { ...CONING_RATE_BASE, id: 'generic', cutId: null };
  const cutlessRow = coningRow({});
  cutlessRow.issue.cutId = null; // no cut on the issue and no lineage refs
  const stub = makeStub({
    ...MASTERS, assignments: CONING_ASSIGN, rates: [generic],
    coningRows: [cutlessRow],
  });
  const res = await preview(stub);
  assert.equal(res.blockers.length, 0);
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].rateId, 'generic');
  assert.equal(res.lines[0].cutId, null);
});

test('missing Side and missing rate become per-row blockers', async () => {
  const stub = makeStub({
    ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE],
    coningRows: [coningRow({ id: 'nosidewrong', itemId: 'I2' }), coningRow({ id: 'norate', yarnId: 'Y9' })],
    yarns: [...MASTERS.yarns, { id: 'Y9', name: 'other' }],
  });
  const res = await preview(stub);
  assert.equal(res.lines.length, 0);
  const reasons = res.blockers.map((b) => b.reason).sort();
  assert.deepEqual(reasons, ['missing_side', 'no_rate']);
});

test('ambiguous equally-specific rates block the row', async () => {
  const dup = { ...CONING_RATE_BASE, id: 'dup' };
  const stub = makeStub({ ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE, dup], coningRows: [coningRow()] });
  const res = await preview(stub);
  assert.equal(res.lines.length, 0);
  assert.equal(res.blockers[0].reason, 'ambiguous_rate');
});

test('quality totals use the one current rate card', async () => {
  const stub = makeStub({
    ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE],
    coningRows: [coningRow({ id: 'a' }), coningRow({ id: 'b', barcode: 'B2' })],
  });
  const res = await preview(stub);
  assert.equal(res.lines.length, 2);
  assert.equal(res.qualityTotals.length, 1);
  assert.equal(res.qualityTotals[0].ratePerKg, 8);
  assert.equal('rateMixed' in res.qualityTotals[0], false);
});

test('truncation flag set when the fetch exceeds the row limit', async () => {
  const many = Array.from({ length: 20001 }, (_, i) => coningRow({ id: `z${i}`, netWeight: 0, coneWeight: 0, grossWeight: 0 }));
  const stub = makeStub({ ...MASTERS, assignments: CONING_ASSIGN, rates: [CONING_RATE_BASE], coningRows: many });
  const res = await preview(stub);
  assert.equal(res.truncated, true);
});

test('resolveRow resolves cutter Item from unique itemName when issue link is absent', () => {
  const maps = {
    items: new Map([['I1', { id: 'I1', name: 'S/S 40', side: 'SINGLE' }]]),
    yarns: new Map(), cuts: new Map([['C1', { id: 'C1', name: '40' }]]), twists: new Map(), coneTypes: new Map(),
    itemsByName: new Map([['s/s 40', 'I1']]),
  };
  const row = { id: 'c1', date: '2026-03-05', netWt: 12.5, itemName: 'S/S 40', cutId: 'C1', issue: null };
  const resolved = resolveRow('cutter', row, maps);
  assert.equal(resolved.itemId, 'I1');
  assert.equal(resolved.cutId, 'C1');
  assert.equal(resolved.netKg, 12.5);
});

test('PDF groupLines splits a quality group by rate version', () => {
  const lines = [
    { itemId: null, yarnId: 'Y1', cutId: 'C1', twistId: 'T1', side: 'SINGLE', coneTypeId: 'CT1', ratePerKg: 8, netKg: 10, amount: 80 },
    { itemId: null, yarnId: 'Y1', cutId: 'C1', twistId: 'T1', side: 'SINGLE', coneTypeId: 'CT1', ratePerKg: 9, netKg: 5, amount: 45 },
  ];
  const groups = groupLines('coning', lines);
  assert.equal(groups.length, 2); // same quality, two rates → two rows
  for (const g of groups) {
    assert.equal(Math.round(g.ratePerKg * g.netKg * 100) / 100, g.amount); // Rate × KG reconciles with Amount
  }
});

test('contractor settlement PDF is summary-only', async () => {
  const pdf = await generateContractorSettlementPdf({
    contractor: { name: 'Birendra bhai', phone: '9999999999' },
    process: 'coning',
    periodFrom: '2026-03-05',
    periodTo: '2026-03-06',
    status: 'paid',
    paymentDate: '2026-03-07',
    paymentMode: 'Cash',
    productionAmount: 125,
    adjustmentsTotal: 0,
    finalPayable: 125,
    lines: [{
      itemId: null, yarnId: 'Y1', yarnName: '40s', cutId: 'C1', cutName: '40',
      twistId: 'T1', twistName: 'TW', side: 'SINGLE', coneTypeId: 'CT1', coneTypeName: 'Big',
      ratePerKg: 10, netKg: 12.5, amount: 125, date: '2026-03-05', barcode: 'B1',
    }],
    adjustments: [],
  });
  assert.ok(pdf.length > 0);
  assert.equal(pdf.includes('Quality & Side Breakdown'), true);
  assert.equal(pdf.includes('Production Rows'), false);
});

test('diffSettlementProduction flags no drift on an unchanged snapshot', () => {
  const stored = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, barcode: 'B1' }];
  const current = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80 }];
  assert.deepEqual(diffSettlementProduction(stored, current), []);
});

test('diffSettlementProduction flags a deleted/ineligible source row', () => {
  const stored = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, barcode: 'B1' }];
  const res = diffSettlementProduction(stored, []); // row no longer previews
  assert.equal(res.length, 1);
  assert.equal(res[0].reason, 'no_longer_eligible');
  assert.equal(res[0].barcode, 'B1');
});

test('diffSettlementProduction flags KG / rate / amount drift', () => {
  const stored = [
    { sourceRowId: 'kg', netKg: 10, ratePerKg: 8, amount: 80 },
    { sourceRowId: 'rate', netKg: 10, ratePerKg: 8, amount: 80 },
    { sourceRowId: 'amt', netKg: 10, ratePerKg: 8, amount: 80 },
    { sourceRowId: 'ok', netKg: 10, ratePerKg: 8, amount: 80 },
  ];
  const current = [
    { sourceRowId: 'kg', netKg: 9, ratePerKg: 8, amount: 72 },
    { sourceRowId: 'rate', netKg: 10, ratePerKg: 9, amount: 90 },
    { sourceRowId: 'amt', netKg: 10, ratePerKg: 8, amount: 81 },
    { sourceRowId: 'ok', netKg: 10, ratePerKg: 8, amount: 80 },
  ];
  const reasons = Object.fromEntries(diffSettlementProduction(stored, current).map((m) => [m.sourceRowId, m.reason]));
  assert.deepEqual(reasons, { kg: 'changed', rate: 'changed', amt: 'changed' });
});

test('diffSettlementProduction tolerates sub-epsilon float noise', () => {
  const stored = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80 }];
  const current = [{ sourceRowId: 'r1', netKg: 10.0000001, ratePerKg: 8, amount: 80.001 }];
  assert.deepEqual(diffSettlementProduction(stored, current), []);
});

test('diffSettlementProduction flags identity drift even when the amount is unchanged', () => {
  // Side SINGLE -> BOTH at the same ₹8 rate: financially identical, must flag.
  const stored = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, side: 'SINGLE', rateId: 'rateA' }];
  const sideChanged = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, side: 'BOTH', rateId: 'rateA' }];
  assert.equal(diffSettlementProduction(stored, sideChanged)[0].reason, 'changed');
  // Different matched rate record at the same numeric rate.
  const rateRecordChanged = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, side: 'SINGLE', rateId: 'rateB' }];
  assert.equal(diffSettlementProduction(stored, rateRecordChanged)[0].reason, 'changed');
  // Quality key change (cut) at the same amount.
  const stored2 = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, cutId: 'C1' }];
  const cutChanged = [{ sourceRowId: 'r1', netKg: 10, ratePerKg: 8, amount: 80, cutId: 'C2' }];
  assert.equal(diffSettlementProduction(stored2, cutChanged)[0].reason, 'changed');
});

test('recomputeSettlementTotals sums lines and applies signed adjustments', () => {
  const lines = [{ netKg: 10, amount: 80 }, { netKg: 5, amount: 45 }];
  const totals = recomputeSettlementTotals(lines, [{ type: 'bonus', amount: 20 }, { type: 'deduction', amount: 5 }]);
  assert.equal(totals.productionKg, 15);
  assert.equal(totals.productionAmount, 125);
  assert.equal(totals.adjustmentsTotal, 15);
  assert.equal(totals.finalPayable, 140);
});
