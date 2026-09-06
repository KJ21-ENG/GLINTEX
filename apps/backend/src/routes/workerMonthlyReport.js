import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import { buildWorkerMonthlyReport } from '../services/workerMonthlyReport/service.js';
import { sendReportDownload } from '../services/workerMonthlyReport/exportDownload.js';
import { ReportInputError } from '../services/workerMonthlyReport/filters.js';

function pagination(query) {
  const read = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) throw new ReportInputError('Invalid page or pageSize');
    return Number(value);
  };
  return { page: read(query.page, 1, 1000000), pageSize: read(query.pageSize, 100, 500) };
}

export function createWorkerMonthlyReportRouter({ client = prisma, authenticate = requireAuth, buildReport = buildWorkerMonthlyReport } = {}) {
  const router = Router();
  router.use(authenticate, requirePermission('reports', ACCESS_LEVELS.READ));
  for (const endpoint of ['workers', 'preview', 'details', 'exceptions']) {
    router.get(`/${endpoint}`, async (req, res, next) => {
      try {
        const { page, pageSize } = pagination(req.query);
        const report = await buildReport(client, { month: req.query.month, process: req.query.process,
          workerId: endpoint === 'workers' ? 'all' : req.query.workerId });
        const meta = { process: report.process, month: report.month, workerId: report.workerId, period: report.period, generatedAt: report.generatedAt };
        res.set('Cache-Control', 'no-store');
        if (endpoint === 'workers') return res.json({ ...meta, workers: report.workerOptions });
        if (endpoint === 'exceptions') return res.json({ ...meta, exceptions: report.office.exceptions,
          unassignedPeriodExceptions: report.office.unassignedPeriodExceptions, excluded: report.office.excluded,
          exceptionTotals: report.office.exceptionTotals, excludedTotals: report.office.excludedTotals });
        const rows = report.office.details;
        const paged = rows.slice((page - 1) * pageSize, page * pageSize);
        if (endpoint === 'details') return res.json({ ...meta, rows: paged, page, pageSize, totalRows: rows.length, totals: report.office.selectedTotals });
        // Paginate ledgers only; every worker's summaries always use full rows.
        let offset = 0;
        const statements = report.statements.map(statement => {
          const begin = offset;
          offset += statement.rows.length;
          const start = Math.max(0, (page - 1) * pageSize - begin);
          const end = Math.max(0, Math.min(statement.rows.length, page * pageSize - begin));
          return { ...statement, rows: statement.rows.slice(start, end), totalRows: statement.rows.length };
        });
        return res.json({ ...meta, workers: report.workerOptions, statements, page, pageSize, totalRows: rows.length,
          office: { totals: report.office.totals, selectedTotals: report.office.selectedTotals, reconciliation: report.office.reconciliation,
            exceptionCount: report.office.exceptions.length, unassignedPeriodExceptionCount: report.office.unassignedPeriodExceptions.length,
            excludedCount: report.office.excluded.length } });
      } catch (error) {
        if (error.status === 400) return res.status(400).json({ error: error.message });
        next(error);
      }
    });
  }
  for (const format of ['pdf', 'xlsx']) {
    router.get(`/download/${format}`, async (req, res, next) => {
      try {
        const report = await buildReport(client, { month: req.query.month, process: req.query.process, workerId: req.query.workerId });
        await sendReportDownload(report, format, res);
      } catch (error) {
        if (res.headersSent) return res.destroy(error);
        if (error.status === 400) return res.status(400).json({ error: error.message });
        next(error);
      }
    });
  }
  return router;
}
export default createWorkerMonthlyReportRouter();
