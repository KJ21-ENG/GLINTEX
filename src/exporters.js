import { utils, write } from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function flattenLots(lots, piecesByLot) {
  const rows = [];
  for (const lot of lots) {
    const pieces = piecesByLot[lot.lotNo] || [];
    for (const p of pieces) {
      rows.push({
        lotNo: lot.lotNo,
        date: lot.date,
        itemName: lot.itemName,
        firmName: lot.firmName,
        supplierName: lot.supplierName,
        pieceId: p.id,
        seq: p.seq,
        weight: p.weight,
      });
    }
  }
  return rows;
}

export function exportXlsx(lots, piecesByLot) {
  const lotsSheet = lots.map(l => ({ Lot: l.lotNo, Date: l.date, Item: l.itemName, Firm: l.firmName, Supplier: l.supplierName, "Available Pieces": (piecesByLot[l.lotNo] || []).length }));
  const pieces = flattenLots(lots, piecesByLot);
  const wb = utils.book_new();
  const ws1 = utils.json_to_sheet(lotsSheet);
  const ws2 = utils.json_to_sheet(pieces);
  utils.book_append_sheet(wb, ws1, 'Lots');
  utils.book_append_sheet(wb, ws2, 'Pieces');
  const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stock.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(lots, piecesByLot) {
  const pieces = flattenLots(lots, piecesByLot);
  if (pieces.length === 0) {
    const csvEmpty = 'No data';
    const blob = new Blob([csvEmpty], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pieces.csv';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const header = Object.keys(pieces[0]);
  const lines = [header.join(',')];
  for (const row of pieces) {
    lines.push(header.map(h => JSON.stringify(row[h] ?? '')).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pieces.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPdf(lots, piecesByLot, brand = { primary: '#2E4CA6', gold: '#D4AF37' }) {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(12);
  doc.text('Stock — Lots (Summary)', 14, 14);

  const header = [['Lot No', 'Date', 'Item', 'Firm', 'Supplier', 'Total Pcs', 'Remaining Pcs', 'Total Weight (kg)', 'Remaining Weight (kg)']];
  const body = [];
  for (const lot of lots) {
    const pieces = piecesByLot[lot.lotNo] || [];
    const remainingPcs = pieces.length;
    const remainingWeight = pieces.reduce((s, p) => s + (Number(p.weight) || 0), 0);
    const totalPcs = Number(lot.totalPieces ?? lot.pieces ?? remainingPcs);
    const totalWeight = Number(lot.totalWeight ?? (remainingWeight));
    body.push([
      lot.lotNo,
      lot.date || '',
      lot.itemName || '',
      lot.firmName || '',
      lot.supplierName || '',
      String(totalPcs),
      String(remainingPcs),
      String(totalWeight.toFixed ? totalWeight.toFixed(3) : totalWeight),
      String(remainingWeight.toFixed ? remainingWeight.toFixed(3) : remainingWeight),
    ]);
  }

  autoTable(doc, {
    startY: 22,
    head: header,
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 76, 166], textColor: 255 },
    theme: 'grid',
    willDrawCell: (data) => {
      // no-op placeholder for possible future styling per cell
    }
  });

  doc.save('stock-summary.pdf');
}

export default { exportXlsx, exportCsv, exportPdf };


