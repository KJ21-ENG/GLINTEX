import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFilters } from '../filters.js';
import { normalizeReport, toWorkerStatement, buildWorkerMonthlyReport } from '../service.js';
import { quantities, totals } from '../quantities.js';
import { issue, row, sources } from './fixtures.js';
const now = new Date('2026-09-06T12:00:00Z');
const filters = (over = {}) => validateFilters({ month: '2026-08', ...over }, now);
const report = (rows, extra = {}, filter = {}) => normalizeReport(sources(rows, extra), filters(filter));

test('calendar validation, previous month, leap/year boundaries and India current cutoff', () => {
  assert.equal(validateFilters({}, now).month, '2026-08');
  assert.equal(validateFilters({}, new Date('2026-01-01T00:00Z')).month, '2025-12');
  assert.equal(filters({ month: '2024-02' }).period.endExclusive, '2024-03-01');
  const current = validateFilters({ month: '2026-09' }, new Date('2026-09-06T20:00Z'));
  assert.equal(current.period.cutoff, '2026-09-07');
  assert.equal(current.period.effectiveEndExclusive, '2026-09-08');
  assert.equal(current.generatedAt, '2026-09-06T20:00:00.000Z');
  for (const bad of [{ month: '2026-13' }, { month: '2026-9' }, { month: '2026-10' }, { month: [] }, { process: 'holo' }, { process: 'all' }, { workerId: '' }, { workerId: ['w1'] }]) assert.throws(() => filters(bad), { status: 400 });
});

test('receive ID and operator authoritative; duplicates, reassignment, helper and dispatch do not change output', () => {
  const first = row({ helperId: 'helper', dispatchedCount: 10, dispatchedWeight: 1.2345, createdAt: '2026-09-02' });
  const second = row({ id: 'r2', operatorId: 'w2', operator: { id: 'w2', name: 'Same name' } });
  const r = report([first, first, second]);
  assert.deepEqual(r.workerOptions.map(w => w.id), ['w1', 'w2']);
  assert.equal(r.office.totals.cones, 20);
  assert.equal(r.statements.length, 2);
  assert.equal(r.office.details[0].receiveRowId, 'r1');
  assert.equal(r.office.details[0].issueBarcode, 'CI-1');
  assert.equal(r.office.details[0].provenance.cut.basis, 'issue_refs');
  assert.equal(r.office.details[0].quality.cut.values[0].id, 'c1');
  const worker = toWorkerStatement(r, 'w1');
  assert.equal(worker.worker.id, 'w1');
  assert.equal(worker.monthlyTotals.cones, 10);
  assert.equal(worker.office, undefined);
  assert.equal(worker.rows[0].receiveRowId, undefined);
  assert.equal(worker.rows[0].provenance, undefined);
  assert.equal(report([first, second], {}, { workerId: 'w2' }).office.selectedTotals.cones, 10);
});

test('business date exact half-open boundaries and unassigned malformed dates, no issue/creation fallback', () => {
  const r = report(['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01', null, 'garbage', '2026-02-30'].map((date, n) => row({ id: `${n}`, date })));
  assert.deepEqual(r.office.details.map(d => d.date), ['2026-08-01', '2026-08-31']);
  assert.equal(r.office.unassignedPeriodExceptions.length, 3);
  assert.equal(r.office.exceptionTotals.rowCount, 0);
  const leap = report(['2024-02-29', '2024-03-01'].map((date, n) => row({ id: `${n}`, date })), {}, { month: '2024-02' });
  assert.equal(leap.office.totals.rowCount, 1);
  const current = report([row({ date: '2026-09-07' })], {}, { month: '2026-09' });
  assert.equal(current.office.totals.rowCount, 0);
});

test('exceptions and stage-aware exclusions reconcile separately; upstream opening/purchase remain eligible', () => {
  const r = report([
    row(), row({ id: 'op-input', issue: issue({ lotNo: 'OP-001' }) }),
    row({ id: 'deleted', isDeleted: true }), row({ id: 'opening', createdBy: 'opening' }),
    row({ id: 'bulk', issue: issue({ note: 'Opening Stock Bulk' }), operator: null }),
    row({ id: 'missing', operatorId: null }), row({ id: 'unresolvable', operator: null }),
    row({ id: 'deleted-issue', issue: issue({ isDeleted: true }) }),
  ]);
  assert.equal(r.office.totals.rowCount, 2);
  assert.equal(r.office.excluded.length, 3);
  assert.equal(r.office.exceptions.length, 3);
  assert.equal(r.office.reconciliation.periodAccounted.rowCount, 8);
  assert.equal(r.office.reconciliation.periodAccounted.cones, 80);
});

