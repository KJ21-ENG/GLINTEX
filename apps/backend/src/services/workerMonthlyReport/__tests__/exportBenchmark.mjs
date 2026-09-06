import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { exportFixture } from './exportFixtures.js';
import { toWorkerStatement } from '../service.js';
import { exportWorkerPdf } from '../exportPdf.js';
import { exportWorkerWorkbook } from '../exportWorkbook.js';
import { sendReportDownload } from '../exportDownload.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-coning-p2-'));
const report = exportFixture();
await fs.writeFile(path.join(dir, 'normalized.json'), JSON.stringify(report));
const one = toWorkerStatement(report, 'worker/0');
await fs.writeFile(path.join(dir, 'worker.pdf'), exportWorkerPdf(one));
await fs.writeFile(path.join(dir, 'worker.xlsx'), exportWorkerWorkbook(one, report.office.details));
const current = exportFixture({ count: 2, workers: 1, month: '2026-09', unknown: true });
await fs.writeFile(path.join(dir, 'current-unknown.pdf'), exportWorkerPdf(toWorkerStatement(current, 'worker/0')));
const measurements = [];
for (const format of ['pdf', 'xlsx']) {
  const chunks = [];
  const initial = process.memoryUsage().heapUsed;
  let peak = process.memoryUsage().rss;
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); peak = Math.max(peak, process.memoryUsage().rss); setImmediate(cb); } });
  res.set = res.type = res.attachment = () => res;
  const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
  const start = performance.now();
  await sendReportDownload(report, format, res); await finished;
  const durationMs = Math.round(performance.now() - start);
  const buffer = Buffer.concat(chunks);
  await fs.writeFile(path.join(dir, `all-workers-${format}.zip`), buffer);
  const zip = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = zip.FileIndex.filter(entry => entry.type === 2 && entry.name.endsWith(`.${format}`));
  assert.equal(files.length, 26);
  assert.equal(new Set(files.map(entry => entry.name)).size, 26);
  let workbookRows = 0, cones = 0, grams = 0;
  if (format === 'xlsx') for (const entry of files) {
    const book = XLSX.read(Buffer.from(entry.content));
    const rows = XLSX.utils.sheet_to_json(book.Sheets['Office References'], { range: 10 });
    workbookRows += rows.length;
    cones += rows.reduce((n, row) => n + row.Cones, 0);
    grams += rows.reduce((n, row) => n + Math.round(row['Net kg'] * 1000), 0);
    const id = book.Sheets.Summary.B4.v;
    const allowed = new Set(report.office.details.filter(row => row.workerId === id).map(row => row.receiveRowId));
    assert.ok(rows.every(row => allowed.has(row['Receive row ID'])));
    await fs.writeFile(path.join(dir, `archive-${id.replace('/', '-')}.xlsx`), Buffer.from(entry.content));
  }
  else for (let i = 0; i < files.length; i++) await fs.writeFile(path.join(dir, `archive-${i}.pdf`), Buffer.from(files[i].content));
  if (format === 'xlsx') {
    assert.equal(workbookRows, 1872); assert.equal(cones, report.office.totals.cones); assert.equal(grams, report.office.totals.netGrams);
  }
  measurements.push({ format, durationMs, archiveBytes: buffer.length, entries: files.length,
    heapGrowthMiB: Math.round((process.memoryUsage().heapUsed - initial) / 1048576), peakRssMiB: Math.round(peak / 1048576),
    workbookRows: format === 'xlsx' ? workbookRows : undefined });
  assert.ok(durationMs < 30000, 'representative export exceeds 30 second synthetic budget');
}
const result = { outputDir: dir, rows: report.office.details.length, workers: report.statements.length, sourcesPerIssue: 11,
  qualityGroupsPerWorker: one.qualitySummary.length, totals: report.office.totals, measurements,
  caveat: 'Synthetic source; RSS includes collected ZIPs for validation. No database query or production action.' };
await fs.writeFile(path.join(dir, 'measurements.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
