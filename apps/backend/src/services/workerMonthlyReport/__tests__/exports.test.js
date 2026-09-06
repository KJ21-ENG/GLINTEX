import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import XLSX from 'xlsx';
import { Writable } from 'node:stream';
import { sendReportDownload } from '../exportDownload.js';
import prisma from '../../../lib/prisma.js';
import { createWorkerMonthlyReportRouter } from '../../../routes/workerMonthlyReport.js';
import { toWorkerStatement } from '../service.js';
import { validateFilters } from '../filters.js';
import { exportWorkerPdf } from '../exportPdf.js';
import { exportWorkerWorkbook } from '../exportWorkbook.js';
import { workerFilename } from '../exportCommon.js';
import { exportFixture } from './exportFixtures.js';
const bytes = (res, cb) => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

test('workbook round trip: private references, numeric quantities, full summaries and unknown/zero values', () => {
  const report = exportFixture({ count: 280, workers: 2, unknown: true });
  for (const entry of report.statements) {
    const statement = toWorkerStatement(report, entry.worker.id);
    const buffer = exportWorkerWorkbook(statement, report.office.details);
    const book = XLSX.read(buffer, { type: 'buffer' });
    assert.deepEqual(book.SheetNames, ['Monthly Work', 'Office References']);
    const refs = XLSX.utils.sheet_to_json(book.Sheets['Office References'], { range: 10 });
    assert.equal(refs.length, statement.rows.length);
    const expected = report.office.details.filter(row => row.workerId === entry.worker.id);
    assert.deepEqual(refs.map(row => row['Receive row ID']), expected.map(row => row.receiveRowId));
    assert.equal(refs.reduce((sum, row) => sum + Math.round((row['Net kg'] || 0) * 1000), 0), statement.monthlyTotals.netGrams);
    const calendar = XLSX.utils.sheet_to_json(book.Sheets['Monthly Work'], { range: 4 });
    const days = calendar.filter(row => /^\d{2}\/08\/2026$/.test(row.Date));
    assert.equal(days.length, 31);
    assert.equal(days.reduce((sum, row) => sum + (typeof row['Total cones'] === 'number' ? row['Total cones'] : 0), 0), statement.monthlyTotals.cones);
    assert.equal(days.reduce((sum, row) => sum + (typeof row['Total kg'] === 'number' ? Math.round(row['Total kg'] * 1000) : 0), 0), statement.monthlyTotals.netGrams);
    const total = calendar.find(row => row.Date === 'Total');
    assert.equal(total['Total cones'], statement.monthlyTotals.cones);
    assert.equal(total['Total kg'], statement.monthlyTotals.netKg);
    assert.equal(days.at(-1)['Total cones'], '-');
    const styles = Buffer.from(XLSX.CFB.find(XLSX.CFB.read(buffer, { type: 'buffer' }), '/xl/styles.xml').content).toString();
    assert.match(styles, /wrapText="1"/);
    if (entry.worker.id === 'worker/0') assert.match(JSON.stringify(calendar), /Incomplete/);
    else assert.equal(refs[0]['Net kg'], 0);
  }
});

test('filenames resist duplicate names, path traversal and sanitized/truncated ID collisions; PDF rejects unsupported glyphs', () => {
  const report = exportFixture({ count: 2, workers: 2 });
  const a = toWorkerStatement(report, 'worker/0');
  const b = { ...a, worker: { ...a.worker, id: 'worker?0', reference: '../../worker/0' } };
  assert.notEqual(workerFilename(a, 'pdf'), workerFilename(b, 'pdf'));
  assert.doesNotMatch(workerFilename(b, 'pdf'), /[\\/]|\.\./);
  assert.match(exportWorkerPdf(a).subarray(0, 5).toString(), /%PDF/);
  assert.throws(() => exportWorkerPdf({ ...a, worker: { ...a.worker, name: 'ગુજરાતી' } }), /Download Excel/);
});

test('all download formats run real auth/permission middleware, reject unsupported process, snapshot once and ignore preview pagination', async () => {
  const original = prisma.userSession.findUnique;
  let permissions = {}, reads = 0;
  prisma.userSession.findUnique = async () => ({ id: 'session', expiresAt: new Date('2099-01-01'), user: { id: 'office', isActive: true,
    roles: [{ role: { id: 'role', key: 'staff', name: 'Staff', permissions } }] } });
  const report = exportFixture({ count: 30, workers: 2 });
  const app = express();
  app.use('/api/reports/worker-monthly', createWorkerMonthlyReportRouter({ buildReport: async (_client, input) => {
    reads++; const filters = validateFilters(input, new Date('2026-09-06T12:00Z'));
    return { ...report, workerId: filters.workerId, statements: report.statements.filter(s => filters.workerId === 'all' || s.worker.id === filters.workerId) };
  } }));
  try {
    for (const format of ['pdf', 'xlsx']) for (const workerId of ['worker/0', 'all']) {
      const url = `/api/reports/worker-monthly/download/${format}?month=2026-08&workerId=${encodeURIComponent(workerId)}&pageSize=1&page=999`;
      permissions = {};
      const before = reads;
      await request(app).get(url).expect(401);
      await request(app).get(url).set('Authorization', 'Bearer synthetic').expect(403);
      assert.equal(reads, before);
      permissions = { reports: 1 };
      await request(app).get(`${url}&process=holo`).set('Authorization', 'Bearer synthetic').expect(400);
      const beforeDownload = reads;
      const result = await request(app).get(url).set('Authorization', 'Bearer synthetic').buffer(true).parse(bytes).expect(200).expect('Cache-Control', 'no-store');
      assert.equal(reads, beforeDownload + 1);
      assert.equal(result.headers['x-report-generated-at'], report.generatedAt);
      if (workerId === 'all') {
        const zip = XLSX.CFB.read(result.body, { type: 'buffer' });
        const files = zip.FileIndex.filter(entry => entry.type === 2 && entry.name.endsWith(`.${format}`));
        assert.equal(files.length, 2);
        assert.equal(new Set(files.map(file => file.name)).size, 2);
        if (format === 'xlsx') for (const file of files) {
          const book = XLSX.read(Buffer.from(file.content));
          assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Office References'], { range: 10 }).length, 15);
        }
      } else if (format === 'xlsx') {
        const book = XLSX.read(result.body);
        assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Office References'], { range: 10 }).length, 15);
      }
    }
    await request(app).get('/api/reports/worker-monthly/download/pdf?workerId=missing').set('Authorization', 'Bearer synthetic').expect(400);
  } finally { prisma.userSession.findUnique = original; }
});


test('bulk generation terminates promptly when the download consumer disconnects', async () => {
  const report = exportFixture({ count: 52 });
  const res = new Writable({ write(_chunk, _encoding, callback) { this.destroy(); callback(); } });
  res.set = res.type = res.attachment = () => res;
  await assert.rejects(sendReportDownload(report, 'pdf', res), error => error.name === 'AbortError');
  assert.ok(res.destroyed);
});
