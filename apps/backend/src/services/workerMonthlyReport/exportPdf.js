import { jsPDF } from 'jspdf';
import { ReportInputError } from './filters.js';
import { SOURCE_DISCLOSURE } from './exportCommon.js';
import { workerCalendar, calendarWeight, calendarCones, calendarDate } from './calendar.js';

// Core Helvetica uses WinAnsi. Fail explicitly instead of silently corrupting
// labels outside its repertoire; the Unicode XLSX export remains available.
export function assertPdfLabels(statement) {
  const strings = [statement.worker.name, statement.worker.reference,
    ...statement.rows.map(row => row.quality.yarn.label)];
  if (strings.some(value => /[^\x20-\x7e\xa0-\xff\n\r\t€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/u.test(String(value)))) {
    throw new ReportInputError('PDF font cannot display one or more recorded labels. Download Excel to preserve those labels.');
  }
}

export function exportWorkerPdf(statement) {
  assertPdfLabels(statement);
  const calendar = workerCalendar(statement, statement.month);
  // Standard A4 for small yarn sets; wider paper keeps large sets legible on one page.
  const pageWidth = calendar.columns.length <= 5 ? 210 : Math.max(420, 88 + calendar.columns.length * 15);
  const doc = new jsPDF({ unit: 'mm', format: [pageWidth, 297], orientation: pageWidth > 297 ? 'landscape' : 'portrait', compress: true });
  doc.setProperties({ title: statement.title, author: statement.companyName, subject: `${statement.month} / ${statement.worker.reference}` });
  const left = 12, width = pageWidth - 24;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(`${statement.companyName} / CONING`, left, 15);
  doc.setFontSize(18);
  const nameLines = doc.splitTextToSize(statement.worker.name, width);
  doc.text(nameLines, left, 24);
  let y = 26 + nameLines.length * 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Monthly work report / ${statement.month} / ${calendar.workedDays} days with work recorded`, left, y);
  y += 6;
  doc.setFontSize(8);
  doc.text('Yarn columns show weight in kg. A dash (-) means no work recorded.', left, y);
  y += 5;
  const widths = [27, ...calendar.columns.map(() => (width - 71) / calendar.columns.length), 22, 22];
  const headers = ['Date', ...calendar.columns.map(column => `${column.label} (kg)`), 'Total cones', 'Total kg'];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  const lines = headers.map((text, index) => doc.splitTextToSize(text, widths[index] - 4));
  const headerHeight = Math.max(11, ...lines.map(value => value.length * 3.7 + 5));
  // Reserve real space for the yarn-quality weight summary below the calendar.
  const summaryWidth = (width - 8) / 2;
  doc.setFontSize(9);
  const summary = calendar.columns.map(column => ({
    lines: doc.splitTextToSize(column.label, summaryWidth - 27), weight: calendarWeight(column.totals),
  }));
  const summaryRows = [];
  for (let i = 0; i < summary.length; i += 2) {
    const cells = summary.slice(i, i + 2);
    summaryRows.push({ cells, height: Math.max(...cells.map(cell => cell.lines.length)) * 3.7 + 3 });
  }
  const summaryHeight = 15 + summaryRows.reduce((sum, row) => sum + row.height, 0);
  const rowHeight = Math.min(4.8, (272 - y - headerHeight - summaryHeight) / (calendar.days.length + 1));
  if (rowHeight < 4) throw new ReportInputError('Yarn labels are too long for a readable single-page PDF. Download Excel to preserve all labels.');
  function drawRow(cells, height, { header = false, total = false, blank = false } = {}) {
    doc.setFillColor(...(header ? [230, 235, 241] : total ? [237, 240, 244] : blank ? [249, 249, 249] : [255, 255, 255]));
    doc.rect(left, y, width, height, 'F');
    doc.setDrawColor(195); doc.setLineWidth(0.15);
    doc.setTextColor(30); doc.setFont('helvetica', header || total ? 'bold' : 'normal'); doc.setFontSize(9);
    let x = left;
    cells.forEach((value, index) => {
      doc.rect(x, y, widths[index], height);
      if (header) doc.text(value, x + widths[index] / 2, y + 4, { align: 'center', lineHeightFactor: 1.16 });
      else doc.text(String(value), index === 0 ? x + 2 : x + widths[index] - 2, y + height / 2 + 1.1, { align: index === 0 ? 'left' : 'right' });
      x += widths[index];
    });
    y += height;
  }
  drawRow(lines, headerHeight, { header: true });
  for (const day of calendar.days) drawRow([calendarDate(day.date), ...day.cells.map(calendarWeight), calendarCones(day.totals), calendarWeight(day.totals)], rowHeight, { blank: !day.totals });
  drawRow(['Total', ...calendar.columns.map(column => calendarWeight(column.totals)), calendarCones(calendar.totals), calendarWeight(calendar.totals)], rowHeight, { total: true });
  y += 9;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Yarn-wise total weight', left, y);
  y += 3;
  for (const row of summaryRows) {
    row.cells.forEach((cell, index) => {
      const x = left + index * (summaryWidth + 8);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(cell.lines, x, y + 4, { lineHeightFactor: 1.16 });
      doc.setFont('helvetica', 'bold');
      doc.text(`${cell.weight} kg`, x + summaryWidth, y + 4, { align: 'right' });
      doc.setDrawColor(210); doc.line(x, y + row.height, x + summaryWidth, y + row.height);
    });
    y += row.height;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  if (!calendar.totals.weightComplete || !calendar.totals.conesComplete) doc.text('? = quantity not recorded. * = total includes known quantities only.', left, y + 5);
  doc.text(SOURCE_DISCLOSURE, left, 283);
  doc.text(`Worker reference: ${statement.worker.reference} / Generated: ${statement.generatedAt}`, left, 288);
  return Buffer.from(doc.output('arraybuffer'));
}