test('zero/null/fallback/invalid quantities and integer gram normalization reconcile', () => {
  assert.equal(quantities(row({ netWeight: 0, coneWeight: 9 })).netKg, 0);
  assert.equal(quantities(row({ netWeight: null, coneWeight: 0, grossWeight: 8, tareWeight: 1 })).netKg, 0);
  assert.equal(quantities(row({ netWeight: null, coneWeight: 2.3456 })).netKg, 2.346);
  assert.equal(quantities(row({ netWeight: null, grossWeight: 5, tareWeight: 1 })).weightSource, 'gross_minus_tare');
  const r = report([row({ id: 'zero', coneCount: 0, netWeight: 0 }), row({ id: 'unknown', netWeight: null }), row({ id: 'legacy', netWeight: null, coneWeight: 2.3456 }), row({ id: 'negative', netWeight: -1 }), row({ id: 'inf', netWeight: Infinity }), row({ id: 'fractional', coneCount: 1.5 })]);
  assert.equal(r.office.totals.cones, 20);
  assert.equal(r.office.totals.netKg, 2.346);
  assert.equal(r.office.totals.unknownWeightRows, 1);
  assert.equal(r.office.totals.weightComplete, false);
  assert.equal(r.office.exceptions.length, 3);
  const s = r.statements[0];
  assert.equal(s.dailyTotals.reduce((s, d) => s + d.totals.netGrams, 0), s.monthlyTotals.netGrams);
  assert.equal(s.qualitySummary.reduce((s, d) => s + d.totals.netGrams, 0), s.monthlyTotals.netGrams);
  assert.equal(s.rows.reduce((s, d) => s + (d.netGrams || 0), 0), s.monthlyTotals.netGrams);
  assert.throws(() => totals([{ cones: Number.MAX_SAFE_INTEGER, netGrams: 0 }, { cones: 1, netGrams: 0 }]));
});

test('mixed/partial cut trace never duplicates output or overrides with direct cut; reliable receive refs narrow', () => {
  const graph = sources().graph;
  graph.set('h2', { stage: 'holo', row: { id: 'h2', issue: { cutId: 'c2' } } });
  const mixedIssue = issue({ receivedRowRefs: [{ rowId: 'h1', coneTypeId: 'cone1' }, { rowId: 'h2', coneTypeId: 'cone1' }] });
  let r = report([row({ issue: mixedIssue })], { graph });
  assert.equal(r.office.details[0].quality.cut.state, 'mixed');
  assert.equal(r.office.totals.cones, 10);
  r = report([row({ issue: mixedIssue, netWeight: 1, sourceRowRefs: [{ rowId: 'h2', weight: 1 }] })], { graph });
  assert.equal(r.office.details[0].quality.cut.values[0].id, 'c2');
  assert.equal(r.office.details[0].provenance.cut.basis, 'receive_source_refs');
  r = report([row({ issue: mixedIssue, sourceRowRefs: [{ rowId: 'h2', weight: 0.2 }] })], { graph });
  assert.equal(r.office.details[0].quality.cut.state, 'partial');
  r = report([row({ issue: issue({ receivedRowRefs: [{ rowId: 'h1' }, { rowId: 'missing' }] }) })]);
  assert.equal(r.office.details[0].quality.cut.state, 'partial');
  assert.deepEqual(r.office.details[0].quality.cut.values.map(v => v.id), ['c1']);
  r = report([row({ issue: issue({ receivedRowRefs: [] }) })]);
  assert.equal(r.office.details[0].quality.cut.values[0].id, 'wrong');
});

test('reconing, shared ancestors, cutter lineage, cycles and depth terminate deterministically', () => {
  const graph = sources().graph;
  graph.set('parent', { stage: 'coning', row: row({ id: 'parent' }) });
  graph.set('hcut', { stage: 'holo', row: { id: 'hcut', issue: { receivedRowRefs: [{ rowId: 'cutter' }] } } });
  graph.set('cutter', { stage: 'cutter', row: { id: 'cutter', issue: { cutId: 'c2' } } });
  const r = report([row({ issue: issue({ receivedRowRefs: [{ rowId: 'parent' }, { rowId: 'h1' }, { rowId: 'hcut' }] }) })], { graph });
  assert.equal(r.office.details[0].quality.cut.state, 'mixed');
  assert.equal(r.office.totals.cones, 10);
  graph.set('cycle', { stage: 'coning', row: row({ id: 'cycle', issue: issue({ receivedRowRefs: [{ rowId: 'cycle' }] }) }) });
  const cyc = report([row({ issue: issue({ receivedRowRefs: [{ rowId: 'cycle' }] }) })], { graph });
  assert.equal(cyc.office.details[0].quality.cut.state, 'unresolved');
  assert.ok(cyc.office.details[0].flags.includes('lineage_cycle'));
  for (let i = 0; i < 35; i++) graph.set(`chain${i}`, { stage: 'coning', row: row({ id: `chain${i}`, issue: issue({ receivedRowRefs: [{ rowId: `chain${i + 1}` }] }) }) });
  assert.ok(report([row({ issue: issue({ receivedRowRefs: [{ rowId: 'chain0' }] }) })], { graph }).office.details[0].flags.includes('lineage_depth_limit'));
});

