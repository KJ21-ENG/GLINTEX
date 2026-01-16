import { utils, write } from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDateDDMMYYYY } from '../utils/formatting';

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
        date: formatDateDDMMYYYY(lot.date),
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
  const hasPieces = piecesByLot && Object.keys(piecesByLot).some((key) => (piecesByLot[key] || []).length > 0);

  if (!hasPieces) {
    const hasAny = (key) => lots.some(l => l?.[key] !== undefined && l?.[key] !== null && l?.[key] !== '');
    const rows = (lots || []).map(l => {
      const row = {
        Lot: l.lotNo || '',
        Date: formatDateDDMMYYYY(l.date),
        Item: l.itemName || '',
      };
      if (hasAny('cutName') || hasAny('cut')) row.Cut = l.cutName || l.cut || '';
      if (hasAny('yarnName') || hasAny('yarn')) row.Yarn = l.yarnName || l.yarn || '';
      if (hasAny('twistName')) row.Twist = l.twistName || '';
      if (hasAny('firmName')) row.Firm = l.firmName || '';
      if (hasAny('supplierName')) row.Supplier = l.supplierName || '';

      if (hasAny('totalRolls') || hasAny('availableRolls') || hasAny('rollCount')) {
        row['Total Rolls'] = Number(
          l.totalRolls ?? l.availableRolls ?? l.rollCount ?? 0
        );
      }
      if (hasAny('totalCones') || hasAny('availableCones') || hasAny('coneCount')) {
        row['Total Cones'] = Number(
          l.totalCones ?? l.availableCones ?? l.coneCount ?? 0
        );
      }
      if (hasAny('totalWeight') || hasAny('availableWeight') || hasAny('netWeight')) {
        row['Net Weight (kg)'] = Number(
          l.totalWeight ?? l.availableWeight ?? l.netWeight ?? 0
        );
      }
      return row;
    });

    const wb = utils.book_new();
    const ws = utils.json_to_sheet(rows);
    utils.book_append_sheet(wb, ws, 'Stock');
    const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stock.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const orderedLots = orderLotsForExport(lots);
  const lotsSheet = orderedLots.map(l => {
    const row = {
      Lot: l.lotNo,
      Date: formatDateDDMMYYYY(l.date),
      Item: l.itemName,
      Firm: l.firmName,
      Supplier: l.supplierName,
    };
    if (l.cutName || l.cut) row.Cut = l.cutName || l.cut;
    if (l.yarnName || l.yarn) row.Yarn = l.yarnName || l.yarn;
    row["Available Pieces"] = (piecesByLot[l.lotNo] || []).length;
    return row;
  });
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
      formatDateDDMMYYYY(lot.date) || '',
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

/**
 * Generic Excel export for history tables
 * @param {Array} data - Array of objects to export
 * @param {Array} columns - Array of { key, header } objects defining columns
 * @param {string} filename - Filename without extension (e.g., 'issue-history-cutter')
 */
export function exportHistoryToExcel(data, columns, filename) {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  // Transform data to use header labels
  const rows = data.map(row => {
    const obj = {};
    columns.forEach(col => {
      obj[col.header] = row[col.key] ?? '';
    });
    return obj;
  });

  const wb = utils.book_new();
  const ws = utils.json_to_sheet(rows);

  // Auto-calculate column widths based on content
  const colWidths = columns.map(col => {
    const maxDataLen = Math.max(
      col.header.length,
      ...data.map(row => String(row[col.key] ?? '').length)
    );
    return { wch: Math.min(50, Math.max(10, maxDataLen + 2)) };
  });
  ws['!cols'] = colWidths;

  utils.book_append_sheet(wb, ws, 'Data');

  const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generic CSV export for history tables
 * @param {Array} data - Array of objects to export
 * @param {Array} columns - Array of { key, header } objects defining columns
 * @param {string} filename - Filename without extension
 */
export function exportHistoryToCsv(data, columns, filename) {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const headers = columns.map(col => escape(col.header));
  const lines = [headers.join(',')];

  for (const row of data) {
    const values = columns.map(col => escape(row[col.key]));
    lines.push(values.join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
