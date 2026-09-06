import { jsPDF } from 'jspdf';
import { ReportInputError } from './filters.js';
import { qualityText, quantityText, totalText, completenessText, periodText, SOURCE_DISCLOSURE } from './exportCommon.js';

// Core Helvetica uses WinAnsi. Fail explicitly instead of silently corrupting
// labels outside its repertoire; the Unicode XLSX export remains available.
export function assertPdfLabels(statement) {
  const strings = [statement.worker.name, statement.worker.reference,
    ...statement.rows.flatMap(row => [row.machine.name, qualityText(row.quality)])];
  if (strings.some(value => /[^\x20-\x7e\xa0-\xff\n\r\t€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/u.test(String(value)))) {
    throw new ReportInputError('PDF font cannot display one or more recorded labels. Download Excel to preserve those labels.');
  }
}

export function exportWorkerPdf(statement) {
  assertPdfLabels(statement);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: statement.title, author: statement.companyName, subject: `${statement.month} / ${statement.worker.reference}` });
  const left = 12, right = 198, bottom = 274, line = 4.2;
  let y = 12;
  const wrapped = (text, width, size = 9) => { doc.setFontSize(size); return doc.splitTextToSize(String(text), width); };
  const write = (text, size = 9, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = wrapped(text, right - left, size);
    doc.text(lines, left, y); y += lines.length * (size === 15 ? 6.5 : line) + 2;
  };
  const header = () => {
    y = 12;
    write(statement.companyName, 10, true);
    write(statement.title, 15, true);
    write(`Worker: ${statement.worker.name}`, 10, true);
    write(`Worker reference: ${statement.worker.reference}`, 8);
    write(`Process: Coning | ${periodText(statement)}`, 8);
    write(`Generated: ${statement.generatedAt}`, 8);
    doc.setDrawColor(160); doc.line(left, y - 1, right, y - 1); y += 3;
  };
  header();
  function table(title, headings, widths, rows) {
    const sectionHeader = () => {
      write(title, 11, true);
      doc.setFillColor(231, 237, 247); doc.rect(left, y - 3.5, right - left, 8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      let x = left;
      headings.forEach((heading, i) => { doc.text(heading, x + 2, y + 1); x += widths[i]; });
      y += 9;
    };
    const newPage = () => { doc.addPage(); header(); sectionHeader(); };
    if (y + 35 > bottom) { doc.addPage(); header(); }
    sectionHeader();
    rows.forEach((row, rowIndex) => {
      doc.setFont('helvetica', row.total ? 'bold' : 'normal');
      const cells = row.cells.map((text, i) => wrapped(text, widths[i] - 4));
      let remaining = Math.max(...cells.map(cell => cell.length));
      let offset = 0;
      const nextIsTotal = rows[rowIndex + 1]?.total;
      // Keep a subtotal with the final detail row (or its final continuation).
      const reserve = nextIsTotal ? 12 : 0;
      if (y + Math.min(remaining * line + 4, 100) + reserve > bottom) newPage();
      while (remaining > 0) {
        let available = Math.floor((bottom - y - 4 - reserve) / line);
        if (available < 1) { newPage(); available = Math.floor((bottom - y - 4 - reserve) / line); }
        const count = Math.min(remaining, available);
        const height = count * line + 4;
        doc.setFont('helvetica', row.total ? 'bold' : 'normal'); doc.setFontSize(9);
        if (row.total) { doc.setFillColor(242, 244, 247); doc.rect(left, y - 3, right - left, height, 'F'); }
        let x = left;
        cells.forEach((cell, i) => {
          const chunk = cell.slice(offset, offset + count);
          if (chunk.length) doc.text(chunk, x + 2, y + 1, { lineHeightFactor: 1.323 });
          x += widths[i];
        });
        y += height; doc.setDrawColor(220); doc.line(left, y - 3, right, y - 3);
        remaining -= count; offset += count;
        if (remaining > 0) newPage();
      }
    });
    y += 5;
  }
  const summary = statement.qualitySummary.map(group => ({ cells: [qualityText(group.quality), totalText(group.totals), totalText(group.totals, true)] }));
  summary.push({ total: true, cells: ['Monthly total', totalText(statement.monthlyTotals), totalText(statement.monthlyTotals, true)] });
  table('Monthly quality summary', ['Quality details', 'Cones', 'Net kg'], [140, 22, 24], summary);
  const daily = new Map(statement.dailyTotals.map(day => [day.date, day.totals]));
  const ledger = [];
  statement.rows.forEach((row, i) => {
    ledger.push({ cells: [row.date, qualityText(row.quality), row.machine.name, quantityText(row.cones), quantityText(row.netKg, true)] });
    if (statement.rows[i + 1]?.date !== row.date) ledger.push({ total: true, cells: [row.date, 'Daily subtotal', '', totalText(daily.get(row.date)), totalText(daily.get(row.date), true)] });
  });
  ledger.push({ total: true, cells: ['', 'Monthly total', '', totalText(statement.monthlyTotals), totalText(statement.monthlyTotals, true)] });
  table('Date-wise work ledger', ['Date', 'Quality details', 'Machine', 'Cones', 'Net kg'], [24, 94, 28, 18, 22], ledger);
  if (y + 22 > bottom) { doc.addPage(); header(); }
  write(completenessText(statement.monthlyTotals), 9);
  if (!statement.monthlyTotals.weightComplete || !statement.monthlyTotals.conesComplete) write('* Known subtotal; unknown quantities are not zero.', 9);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(SOURCE_DISCLOSURE, left, 282);
    doc.text(`Page ${page} of ${pages}`, right, 289, { align: 'right' });
  }
  return Buffer.from(doc.output('arraybuffer'));
}