test('quality IDs and cone target/type/missing context remain separate, rows chronological stable', () => {
  const r = report([
    row({ id: 'z', date: '2026-08-16' }), row({ id: 'a' }),
    row({ id: 'b', issue: issue({ id: 'size', requiredPerConeNetWeight: 200 }) }),
    row({ id: 'c', issue: issue({ id: 'unknown1', yarnId: null }) }),
    row({ id: 'd', issue: issue({ id: 'unknown2', yarnId: null }) }),
    row({ id: 'e', issue: issue({ id: 'cone', receivedRowRefs: [{ rowId: 'h1', coneTypeId: 'cone2' }] }) }),
  ], { coneTypes: [{ id: 'cone1', name: 'Same' }, { id: 'cone2', name: 'Same' }] });
  assert.equal(r.statements[0].qualitySummary.length, 5);
  assert.deepEqual(r.office.details.map(d => d.receiveRowId), ['a', 'b', 'c', 'd', 'e', 'z']);
  assert.equal(r.statements[0].dailyTotals.length, 2);
});

test('full service reads batched snapshot, discovers undated rows and does not truncate 2500 outputs', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => row({ id: `r${i}`, netWeight: 0.001 }));
  const src = sources(rows);
  const calls = [];
  const client = {};
  client.receiveFromConingMachineRow = { findMany: async args => {
    calls.push(args);
    if (args.select) return rows.map(r => ({ id: r.id, date: r.date }));
    if (args.where.date) return rows;
    return [];
  } };
  client.receiveFromHoloMachineRow = { findMany: async () => [{ id: 'h1', issue: { id: 'hi1', cutId: 'c1' } }] };
  client.receiveFromCutterMachineRow = { findMany: async () => [] };
  for (const [model, key] of [['item', 'items'], ['yarn', 'yarns'], ['twist', 'twists'], ['cut', 'cuts'], ['coneType', 'coneTypes']]) client[model] = { findMany: async () => src[key] };
  const prisma = { $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return fn(client); } };
  const r = await buildWorkerMonthlyReport(prisma, { month: '2026-08' }, { now });
  assert.equal(r.statements[0].rows.length, 2500);
  assert.equal(r.office.totals.netKg, 2.5);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].where.date.lt, '2026-09-01');
});

test('item IDs, side, yarn and twist retain distinct quality groups even with identical names', () => {
  const r = report([
    row(), row({ id: 'item2', issue: issue({ itemId: 'item2' }) }),
    row({ id: 'both', issue: issue({ itemId: 'both' }) }),
    row({ id: 'yarn2', issue: issue({ yarnId: 'y2' }) }),
    row({ id: 'twist2', issue: issue({ twistId: 't2' }) }),
  ], { items: [{ id: 'item1', name: 'Same', side: 'SINGLE' }, { id: 'item2', name: 'Same', side: 'SINGLE' }, { id: 'both', name: 'Same', side: 'BOTH' }],
    yarns: [{ id: 'y1', name: 'Same' }, { id: 'y2', name: 'Same' }], twists: [{ id: 't1', name: 'Same' }, { id: 't2', name: 'Same' }] });
  assert.equal(r.statements[0].qualitySummary.length, 5);
  assert.equal(r.office.totals.cones, 50);
});

test('missing recorded yarn/twist resolve through sources, mixed twist remains mixed', () => {
  const graph = new Map([
    ['h1', { stage: 'holo', row: { id: 'h1', issue: { cutId: 'c1', yarnId: 'y1', twistId: 't1' } } }],
    ['h2', { stage: 'holo', row: { id: 'h2', issue: { cutId: 'c1', yarnId: 'y1', twistId: 't2' } } }],
  ]);
  const r = report([row({ issue: issue({ yarnId: null, twistId: null, receivedRowRefs: [{ rowId: 'h1' }, { rowId: 'h2' }] }) })],
    { graph, twists: [{ id: 't1', name: 'Twist 1' }, { id: 't2', name: 'Twist 2' }] });
  assert.equal(r.office.details[0].quality.yarn.state, 'resolved');
  assert.equal(r.office.details[0].quality.twist.state, 'mixed');
  assert.equal(r.office.details[0].quality.twist.values.length, 2);
});

