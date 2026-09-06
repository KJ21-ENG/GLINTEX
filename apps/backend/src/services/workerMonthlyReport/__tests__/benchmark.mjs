// Synthetic full-source benchmark, deliberately no database connection.
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { buildWorkerMonthlyReport } from '../service.js';
import { row, issue, sources } from './fixtures.js';
const count = 26000;
const refs = Array.from({ length: 11 }, (_, i) => ({ rowId: `h${i}`, coneTypeId: 'cone1' }));
const rows = Array.from({ length: count }, (_, i) => row({ id: `r${String(i).padStart(5, '0')}`, issue: issue({ receivedRowRefs: refs }),
  operatorId: `w${i % 26}`, operator: { id: `w${i % 26}`, name: `Worker ${i % 26}` } }));
const src = sources(rows);
let reads = 0;
const client = {};
client.receiveFromConingMachineRow = { findMany: async args => {
  reads++;
  if (args.select) return rows.map(r => ({ id: r.id, date: r.date }));
  return args.where.date ? rows : [];
} };
client.receiveFromHoloMachineRow = { findMany: async () => { reads++; return refs.map(ref => ({ id: ref.rowId, issue: { id: `issue-${ref.rowId}`, cutId: 'c1' } })); } };
client.receiveFromCutterMachineRow = { findMany: async () => { reads++; return []; } };
for (const [model, key] of [['item', 'items'], ['yarn', 'yarns'], ['twist', 'twists'], ['cut', 'cuts'], ['coneType', 'coneTypes']]) client[model] = { findMany: async () => { reads++; return src[key]; } };
const initialHeap = process.memoryUsage().heapUsed;
const start = performance.now();
const report = await buildWorkerMonthlyReport({ $transaction: async fn => fn(client) }, { month: '2026-08' }, { now: new Date('2026-09-06T12:00Z') });
const durationMs = performance.now() - start;
assert.equal(report.office.totals.rowCount, count);
assert.equal(report.office.totals.cones, count * 10);
assert.equal(report.office.totals.netGrams, count * 1235);
assert.equal(report.statements.length, 26);
assert.equal(reads, 10);
console.log(JSON.stringify({ rows: count, workers: report.statements.length, sourceRefsPerIssue: 11, reads,
  durationMs: Math.round(durationMs), heapGrowthMiB: Math.round((process.memoryUsage().heapUsed - initialHeap) / 1024 / 1024),
  rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024), database: 'none; synthetic stub reads',
  budget: 'synthetic duration < 5000 ms; no row-based queries', withinBudget: durationMs < 5000 }, null, 2));
assert.ok(durationMs < 5000);
