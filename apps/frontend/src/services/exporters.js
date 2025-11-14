import { utils, write } from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function orderLotsForExport(lots) {
  return [...lots].sort((a, b) => {
    const itemA = String(a?.itemName ?? '').toLowerCase();
    const itemB = String(b?.itemName ?? '').toLowerCase();
    if (itemA !== itemB) return itemA.localeCompare(itemB);

    const lotA = String(a?.lotNo ?? '').toLowerCase();
    const lotB = String(b?.lotNo ?? '').toLowerCase();
    if (lotA !== lotB) return lotA.localeCompare(lotB, undefined, { numeric: true, sensitivity: 'base' });

    return 0;
  });
}

function flattenLots(lots, piecesByLot) {
  const orderedLots = orderLotsForExport(lots);
  const rows = [];
  for (const lot of orderedLots) {
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
  const orderedLots = orderLotsForExport(lots);
  const lotsSheet = orderedLots.map(l => ({ Lot: l.lotNo, Date: l.date, Item: l.itemName, Firm: l.firmName, Supplier: l.supplierName, "Available Pieces": (piecesByLot[l.lotNo] || []).length }));
  const pieces = flattenLots(orderedLots, piecesByLot);
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
  const orderedLots = orderLotsForExport(lots);
  const pieces = flattenLots(orderedLots, piecesByLot);
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
  const orderedLots = orderLotsForExport(lots);
  const doc = new jsPDF({ orientation: 'portrait' });

  // Build timestamp string in format hh:mm am/pm & DD/MM/YYYY
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hours = now.getHours();
  const minutes = pad(now.getMinutes());
  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHour = pad(hours % 12 === 0 ? 12 : hours % 12);
  const dateStr = `${displayHour}:${minutes} ${ampm} & ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

  const title = `Metallic Rolls Stock As On ${dateStr}`;
  doc.setFontSize(12);
  // Center the title horizontally
  doc.text(title, doc.internal.pageSize.getWidth() / 2, 14, { align: 'center' });

  // Match frontend table columns: Lot No, Date, Item, Firm, Supplier, Pieces (available/out), Initial Weight, Pending Weight
  const header = [['Lot No', 'Date', 'Item', 'Firm', 'Supplier', 'Pieces (available/out)', 'Initial Weight (kg)', 'Pending Weight (kg)']];
  const body = [];
  for (const lot of orderedLots) {
    // Prefer authoritative lot-level fields when available (these are computed in the UI)
    // Fallback to piecesByLot when lot-level totals are not present.
    const pieces = piecesByLot[lot.lotNo] || [];
    const remainingPcsFromPieces = pieces.length;
    const remainingWeightFromPieces = pieces.reduce((s, p) => s + (Number(p.weight) || 0), 0);

    // totalPieces may be stored as totalPieces or total; if absent fall back to pieces count
    const totalPcs = Number(lot.totalPieces ?? lot.total ?? remainingPcsFromPieces);

    // remaining pieces: prefer availableCount (UI shows available/out using availableCount),
    // otherwise fall back to piecesByLot length
    const availableCount = (lot.availableCount !== undefined && lot.availableCount !== null) ? Number(lot.availableCount) : remainingPcsFromPieces;
    const piecesCell = `${availableCount} / ${totalPcs}`;

    // totalWeight: prefer lot.totalWeight if present, otherwise derive from pieces
    const totalWeight = Number(lot.totalWeight ?? remainingWeightFromPieces);

    // remaining weight: prefer pendingWeight (UI shows pending weight), otherwise derive from pieces
    const remainingWeight = (lot.pendingWeight !== undefined && lot.pendingWeight !== null) ? Number(lot.pendingWeight) : remainingWeightFromPieces;
    body.push([
      lot.lotNo,
      lot.date || '',
      lot.itemName || '',
      lot.firmName || '',
      lot.supplierName || '',
      piecesCell,
      String(totalWeight.toFixed ? totalWeight.toFixed(3) : totalWeight),
      String(remainingWeight.toFixed ? remainingWeight.toFixed(3) : remainingWeight),
    ]);
  }

  autoTable(doc, {
    startY: 22,
    head: header,
    body,
    styles: { fontSize: 9, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: [30, 76, 166], textColor: 255, halign: 'center', valign: 'middle' },
    theme: 'grid',
    willDrawCell: (data) => {
      // no-op placeholder for possible future styling per cell
    }
  });

  doc.save('stock-summary.pdf');
}

export default { exportXlsx, exportCsv, exportPdf };


