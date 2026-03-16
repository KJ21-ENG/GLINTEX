import {
  drawFooter,
  formatDateDDMMYYYY,
  getJsPDF,
} from './pdfHelpers.js';

const PAGE_MARGIN = 12;
const PAGE_START_Y = 16;
const TABLE_HEADER_FILL = [52, 73, 94];
const TABLE_HEADER_TEXT = [255, 255, 255];
const TABLE_BORDER = [200, 200, 200];
const TABLE_BODY_TEXT = [44, 62, 80];
const WARNING_FILL = [255, 247, 237];
const WARNING_BORDER = [251, 191, 36];
const WARNING_TEXT = [146, 64, 14];
const ALT_FILL = [248, 249, 250];
const NEGATIVE_TEXT = [220, 38, 38];

function formatWeeklyWeight(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(2)} K.G.` : '';
}

function formatWeeklyHours(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function formatWeekDayCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(1) : '0.0';
}

function buildWarningLines(warnings = []) {
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  return warnings.map((warning) => {
    const machines = Array.isArray(warning.machines) && warning.machines.length > 0
      ? warning.machines.join(', ')
      : 'Unknown machines';
    return `${formatDateDDMMYYYY(warning.date)}: ${machines}`;
  });
}

function drawHeader(doc, { from, to, pageWidth }) {
  let y = 10;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TABLE_BODY_TEXT);
  doc.text('GLINTEX', pageWidth / 2, y, { align: 'center' });
  y += 5.5;

  doc.setFontSize(11.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Holo Weekly Production Sheet', pageWidth / 2, y, { align: 'center' });
  y += 4.8;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Range: ${formatDateDDMMYYYY(from)} to ${formatDateDDMMYYYY(to)}`, pageWidth / 2, y, { align: 'center' });
  y += 3.6;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
  return y + 5;
}

function drawWarnings(doc, { y, warnings, pageWidth }) {
  const warningLines = buildWarningLines(warnings);
  if (warningLines.length === 0) return y;

  const contentWidth = pageWidth - (PAGE_MARGIN * 2) - 4;
  const wrapped = [];
  warningLines.forEach((line) => {
    wrapped.push(...doc.splitTextToSize(line, contentWidth));
  });
  const height = 10 + (wrapped.length * 4);

  doc.setDrawColor(...WARNING_BORDER);
  doc.setFillColor(...WARNING_FILL);
  doc.roundedRect(PAGE_MARGIN, y, pageWidth - (PAGE_MARGIN * 2), height, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WARNING_TEXT);
  doc.text('Missing daily metrics were treated as 0 for the following dates/machines:', PAGE_MARGIN + 2, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  wrapped.forEach((line, index) => {
    doc.text(line, PAGE_MARGIN + 2, y + 10 + (index * 4));
  });

  return y + height + 4;
}

function drawFooterOnAllPages(doc, pageHeight) {
  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawFooter(doc, pageHeight);
  }
  doc.setPage(pageCount);
}

function drawTableHeader(doc, { x, y, widths, headers }) {
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  doc.setFillColor(...TABLE_HEADER_FILL);
  doc.rect(x, y, totalWidth, 8, 'F');

  let currentX = x;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TABLE_HEADER_TEXT);
  headers.forEach((header, index) => {
    const width = widths[index];
    const align = header.align || 'left';
    const textX = align === 'right'
      ? currentX + width - 2
      : align === 'center'
        ? currentX + (width / 2)
        : currentX + 2;
    doc.text(header.label, textX, y + 5, { align });
    currentX += width;
  });

  return y + 8;
}

export async function createHoloWeeklyExportPdfDocument(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableX = PAGE_MARGIN;
  const widths = [26, 34, 28, 18, 34, 24, 34, 34];
  const headers = [
    { label: 'Machine', align: 'left' },
    { label: 'Total Production', align: 'right' },
    { label: 'Total Hours', align: 'right' },
    { label: 'Day', align: 'right' },
    { label: 'Average Production', align: 'center' },
    { label: 'Daily Hours', align: 'center' },
    { label: 'Ideal Production', align: 'center' },
    { label: 'Difference', align: 'center' },
  ];

  let y = drawHeader(doc, { from: data.from, to: data.to, pageWidth });
  y = drawWarnings(doc, { y, warnings: data.warnings, pageWidth });
  y = drawTableHeader(doc, { x: tableX, y, widths, headers });

  const drawBorders = (topY, height) => {
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    doc.setDrawColor(...TABLE_BORDER);
    doc.setLineWidth(0.2);
    doc.rect(tableX, topY, totalWidth, height);
    let currentX = tableX;
    for (let i = 0; i < widths.length - 1; i += 1) {
      currentX += widths[i];
      doc.line(currentX, topY, currentX, topY + height);
    }
  };

  let tableTopY = y - 8;
  let tableHeight = 8;

  (data.rows || []).forEach((row, index) => {
    if (y + 7 > pageHeight - 12) {
      drawBorders(tableTopY, tableHeight);
      doc.addPage();
      y = PAGE_START_Y;
      y = drawTableHeader(doc, { x: tableX, y, widths, headers });
      tableTopY = y - 8;
      tableHeight = 8;
    }

    if (index % 2 === 0) {
      doc.setFillColor(...ALT_FILL);
      doc.rect(tableX, y, widths.reduce((sum, width) => sum + width, 0), 7, 'F');
    }

    const cells = [
      { text: row.baseMachine || '—', align: 'left', color: TABLE_BODY_TEXT },
      { text: formatWeeklyWeight(row.totalProduction), align: 'right', color: TABLE_BODY_TEXT },
      { text: formatWeeklyHours(row.totalHours), align: 'right', color: TABLE_BODY_TEXT },
      { text: formatWeekDayCount(row.dayCount), align: 'right', color: TABLE_BODY_TEXT },
      { text: typeof row.averageProductionDisplay === 'string' ? row.averageProductionDisplay : formatWeeklyWeight(row.averageProductionDisplay), align: 'center', color: TABLE_BODY_TEXT },
      { text: String(row.dailyHours || 0), align: 'center', color: TABLE_BODY_TEXT },
      { text: formatWeeklyWeight(row.idealProduction), align: 'center', color: row.highlightShortfall ? NEGATIVE_TEXT : TABLE_BODY_TEXT },
      { text: formatWeeklyWeight(row.difference), align: 'center', color: row.highlightShortfall ? NEGATIVE_TEXT : TABLE_BODY_TEXT },
    ];

    let currentX = tableX;
    doc.setFontSize(8);
    cells.forEach((cell, cellIndex) => {
      const width = widths[cellIndex];
      const align = cell.align || 'left';
      const textX = align === 'right'
        ? currentX + width - 2
        : align === 'center'
          ? currentX + (width / 2)
          : currentX + 2;
      doc.setTextColor(...cell.color);
      doc.text(String(cell.text || ''), textX, y + 4.6, { align });
      currentX += width;
    });

    doc.setDrawColor(...TABLE_BORDER);
    doc.setLineWidth(0.2);
    doc.line(tableX, y + 7, tableX + widths.reduce((sum, width) => sum + width, 0), y + 7);
    y += 7;
    tableHeight += 7;
  });

  drawBorders(tableTopY, tableHeight);
  drawFooterOnAllPages(doc, pageHeight);
  return doc;
}

export async function generateHoloWeeklyExportPdf(data) {
  const doc = await createHoloWeeklyExportPdfDocument(data);
  return Buffer.from(doc.output('arraybuffer'));
}

export default {
  createHoloWeeklyExportPdfDocument,
  generateHoloWeeklyExportPdf,
};
