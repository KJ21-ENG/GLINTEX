import XLSX from 'xlsx';
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
  const totals = total => [total.cones, total.netKg, completenessText(total)];
  sheet('Summary', [...header, ['Quality details', 'Cones', 'Net kg', 'Completeness'],
    ...statement.qualitySummary.map(group => [qualityText(group.quality), ...totals(group.totals)]),
    ['Monthly total', ...totals(statement.monthlyTotals)]], [95, 16, 18, 65], [1, 2], 11, 2);
  const days = new Map(statement.dailyTotals.map(day => [day.date, day.totals]));
  const daily = [];
  statement.rows.forEach((row, i) => {
    daily.push([row.date, qualityText(row.quality), row.machine.name, row.cones, row.netKg, row.netKg == null ? 'Unknown weight' : '']);
    if (statement.rows[i + 1]?.date !== row.date) daily.push([row.date, 'Daily subtotal', '', ...totals(days.get(row.date))]);
  });
  sheet('Daily Details', [...header, ['Date', 'Quality details', 'Machine', 'Cones', 'Net kg', 'Completeness'], ...daily,
    ['', 'Monthly total', '', ...totals(statement.monthlyTotals)]], [16, 95, 30, 16, 18, 65], [3, 4], 11, 4);
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
  return XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true });
}
