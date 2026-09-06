import archiver from 'archiver';
import { once } from 'node:events';
import { toWorkerStatement } from './service.js';
import { ReportInputError } from './filters.js';
import { workerFilename } from './exportCommon.js';
import { assertPdfLabels, exportWorkerPdf } from './exportPdf.js';
import { exportWorkerWorkbook } from './exportWorkbook.js';

export async function sendReportDownload(report, format, res) {
  if (!['pdf', 'xlsx'].includes(format)) throw new ReportInputError('Unsupported export format');
  if (!report.statements.length) throw new ReportInputError('No qualifying work for the selected filters');
  // Validate all labels before starting a response, including a bulk archive.
  if (format === 'pdf') report.statements.forEach(statement => assertPdfLabels(toWorkerStatement(report, statement.worker.id)));
  const render = statement => format === 'pdf' ? exportWorkerPdf(statement) : exportWorkerWorkbook(statement, report.office.details);
  res.set('Cache-Control', 'no-store');
  res.set('X-Report-Generated-At', report.generatedAt);
  res.set('Access-Control-Expose-Headers', 'Content-Disposition, X-Report-Generated-At');
  res.set('X-Content-Type-Options', 'nosniff');
  if (report.workerId !== 'all') {
    const statement = toWorkerStatement(report, report.workerId);
    const buffer = render(statement);
    res.attachment(workerFilename(statement, format));
    res.type(format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    return;
  }
  res.attachment(`coning-${report.month}-all-workers-${format}.zip`);
  res.type('application/zip');
  const archive = archiver('zip', { zlib: { level: 6 } });
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) { archive.abort(); controller.abort(); } };
  const onError = error => res.destroy(error);
  res.once('close', onClose);
  archive.on('error', onError);
  archive.pipe(res);
  try {
    // Wait for each entry before rendering the next; do not buffer an entire
    // month's PDFs/workbooks. Archiver and the response supply backpressure.
    for (const entry of report.statements) {
      if (res.destroyed) return;
      const statement = toWorkerStatement(report, entry.worker.id);
      const buffer = render(statement);
      const completed = once(archive, 'entry', { signal: controller.signal });
      archive.append(buffer, { name: workerFilename(statement, format), date: new Date(report.generatedAt) });
      await completed;
    }
    await archive.finalize();
  } finally {
    res.off('close', onClose);
  }
}