test('deleted or malformed lineage stays unresolved; unavailable legacy trace explicitly falls back', () => {
  const graph = sources().graph;
  graph.set('deleted', { stage: 'holo', row: { id: 'deleted', isDeleted: true, issue: { cutId: 'c1' } } });
  for (const receivedRowRefs of [[{ rowId: 'deleted' }], '{bad', [{ rowId: 42 }]]) {
    const r = report([row({ issue: issue({ receivedRowRefs }) })], { graph });
    assert.equal(r.office.details[0].quality.cut.state, 'unresolved');
    assert.equal(r.office.details[0].quality.cut.values.length, 0);
  }
  const fallback = report([row({ issue: issue({ receivedRowRefs: [{ rowId: 'missing' }] }) })]);
  assert.equal(fallback.office.details[0].quality.cut.values[0].id, 'wrong');
  assert.ok(fallback.office.details[0].flags.includes('direct_cut_fallback'));
});

test('worker projection contains no office trace paths or internal grouping provenance', () => {
  const r = report([row({ issue: issue({ id: 'private-issue', yarnId: null, receivedRowRefs: [{ rowId: 'private-source' }] }) })]);
  const statement = JSON.stringify(toWorkerStatement(r, 'w1'));
  assert.ok(!statement.includes('private-issue'));
  assert.ok(!statement.includes('private-source'));
  assert.ok(!statement.includes('direct_cut_fallback'));
  assert.equal(toWorkerStatement(r, 'w1').rows[0].quality.key.length, 64);
});

test('missing source identities are malformed while exact opening cone metadata and empty refs retain fallback', () => {
  for (const receivedRowRefs of [[{}], [{ barcode: 'missing-row-id' }], [{ rowId: 'h1' }, {}], [{ rowId: 'h1' }, { coneTypeId: 'cone1' }]]) {
    const r = report([row({ issue: issue({ receivedRowRefs }) })]);
    const detail = r.office.details[0];
    assert.equal(detail.quality.cut.state, receivedRowRefs.some(ref => ref.rowId === 'h1') ? 'partial' : 'unresolved');
    assert.ok(detail.flags.includes('unreliable_source_refs'));
    assert.ok(!detail.quality.cut.values.some(value => value.id === 'wrong'));
  }
  for (const receivedRowRefs of [[], null, [{ coneTypeId: 'cone1', wrapperId: null }], [{ coneTypeId: null, wrapperId: null }]]) {
    const r = report([row({ issue: issue({ receivedRowRefs }) })]);
    assert.equal(r.office.details[0].quality.cut.state, 'resolved');
    assert.equal(r.office.details[0].quality.cut.values[0].id, 'wrong');
    assert.ok(!r.office.details[0].flags.includes('unreliable_source_refs'));
  }
});

test('distinct narrowed unknown yarn/twist traces stay separate; equivalent resolved quality still combines', () => {
  const graph = new Map(['h1', 'h2'].map(id => [id, { stage: 'holo', row: { id, issue: { id: `private-${id}`, cutId: 'c1', receivedRowRefs: [] } } }]));
  for (const field of ['yarnId', 'twistId']) {
    const sharedIssue = issue({ [field]: null, receivedRowRefs: [{ rowId: 'h1', coneTypeId: 'cone1' }, { rowId: 'h2', coneTypeId: 'cone1' }] });
    const rows = ['h1', 'h2'].map((id, n) => row({ id: `r${n}`, issue: sharedIssue, netWeight: 1, sourceRowRefs: [{ rowId: id, weight: 1 }] }));
    const unresolved = report(rows, { graph });
    const dimension = field.replace('Id', '');
    assert.equal(unresolved.statements[0].qualitySummary.length, 2);
    assert.notEqual(unresolved.office.details[0].quality[dimension].key, unresolved.office.details[1].quality[dimension].key);
    assert.ok(unresolved.office.details[0].provenance[dimension].paths.includes('h1'));
    assert.ok(unresolved.office.details[1].provenance[dimension].paths.includes('h2'));
    const workerPayload = JSON.stringify(toWorkerStatement(unresolved, 'w1'));
    assert.ok(!workerPayload.includes('private-h1'));
    assert.ok(!workerPayload.includes('private-h2'));
    const resolvedGraph = new Map([...graph].map(([id, node]) => [id, { ...node, row: { ...node.row, issue: { ...node.row.issue, [field]: field === 'yarnId' ? 'y1' : 't1' } } }]));
    const resolved = report(rows, { graph: resolvedGraph });
    assert.equal(resolved.statements[0].qualitySummary.length, 1);
    assert.equal(resolved.statements[0].monthlyTotals.cones, 20);
  }
});
