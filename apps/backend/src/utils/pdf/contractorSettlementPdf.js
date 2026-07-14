/**
 * Contractor Settlement PDF
 * Contractor/process/period, quality & Side summary, adjustments,
 * final payable, and payment reference.
 */

import { getJsPDF, formatDateDDMMYYYY, formatWeight, drawTable, drawFooter } from './pdfHelpers.js';

function money(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function titleCase(str) {
  if (!str) return '';
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}

const ADJUSTMENT_LABELS = {
  bonus: 'Bonus',
  advance_recovery: 'Advance Recovery',
  deduction: 'Deduction',
  other: 'Other',
};

// Quality label for a line/group depending on process.
function qualityLabel(process, item) {
  if (process === 'cutter') return item.itemName || '-';
  if (process === 'holo') {
    return [item.yarnName, item.twistName].filter(Boolean).join(' / ') || '-';
  }
  const parts = [item.yarnName, item.twistName].filter(Boolean).join(' / ');
  const cone = item.coneTypeName ? ` · Cone:${item.coneTypeName}` : '';
  return (parts + cone) || '-';
}

function sideLabel(side) {
  if (side === 'SINGLE') return 'S/S';
  if (side === 'BOTH') return 'B/S';
  return '-';
}

// Group lines by quality combination AND rate version for the summary
// breakdown, so a group that spans a rate change is split into separate rows
// where displayed Rate × Net KG reconciles with the displayed Amount.
export function groupLines(process, lines) {
  const map = new Map();
  for (const l of lines) {
    const key = [l.itemId, l.yarnId, l.cutId, l.twistId, l.side, l.coneTypeId, l.ratePerKg].join('|');
    const existing = map.get(key) || {
      itemName: l.itemName, yarnName: l.yarnName, cutName: l.cutName, twistName: l.twistName, side: l.side,
      coneTypeName: l.coneTypeName, ratePerKg: l.ratePerKg, netKg: 0, amount: 0, rows: 0,
    };
    existing.netKg += Number(l.netKg || 0);
    existing.amount += Number(l.amount || 0);
    existing.rows += 1;
    map.set(key, existing);
  }
  return Array.from(map.values());
}

function fitText(doc, value, maxWidth) {
  let text = String(value ?? '');
  while (doc.getTextWidth(text) > maxWidth && text.length > 3) {
    text = `${text.slice(0, -4)}...`;
  }
  return text;
}

function paymentPanelHeight(paymentLineCount, notesLineCount) {
  return Math.max(30, 11 + (paymentLineCount + notesLineCount) * 4.5);
}

function getPaymentPanelHeight(doc, settlement, pageWidth) {
  const paymentWidth = Math.round((pageWidth - 30) * 0.62);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const notesLines = settlement.paymentNotes
    ? doc.splitTextToSize(`Notes: ${settlement.paymentNotes}`, paymentWidth - 8)
    : [];
  const paymentLineCount = settlement.status === 'paid' ? 3 : 1;
  return paymentPanelHeight(paymentLineCount, notesLines.length);
}

function drawCompactHeader(doc, { settlement, process, totalKg, pageWidth }) {
  const startX = 15;
  const endX = pageWidth - 15;
  const availableWidth = endX - startX;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(44, 62, 80);
  doc.text('GLINTEX', startX, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Date: ${formatDateDDMMYYYY(settlement.paymentDate || settlement.periodTo)}`, endX, 13, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(52, 73, 94);
  doc.text(`Contractor Settlement - ${titleCase(process)}`, startX, 22);

  doc.setDrawColor(74, 126, 187);
  doc.setLineWidth(1);
  doc.line(startX, 27, endX, 27);

  const infoY = 31;
  const infoHeight = 13;
  const info = [
    ['CONTRACTOR', settlement.contractor?.name || '-'],
    ['PHONE', settlement.contractor?.phone || '-'],
    ['PROCESS', titleCase(process)],
    ['PERIOD', `${formatDateDDMMYYYY(settlement.periodFrom)} to ${formatDateDDMMYYYY(settlement.periodTo)}`],
    ['STATUS', titleCase(settlement.status) || '-'],
  ];
  const infoRatios = [0.27, 0.14, 0.16, 0.29, 0.14];
  let infoX = startX;
  doc.setFillColor(246, 248, 250);
  doc.setDrawColor(220, 225, 230);
  doc.rect(startX, infoY, availableWidth, infoHeight, 'FD');
  info.forEach(([label, value], idx) => {
    const width = availableWidth * infoRatios[idx];
    if (idx > 0) doc.line(infoX, infoY, infoX, infoY + infoHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(115, 130, 145);
    doc.text(label, infoX + 3, infoY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(44, 62, 80);
    doc.text(fitText(doc, value, width - 6), infoX + 3, infoY + 10);
    infoX += width;
  });

  const metricY = infoY + infoHeight + 4;
  const metricHeight = 11;
  const metrics = [
    ['QTY', String(Array.isArray(settlement.lines) ? settlement.lines.length : 0)],
    ['NET KG', formatWeight(totalKg)],
    ['PRODUCTION', `Rs. ${money(settlement.productionAmount)}`],
    ['FINAL PAYABLE', `Rs. ${money(settlement.finalPayable)}`],
  ];
  const metricWidth = availableWidth / metrics.length;
  doc.setFillColor(52, 73, 94);
  doc.setDrawColor(52, 73, 94);
  doc.rect(startX, metricY, availableWidth, metricHeight, 'F');
  metrics.forEach(([label, value], idx) => {
    const x = startX + idx * metricWidth;
    if (idx > 0) {
      doc.setDrawColor(105, 125, 145);
      doc.line(x, metricY + 2, x, metricY + metricHeight - 2);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(210, 220, 230);
    doc.text(label, x + 3, metricY + 4.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(fitText(doc, value, metricWidth - 6), x + 3, metricY + 9.5);
  });

  return metricY + metricHeight + 5;
}

function drawPaymentAndTotals(doc, settlement, y, pageWidth) {
  const startX = 15;
  const availableWidth = pageWidth - 30;
  const gap = 6;
  const paymentWidth = Math.round(availableWidth * 0.62);
  const totalsX = startX + paymentWidth + gap;
  const totalsWidth = availableWidth - paymentWidth - gap;
  const notesLines = settlement.paymentNotes
    ? doc.splitTextToSize(`Notes: ${settlement.paymentNotes}`, paymentWidth - 8)
    : [];
  const paymentLines = settlement.status === 'paid'
    ? [
      `Payment Date: ${formatDateDDMMYYYY(settlement.paymentDate)}`,
      `Mode: ${settlement.paymentMode || '-'}`,
      `Reference: ${settlement.paymentReference || '-'}`,
    ]
    : ['Payment Status: Not paid'];
  const panelHeight = paymentPanelHeight(paymentLines.length, notesLines.length);

  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(210, 216, 222);
  doc.rect(startX, y, paymentWidth, panelHeight, 'FD');
  doc.rect(totalsX, y, totalsWidth, panelHeight, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(44, 62, 80);
  doc.text('Payment Details', startX + 4, y + 6);
  doc.text('Settlement Totals', totalsX + 4, y + 6);

  doc.setDrawColor(220, 225, 230);
  doc.line(startX + 4, y + 8.5, startX + paymentWidth - 4, y + 8.5);
  doc.line(totalsX + 4, y + 8.5, totalsX + totalsWidth - 4, y + 8.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  let paymentY = y + 14;
  paymentLines.forEach((line) => {
    doc.text(fitText(doc, line, paymentWidth - 8), startX + 4, paymentY);
    paymentY += 4.5;
  });
  notesLines.forEach((line) => {
    doc.text(line, startX + 4, paymentY);
    paymentY += 4.5;
  });

  const adjTotal = Number(settlement.adjustmentsTotal) || 0;
  const totalsLines = [
    ['Production Amount', money(settlement.productionAmount)],
    ['Adjustments', adjTotal > 0 ? `+ ${money(adjTotal)}` : money(adjTotal)],
    ['Final Payable', money(settlement.finalPayable)],
  ];
  let totalsY = y + 14;
  totalsLines.forEach(([label, value], idx) => {
    const bold = idx === totalsLines.length - 1;
    if (bold) {
      doc.setFillColor(225, 235, 246);
      doc.rect(totalsX + 2, totalsY - 4, totalsWidth - 4, 8, 'F');
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9.5 : 8);
    doc.setTextColor(44, 62, 80);
    doc.text(label, totalsX + 5, totalsY);
    doc.text(`Rs. ${value}`, totalsX + totalsWidth - 5, totalsY, { align: 'right' });
    totalsY += bold ? 8 : 5.5;
  });

  return y + panelHeight;
}

export async function generateContractorSettlementPdf(settlement) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const process = settlement.process;
  const lines = Array.isArray(settlement.lines) ? settlement.lines : [];
  const adjustments = Array.isArray(settlement.adjustments) ? settlement.adjustments : [];
  const groups = groupLines(process, lines);
  const totalKg = groups.reduce((sum, group) => sum + group.netKg, 0);

  let y = drawCompactHeader(doc, {
    settlement,
    process,
    totalKg,
    pageWidth,
  });

  // --- Quality & Side summary ----------------------------------------------
  if (groups.length) {
    const showSide = process === 'coning';
    const headers = showSide
      ? [
        { text: 'Quality', align: 'left', wrap: true },
        { text: 'Cut', align: 'left' },
        { text: 'Side', align: 'center' },
        { text: 'Qty', align: 'right' },
        { text: 'Net KG', align: 'right' },
        { text: 'Rate', align: 'right' },
        { text: 'Amount', align: 'right' },
      ]
      : [
        { text: 'Quality', align: 'left', wrap: true },
        { text: 'Cut', align: 'left' },
        { text: 'Qty', align: 'right' },
        { text: 'Net KG', align: 'right' },
        { text: 'Rate', align: 'right' },
        { text: 'Amount', align: 'right' },
      ];
    const colWidths = showSide ? [88, 38, 20, 18, 36, 28, 39] : [105, 44, 20, 37, 28, 33];
    const rows = groups.map((g) => {
      const cells = [{ text: qualityLabel(process, g) }, { text: g.cutName || '-' }];
      if (showSide) cells.push({ text: sideLabel(g.side), align: 'center' });
      cells.push(
        { text: String(g.rows), align: 'right' },
        { text: formatWeight(g.netKg), align: 'right' },
        { text: money(g.ratePerKg), align: 'right' },
        { text: money(g.amount), align: 'right' },
      );
      return { cells };
    });
    // Totals row
    const totalKg = groups.reduce((a, g) => a + g.netKg, 0);
    const totalAmt = groups.reduce((a, g) => a + g.amount, 0);
    const totalsCells = [{ text: 'TOTAL' }, { text: '' }];
    if (showSide) totalsCells.push({ text: '' });
    totalsCells.push(
      { text: String(lines.length), align: 'right' },
      { text: formatWeight(totalKg), align: 'right' },
      { text: '', align: 'right' },
      { text: money(totalAmt), align: 'right' },
    );
    rows.push({ cells: totalsCells, isTotal: true });

    y = drawTable(doc, {
      y,
      title: 'Quality & Side Breakdown',
      headers,
      rows,
      colWidths,
      pageWidth,
      rowHeight: 5.5,
      headerHeight: 6.5,
      padding: 1.7,
      bottomMargin: 16,
      lineHeight: 2.8,
      pageStartY: 14,
    });
  }

  // --- Adjustments ----------------------------------------------------------
  if (adjustments.length) {
    const headers = [
      { text: 'Type', align: 'left' },
      { text: 'Reason', align: 'left', wrap: true },
      { text: 'Amount', align: 'right' },
    ];
    const rows = adjustments.map((a) => {
      const sign = a.type === 'advance_recovery' || a.type === 'deduction' ? '-' : '+';
      return {
        cells: [
          { text: ADJUSTMENT_LABELS[a.type] || a.type },
          { text: a.reason || '-' },
          { text: `${sign} ${money(a.amount)}`, align: 'right' },
        ],
      };
    });
    y = drawTable(doc, {
      y,
      title: 'Adjustments',
      headers,
      rows,
      colWidths: [45, 164, 58],
      pageWidth,
      rowHeight: 5.5,
      headerHeight: 6.5,
      padding: 1.7,
      bottomMargin: 16,
      lineHeight: 2.8,
      pageStartY: 14,
    });
  }

  // --- Payment & totals -----------------------------------------------------
  const panelHeight = getPaymentPanelHeight(doc, settlement, pageWidth);
  if (y + panelHeight > pageHeight - 14) {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    y = 14;
  }
  drawPaymentAndTotals(doc, settlement, y, pageWidth);

  drawFooter(doc, pageHeight);

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

export default generateContractorSettlementPdf;
