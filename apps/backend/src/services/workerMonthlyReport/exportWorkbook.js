import XLSX from 'xlsx';
import { workerCalendar, calendarDate } from './calendar.js';
import { qualityText, completenessText, periodText, SOURCE_DISCLOSURE } from './exportCommon.js';

export function exportWorkerWorkbook(statement, officeDetails = []) {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: statement.title, Author: statement.companyName, CreatedDate: new Date(statement.generatedAt) };
  const header = [
    [statement.title], [statement.companyName], ['Worker', statement.worker.name], ['Worker reference', statement.worker.reference],
    ['Process', 'Coning'], ['Period', periodText(statement)], ['Generated', statement.generatedAt], [SOURCE_DISCLOSURE],
    [completenessText(statement.monthlyTotals)], [],
  ];
  function sheet(name, rows, widths, numericColumns, firstDataRow, kgColumn) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(wch => ({ wch }));
    ws['!rows'] = rows.map((row, index) => ({ hpt: index < 10 ? (index === 8 ? 32 : 20) : Math.min(409, Math.max(20, ...row.map((value, i) => String(value ?? '').split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / (widths[i] * 0.85))), 0) * 16 + 10))) }));
    ws['!merges'] = [0, 1, 7, 8].map(r => ({ s: { r, c: 0 }, e: { r, c: widths.length - 1 } }));
    for (let r = 2; r <= 6; r++) ws['!merges'].push({ s: { r, c: 1 }, e: { r, c: widths.length - 1 } });
    for (let r = firstDataRow; r < rows.length; r++) {
      for (const c of numericColumns) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === 'n') cell.z = c === kgColumn ? '0.000' : '0';
      }
    }
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ r: firstDataRow - 1, c: 0 }, { r: rows.length - 1, c: widths.length - 1 }) };
    XLSX.utils.book_append_sheet(workbook, ws, name);
  }
  const calendar = workerCalendar(statement, statement.month);
  const weight = total => !total ? '-' : total.unknownWeightRows === total.rowCount ? '?' : total.netKg;
  const rows = [
    [statement.companyName, 'Monthly work report'],
    ['Worker', statement.worker.name], ['Month', statement.month],
    ['Yarn columns show weight in kg. A dash (-) means no work recorded.'],
    ['Date', ...calendar.columns.map(column => `${column.label} (kg)`), 'Total cones', 'Total kg'],
    ...calendar.days.map(day => [calendarDate(day.date), ...day.cells.map(weight), day.totals?.cones ?? '-', weight(day.totals)]),
    ['Total', ...calendar.columns.map(column => weight(column.totals)), calendar.totals.cones, weight(calendar.totals)],
    [completenessText(calendar.totals)],
    ['? = quantity not recorded. Incomplete totals include known quantities only.'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const count = calendar.columns.length + 3;
  ws['!cols'] = [{ wch: 14 }, ...calendar.columns.map(() => ({ wch: 23 })), { wch: 14 }, { wch: 14 }];
  ws['!rows'] = rows.map((_, index) => ({ hpt: index === 4 ? Math.max(32, ...calendar.columns.map(column => Math.ceil((column.label.length + 5) / 20) * 12)) : 18 }));
  ws['!merges'] = [1, 2].map(r => ({ s: { r, c: 1 }, e: { r, c: count - 1 } }));
  for (const r of [3, rows.length - 2, rows.length - 1]) ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: count - 1 } });
  for (let r = 5; r < rows.length - 2; r++) for (let c = 1; c < count; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell?.t === 'n') cell.z = c === count - 2 ? '0' : '0.000';
    const total = r === rows.length - 3 ? (c <= calendar.columns.length ? calendar.columns[c - 1].totals : calendar.totals) :
      (c <= calendar.columns.length ? calendar.days[r - 5].cells[c - 1] : calendar.days[r - 5].totals);
    if (cell?.t === 'n' && total && !(c === count - 2 ? total.conesComplete : total.weightComplete)) cell.z += '"*"';
  }
  const summaryStart = rows.length + 1;
  const summaryRows = [['Yarn-wise total weight', ...Array(count - 2).fill(null), 'Total kg'], ...calendar.columns.map(column => [column.label, ...Array(count - 2).fill(null), weight(column.totals)])];
  XLSX.utils.sheet_add_aoa(ws, summaryRows, { origin: { r: summaryStart, c: 0 } });
  summaryRows.forEach((row, index) => {
    ws['!rows'][summaryStart + index] = { hpt: Math.max(20, Math.ceil(String(row[0]).length / 40) * 14) };
    ws['!merges'].push({ s: { r: summaryStart + index, c: 0 }, e: { r: summaryStart + index, c: count - 2 } });
    const cell = ws[XLSX.utils.encode_cell({ r: summaryStart + index, c: count - 1 })];
    if (cell?.t === 'n') cell.z = calendar.columns[index - 1].totals.weightComplete ? '0.000' : '0.000"*"';
  });
  XLSX.utils.book_append_sheet(workbook, ws, 'Monthly Work');
  // Explicit whitelist plus worker filter prevents bulk-report privacy leakage.
  const refs = officeDetails.filter(row => row.workerId === statement.worker.id).map(row => [row.date, row.receiveRowId, row.issueId,
    row.lotNo, row.receiveBarcode, row.issueBarcode, row.machine.name, qualityText(row.quality), row.cones, row.netKg,
    row.weightSource, JSON.stringify(row.provenance), row.flags.join(', ')]);
  sheet('Office References', [...header, ['Date', 'Receive row ID', 'Issue ID', 'Lot', 'Receive barcode', 'Issue barcode', 'Machine',
    'Quality details', 'Cones', 'Net kg', 'Weight source', 'Quality provenance', 'Data-quality flags'], ...refs],
  [16, 40, 40, 24, 30, 30, 30, 95, 16, 18, 25, 100, 65], [8, 9], 11, 9);
  // SheetJS CE preserves numeric types/formats but does not author alignment.
  // Add wrap/top alignment to its generated OOXML styles using its public CFB
  // ZIP API; no new runtime dependency or machine-local office application.
  const zip = XLSX.CFB.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const styles = XLSX.CFB.find(zip, '/xl/styles.xml');
  const xml = Buffer.from(styles.content).toString('utf8').replace(/<cellXfs([^>]*)>([\s\S]*?)<\/cellXfs>/, (_all, attrs, body) =>
    `<cellXfs${attrs}>${body.replace(/<xf([^>]*?)\/>/g, '<xf$1 applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>').replace(/<xf([^>]*?)>(?!<alignment)([\s\S]*?)<\/xf>/g, '<xf$1>$2<alignment wrapText="1" vertical="top"/></xf>')}</cellXfs>`);
  XLSX.CFB.utils.cfb_add(zip, '/xl/styles.xml', Buffer.from(xml));
  const calendarSheet = XLSX.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const sheetXml = Buffer.from(calendarSheet.content).toString('utf8')
    .replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
    .replace('</worksheet>', '<pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/></worksheet>');
  XLSX.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', Buffer.from(sheetXml));
  return XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true });
}
