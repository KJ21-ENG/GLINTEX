import {
  drawFooter,
  getJsPDF,
} from './pdfHelpers.js';

function pdfText(value, fallback = '-') {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text ? text.slice(0, 180) : fallback;
}

export function formatDispatchPdfNumber(value, decimals = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(decimals);
}

function drawCell(doc, text, x, y, width, height, { bold = false, align = 'left' } = {}) {
  doc.rect(x, y, width, height);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(8);
  const lines = doc.splitTextToSize(pdfText(text), width - 4).slice(0, 3);
  const lineHeight = 3.4;
  const startY = y + Math.min(height - lineHeight, (height - (lines.length * lineHeight)) / 2 + lineHeight);
  lines.forEach((line, index) => {
    const lineWidth = doc.getTextWidth(line);
    const textX = align === 'right' ? x + width - 2 - lineWidth : align === 'center' ? x + (width - lineWidth) / 2 : x + 2;
    doc.text(line, textX, startY + index * lineHeight);
  });
}

function drawHeader(doc, snapshot, pageWidth) {
  const company = snapshot?.companySnapshot || {};
  const customer = snapshot?.customerSnapshot || {};
  doc.setFillColor(25, 48, 79);
  doc.rect(0, 0, pageWidth, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(pdfText(company.name, 'GLINTEX'), 14, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Dispatch Challan', 14, 18);
  doc.setFontSize(8);
  doc.text(`Challan: ${pdfText(snapshot?.challanNo)}`, pageWidth - 14, 10, { align: 'right' });
  doc.text(`Business date: ${pdfText(snapshot?.businessDate)}`, pageWidth - 14, 16, { align: 'right' });
  doc.text(`Customer: ${pdfText(customer.name)}`, pageWidth - 14, 22, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

export async function generateDispatchChallanPdf(snapshot = {}) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const columns = [
    { label: 'S.No', width: 12, align: 'center' },
    { label: 'Item', width: 48, align: 'left' },
    { label: 'Barcode', width: 58, align: 'left' },
    { label: 'Package', width: 28, align: 'left' },
    { label: 'Base count', width: 24, align: 'right' },
    { label: 'Net weight (kg)', width: 32, align: 'right' },
    { label: 'Source', width: pageWidth - (margin * 2) - 202, align: 'left' },
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const rows = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  let y = 32;
  drawHeader(doc, snapshot, pageWidth);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Address: ${pdfText(snapshot?.companySnapshot?.address, '—')}`, margin, y);
  doc.text(`Phone: ${pdfText(snapshot?.companySnapshot?.phone, '—')}`, pageWidth - margin, y, { align: 'right' });
  y += 7;

  const drawTableHeader = () => {
    let x = margin;
    columns.forEach((column) => {
      drawCell(doc, column.label, x, y, column.width, 8, { bold: true, align: column.align });
      x += column.width;
    });
    y += 8;
  };

  drawTableHeader();
  rows.forEach((line, index) => {
    const item = line.sourceDisplaySnapshot?.itemName || line.sourceDisplaySnapshot?.item?.name || line.itemName;
    const packageKind = line.sourceDisplaySnapshot?.packageKind || line.sourceDisplaySnapshot?.packageType?.kind || line.packageKind || line.sourceType;
    const rowValues = [
      index + 1,
      item,
      line.sourceBarcode || line.sourceDisplaySnapshot?.barcode,
      packageKind,
      line.baseCount === null || line.baseCount === undefined ? '-' : formatDispatchPdfNumber(line.baseCount, 0),
      formatDispatchPdfNumber(line.netWeightKg),
      line.parentPackedUnitId ? `PACKED/${line.parentPackedUnitId}` : line.sourceType,
    ];
    let x = margin;
    const rowHeight = 10;
    if (y + rowHeight > pageHeight - 16) {
      doc.addPage();
      drawHeader(doc, snapshot, pageWidth);
      y = 32;
      drawTableHeader();
    }
    columns.forEach((column, columnIndex) => {
      drawCell(doc, rowValues[columnIndex], x, y, column.width, rowHeight, { align: column.align });
      x += column.width;
    });
    y += rowHeight;
  });

  if (!rows.length) {
    drawCell(doc, 'No Dispatch lines', margin, y, tableWidth, 10, { align: 'center' });
    y += 10;
  }
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const notes = doc.splitTextToSize(`Notes: ${pdfText(snapshot.notes, '—')}`, tableWidth);
  doc.text(notes, margin, y);
  drawFooter(doc, pageHeight);
  return Buffer.from(doc.output('arraybuffer'));
}
