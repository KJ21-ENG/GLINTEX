import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import prisma from '../../../lib/prisma.js';
import { createWorkerMonthlyReportRouter } from '../../../routes/workerMonthlyReport.js';
import { normalizeReport } from '../service.js';
import { validateFilters } from '../filters.js';
import { row, sources } from './fixtures.js';

// The real auth/permission middleware executes against an in-memory session
// lookup. No production or local database is opened or mutated by this suite.
test('every read route enforces real authentication and reports READ, and rejects unsupported filters', async () => {
  const original = prisma.userSession.findUnique;
  let permissions = {};
  let sourceReads = 0;
  prisma.userSession.findUnique = async () => ({ id: 'session', expiresAt: new Date('2099-01-01'),
    user: { id: 'office', isActive: true, roles: [{ role: { id: 'role', key: 'staff', name: 'Staff', permissions } }] } });
  const app = express();
  app.use('/report', createWorkerMonthlyReportRouter({ buildReport: async (_client, input) => {
    sourceReads++;
    const filters = validateFilters(input, new Date('2026-09-06T12:00Z'));
    return normalizeReport(sources([row(), row({ id: 'r2' }), row({ id: 'r3', operatorId: 'w2', operator: { id: 'w2', name: 'Other' } })]), filters);
  } }));
  try {
    for (const endpoint of ['workers', 'preview', 'details', 'exceptions']) {
      await request(app).get(`/report/${endpoint}`).expect(401);
      await request(app).get(`/report/${endpoint}`).set('Authorization', 'Bearer synthetic').expect(403);
    }
    assert.equal(sourceReads, 0);
    permissions = { reports: 1 };
    for (const endpoint of ['workers', 'preview', 'details', 'exceptions']) {
      await request(app).get(`/report/${endpoint}?month=2026-08&process=coning`).set('Authorization', 'Bearer synthetic').expect(200).expect('Cache-Control', 'no-store');
      await request(app).get(`/report/${endpoint}?process=holo`).set('Authorization', 'Bearer synthetic').expect(400);
    }
    const response = await request(app).get('/report/preview?month=2026-08&pageSize=1').set('Authorization', 'Bearer synthetic').expect(200);
    assert.equal(response.body.totalRows, 3);
    assert.equal(response.body.statements.reduce((sum, s) => sum + s.rows.length, 0), 1);
    assert.equal(response.body.statements.find(s => s.worker.id === 'w1').monthlyTotals.cones, 20);
    assert.equal(response.body.statements.find(s => s.worker.id === 'w2').monthlyTotals.cones, 10);
    const details = await request(app).get('/report/details?month=2026-08&workerId=w1&pageSize=1&page=2').set('Authorization', 'Bearer synthetic').expect(200);
    assert.equal(details.body.rows.length, 1);
    assert.equal(details.body.totalRows, 2);
    assert.equal(details.body.totals.cones, 20);
    for (const query of ['page=0', 'pageSize=501', 'page=1.5', 'month=bad', 'workerId=']) {
      await request(app).get(`/report/preview?${query}`).set('Authorization', 'Bearer synthetic').expect(400);
    }
  } finally { prisma.userSession.findUnique = original; }
});
