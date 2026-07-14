/**
 * Contractor Settlement PDF
 * Contractor/process/period, quality & Side summary, adjustments,
 * final payable, and payment reference.
 */

import { getJsPDF, formatDateDDMMYYYY, formatWeight, drawHeader, drawTable, drawFooter } from './pdfHelpers.js';

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
  if (process === 'cutter') return item.itemName || '—';
  if (process === 'holo') {
    return [item.yarnName, item.twistName].filter(Boolean).join(' / ') || '—';
  }
  const parts = [item.yarnName, item.twistName].filter(Boolean).join(' / ');
  const cone = item.coneTypeName ? ` · Cone:${item.coneTypeName}` : '';
  return (parts + cone) || '—';
}

function sideLabel(side) {
  if (side === 'SINGLE') return 'S/S';
  if (side === 'BOTH') return 'B/S';
  return '—';
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

export async function generateContractorSettlementPdf(settlement) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const process = settlement.process;
  const lines = Array.isArray(settlement.lines) ? settlement.lines : [];
  const adjustments = Array.isArray(settlement.adjustments) ? settlement.adjustments : [];

  let y = drawHeader(doc, {
    title: `Contractor Settlement - ${titleCase(process)}`,
    date: settlement.paymentDate || settlement.periodTo,
    pageWidth,
  });

  // --- Info block -----------------------------------------------------------
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  const info = [
    `Contractor: ${settlement.contractor?.name || '—'}`,
    `Phone: ${settlement.contractor?.phone || '—'}`,
    `Process: ${titleCase(process)}`,
    `Period: ${formatDateDDMMYYYY(settlement.periodFrom)} to ${formatDateDDMMYYYY(settlement.periodTo)}`,
    `Status: ${titleCase(settlement.status)}`,
  ];
  info.forEach((text, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    doc.text(text, 15 + col * ((pageWidth - 30) / 2), y + row * 6);
  });
  y += Math.ceil(info.length / 2) * 6 + 4;

  // --- Quality & Side summary ----------------------------------------------
  const groups = groupLines(process, lines);
  if (groups.length) {
    const showSide = process === 'coning';
    const headers = showSide
      ? [
        { text: 'Quality', align: 'left', wrap: true },
        { text: 'Cut', align: 'left' },
        { text: 'Side', align: 'center' },
        { text: 'Rows', align: 'right' },
        { text: 'Net KG', align: 'right' },
        { text: 'Rate', align: 'right' },
        { text: 'Amount', align: 'right' },
      ]
      : [
        { text: 'Quality', align: 'left', wrap: true },
        { text: 'Cut', align: 'left' },
        { text: 'Rows', align: 'right' },
        { text: 'Net KG', align: 'right' },
        { text: 'Rate', align: 'right' },
        { text: 'Amount', align: 'right' },
      ];
    const colWidths = showSide ? [46, 26, 16, 16, 26, 24, 26] : [56, 30, 18, 28, 26, 22];
    const rows = groups.map((g) => {
      const cells = [{ text: qualityLabel(process, g) }, { text: g.cutName || '—' }];
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

    y = drawTable(doc, { y, title: 'Quality & Side Breakdown', headers, rows, colWidths, pageWidth });
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
          { text: a.reason || '—' },
          { text: `${sign} ${money(a.amount)}`, align: 'right' },
        ],
      };
    });
    y = drawTable(doc, { y, title: 'Adjustments', headers, rows, colWidths: [40, 100, 40], pageWidth });
  }

  // --- Totals & payment -----------------------------------------------------
  if (y > pageHeight - 60) { doc.addPage(); y = 20; }
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.4);
  doc.line(pageWidth - 95, y, pageWidth - 15, y);
  y += 6;
  const adjTotal = Number(settlement.adjustmentsTotal) || 0;
  const totalsLines = [
    ['Production Amount', money(settlement.productionAmount)],
    ['Adjustments', adjTotal > 0 ? `+ ${money(adjTotal)}` : money(adjTotal)],
    ['Final Payable', money(settlement.finalPayable)],
  ];
  totalsLines.forEach(([label, value], idx) => {
    const bold = idx === totalsLines.length - 1;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 10);
    doc.setTextColor(44, 62, 80);
    doc.text(label, pageWidth - 95, y);
    doc.text(`Rs. ${value}`, pageWidth - 15, y, { align: 'right' });
    y += bold ? 8 : 6;
  });

  if (settlement.status === 'paid') {
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    const pay = [
      `Payment Date: ${formatDateDDMMYYYY(settlement.paymentDate)}`,
      `Mode: ${settlement.paymentMode || '—'}`,
      `Reference: ${settlement.paymentReference || '—'}`,
    ];
    pay.forEach((text) => { doc.text(text, 15, y); y += 6; });
    if (settlement.paymentNotes) {
      const notesLines = doc.splitTextToSize(`Notes: ${settlement.paymentNotes}`, pageWidth - 30);
      notesLines.forEach((line) => { doc.text(line, 15, y); y += 5; });
    }
  }

  drawFooter(doc, pageHeight);

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

export default generateContractorSettlementPdf;
