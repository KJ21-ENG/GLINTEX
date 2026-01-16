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

/**
 * Export Stock data to Excel with view-specific columns matching the UI exactly.
 * @param {Array} data - Array of displayed lots/rows (already filtered & grouped if applicable)
 * @param {Object} options - Export options
 * @param {string} options.viewType - 'jumbo' | 'bobbins' | 'holo' | 'coning'
 * @param {boolean} options.groupBy - Whether grouping is enabled
 * @param {Object} options.grandTotals - Grand totals object from the view
 * @param {string} options.statusFilter - Current status filter value (e.g. 'available_to_issue')
 */
export function exportStockXlsx(data, options = {}) {
  const { viewType = 'jumbo', groupBy = false, grandTotals = {}, statusFilter = '' } = options;

  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  // Define columns and value extractors for each view type
  const getColumns = () => {
    const hidePending = statusFilter === 'available_to_issue';

    switch (viewType) {
      case 'jumbo':
        if (groupBy) {
          return [
            { header: 'Lots', key: 'lots', format: (l) => (l.lots || []).join(', ') },
            { header: 'Item', key: 'itemName' },
            { header: 'Supplier', key: 'supplierName' },
            { header: 'Pieces (Avail/Total)', key: 'pieces', format: (l) => `${l.availableCount ?? 0} / ${l.totalPieces ?? 0}` },
            { header: 'Total Weight (kg)', key: 'totalWeight', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
            ...(!hidePending ? [{ header: 'Pending Weight (kg)', key: 'pendingWeight', format: (l) => Number(l.pendingWeight || 0).toFixed(3) }] : []),
          ];
        }
        return [
          { header: 'Lot No', key: 'lotNo' },
          { header: 'Date', key: 'date', format: (l) => formatDateDDMMYYYY(l.date) },
          { header: 'Item', key: 'itemName' },
          { header: 'Firm', key: 'firmName' },
          { header: 'Supplier', key: 'supplierName' },
          { header: 'Pieces (Avail/Total)', key: 'pieces', format: (l) => `${l.availableCount ?? 0} / ${l.totalPieces ?? (l.pieces || []).length}` },
          { header: 'Total Weight (kg)', key: 'totalWeight', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
          ...(!hidePending ? [{ header: 'Pending Weight (kg)', key: 'pendingWeight', format: (l) => Number(l.pendingWeight || 0).toFixed(3) }] : []),
        ];

      case 'bobbins':
        if (groupBy) {
          return [
            { header: 'Lots', key: 'lots', format: (l) => (l.lots || []).join(', ') },
            { header: 'Item', key: 'itemName' },
            { header: 'Cut', key: 'cutName' },
            { header: 'Supplier', key: 'supplierName' },
            { header: 'Bobbins (Avail/Total)', key: 'bobbins', format: (l) => `${l.availableBobbins ?? 0} / ${l.totalBobbins ?? 0}` },
            { header: 'Weight (Avail/Total)', key: 'weight', format: (l) => `${Number(l.availableWeight || 0).toFixed(3)} / ${Number(l.totalWeight || 0).toFixed(3)}` },
            { header: 'Crates', key: 'crateCount', format: (l) => l.crates?.length || l.crateCount || 0 },
          ];
        }
        return [
          { header: 'Lot No', key: 'lotNo' },
          { header: 'Date', key: 'date', format: (l) => formatDateDDMMYYYY(l.date) },
          { header: 'Item', key: 'itemName' },
          { header: 'Cut', key: 'cutName' },
          { header: 'Firm', key: 'firmName' },
          { header: 'Supplier', key: 'supplierName' },
          { header: 'Bobbins (Avail/Total)', key: 'bobbins', format: (l) => `${l.availableBobbins ?? 0} / ${l.totalBobbins ?? 0}` },
          { header: 'Weight (Avail/Total)', key: 'weight', format: (l) => `${Number(l.availableWeight || 0).toFixed(3)} / ${Number(l.totalWeight || 0).toFixed(3)}` },
          { header: 'Crates', key: 'crateCount', format: (l) => l.crates?.length || l.crateCount || 0 },
        ];

      case 'holo':
        if (groupBy) {
          return [
            { header: 'Lots', key: 'lots', format: (l) => (l.lots || []).join(', ') },
            { header: 'Item', key: 'itemName' },
            { header: 'Cut', key: 'cutName' },
            { header: 'Yarn / Twist', key: 'yarnTwist', format: (l) => `${l.yarnName || '—'} / ${l.twistName || '—'}` },
            { header: 'Supplier', key: 'supplierName' },
            { header: 'Available Rolls', key: 'totalRolls' },
            { header: 'Net Weight (kg)', key: 'totalWeight', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
          ];
        }
        return [
          { header: 'Lot No', key: 'lotNo' },
          { header: 'Date', key: 'date', format: (l) => formatDateDDMMYYYY(l.date) },
          { header: 'Item', key: 'itemName' },
          { header: 'Cut', key: 'cutName' },
          { header: 'Yarn / Twist', key: 'yarnTwist', format: (l) => `${l.yarnName || '—'} / ${l.twistName || '—'}` },
          { header: 'Firm', key: 'firmName' },
          { header: 'Supplier', key: 'supplierName' },
          { header: 'Available Rolls', key: 'totalRolls' },
          { header: 'Net Weight (kg)', key: 'totalWeight', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
          { header: 'Steamed', key: 'steamed', format: (l) => `${l.steamedRolls ?? 0} / ${l.totalRolls ?? 0}` },
        ];

      case 'coning':
        if (groupBy) {
          return [
            { header: 'Lots', key: 'lots', format: (l) => (l.lots || []).join(', ') },
            { header: 'Item', key: 'itemName' },
            { header: 'Cut', key: 'cutName' },
            { header: 'Yarn', key: 'yarnName' },
            { header: 'Supplier', key: 'supplierName' },
            { header: 'Available Cones', key: 'totalCones' },
            { header: 'Net Weight (kg)', key: 'totalWeight', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
          ];
        }
        return [
          { header: 'Lot No', key: 'lotNo' },
          { header: 'Date', key: 'date', format: (l) => formatDateDDMMYYYY(l.date) },
          { header: 'Item', key: 'itemName' },
          { header: 'Cut', key: 'cutName' },
          { header: 'Yarn', key: 'yarnName' },
          { header: 'Firm', key: 'firmName' },
          { header: 'Supplier', key: 'supplierName' },
          { header: 'Available Cones', key: 'totalCones' },
          { header: 'Net Weight (kg)', key: 'totalWeight', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
        ];

      default:
        return [];
    }
  };

  const columns = getColumns();
  if (columns.length === 0) {
    alert('Unknown view type for export');
    return;
  }

  // Build rows with formatted values
  const rows = data.map((item) => {
    const row = {};
    columns.forEach((col) => {
      if (col.format) {
        row[col.header] = col.format(item);
      } else {
        row[col.header] = item[col.key] ?? '';
      }
    });
    return row;
  });

  // Add Grand Totals row
  const totalsRow = {};
  columns.forEach((col, idx) => {
    if (idx === 0) {
      totalsRow[col.header] = 'Grand Total';
    } else {
      // Try to get matching total value
      switch (col.key) {
        case 'pieces':
          totalsRow[col.header] = `${grandTotals.availableCount ?? 0} / ${grandTotals.totalPieces ?? 0}`;
          break;
        case 'totalWeight':
          totalsRow[col.header] = Number(grandTotals.totalWeight || grandTotals.pendingWeight || 0).toFixed(3);
          break;
        case 'pendingWeight':
          totalsRow[col.header] = Number(grandTotals.pendingWeight || 0).toFixed(3);
          break;
        case 'bobbins':
          totalsRow[col.header] = `${grandTotals.availableBobbins ?? 0} / ${grandTotals.totalBobbins ?? 0}`;
          break;
        case 'weight':
          totalsRow[col.header] = `${Number(grandTotals.availableWeight || 0).toFixed(3)} / ${Number(grandTotals.totalWeight || 0).toFixed(3)}`;
          break;
        case 'crateCount':
          totalsRow[col.header] = grandTotals.crateCount ?? 0;
          break;
        case 'totalRolls':
          totalsRow[col.header] = grandTotals.totalRolls ?? 0;
          break;
        case 'steamed':
          totalsRow[col.header] = `${grandTotals.steamedRolls ?? 0} / ${grandTotals.totalRolls ?? 0}`;
          break;
        case 'totalCones':
          totalsRow[col.header] = grandTotals.totalCones ?? 0;
          break;
        default:
          totalsRow[col.header] = '';
      }
    }
  });
  rows.push(totalsRow);

  // Create workbook and sheet
  const wb = utils.book_new();
  const ws = utils.json_to_sheet(rows);

  // Auto-calculate column widths
  const colWidths = columns.map((col) => {
    const maxDataLen = Math.max(
      col.header.length,
      ...rows.map((row) => String(row[col.header] ?? '').length)
    );
    return { wch: Math.min(50, Math.max(12, maxDataLen + 2)) };
  });
  ws['!cols'] = colWidths;

  const sheetName = groupBy ? 'Stock (Grouped)' : 'Stock';
  utils.book_append_sheet(wb, ws, sheetName);

  const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stock-${viewType}${groupBy ? '-grouped' : ''}.xlsx`;
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
