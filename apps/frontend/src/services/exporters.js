import { utils, write } from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDateDDMMYYYY } from '../utils/formatting';

function hexToRgb(hex) {
  const str = String(hex || '').trim();
  const match = str.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return [46, 76, 166]; // default brand primary
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function inferImageFormat(dataUrl) {
  const str = String(dataUrl || '');
  const m = str.match(/^data:image\/(png|jpe?g);/i);
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t === 'png' ? 'PNG' : 'JPEG';
}

function formatPrintedAt(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const minutes = pad(d.getMinutes());
  const hours24 = d.getHours();
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${dd}/${mm}/${yyyy} ${hours12}:${minutes} ${ampm}`;
}

function ellipsizeToWidth(doc, text, maxWidth) {
  const raw = String(text ?? '');
  if (doc.getTextWidth(raw) <= maxWidth) return raw;
  let s = raw;
  while (s.length > 1 && doc.getTextWidth(`${s}...`) > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}...`;
}

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

  const columns = getStockExportColumns({ viewType, groupBy, statusFilter });
  if (columns.length === 0) {
    alert('Unknown view type for export');
    return;
  }

  // Build rows with formatted values
  const rows = data.map((item) => buildStockExportRowObject(item, columns));
  rows.push(buildStockTotalsRow(columns, { grandTotals }));

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

function getStockExportColumns({ viewType = 'jumbo', groupBy = false, statusFilter = '' }) {
  const hidePending = statusFilter === 'available_to_issue';

  switch (viewType) {
    case 'jumbo':
      if (groupBy) {
        return [
          { header: 'Lots', key: 'lots', align: 'left', format: (l) => (l.lots || []).join(', ') },
          { header: 'Item', key: 'itemName', align: 'left' },
          { header: 'Supplier', key: 'supplierName', align: 'left' },
          { header: 'Pieces (Avail/Total)', key: 'pieces', align: 'right', format: (l) => `${l.availableCount ?? 0} / ${l.totalPieces ?? 0}` },
          { header: 'Weight (Rem/Total)', key: 'weight', align: 'right', format: (l) => `${Number(l.remainingWeight || 0).toFixed(3)} / ${Number(l.totalWeight || 0).toFixed(3)}` },
          ...(!hidePending ? [{ header: 'Pending Weight (kg)', key: 'pendingWeight', align: 'right', format: (l) => Number(l.pendingWeight || 0).toFixed(3) }] : []),
        ];
      }
      return [
        { header: 'Lot No', key: 'lotNo', align: 'left' },
        { header: 'Date', key: 'date', align: 'center', format: (l) => formatDateDDMMYYYY(l.date) },
        { header: 'Item', key: 'itemName', align: 'left' },
        { header: 'Firm', key: 'firmName', align: 'left' },
        { header: 'Supplier', key: 'supplierName', align: 'left' },
        { header: 'Pieces (Avail/Total)', key: 'pieces', align: 'right', format: (l) => `${l.availableCount ?? 0} / ${l.totalPieces ?? (l.pieces || []).length}` },
        { header: 'Weight (Rem/Total)', key: 'weight', align: 'right', format: (l) => `${Number(l.remainingWeight || 0).toFixed(3)} / ${Number(l.totalWeight || 0).toFixed(3)}` },
        ...(!hidePending ? [{ header: 'Pending Weight (kg)', key: 'pendingWeight', align: 'right', format: (l) => Number(l.pendingWeight || 0).toFixed(3) }] : []),
      ];

    case 'bobbins':
      if (groupBy) {
        return [
          { header: 'Lots', key: 'lots', align: 'left', format: (l) => (l.lots || []).join(', ') },
          { header: 'Item', key: 'itemName', align: 'left' },
          { header: 'Cut', key: 'cutName', align: 'left' },
          { header: 'Supplier', key: 'supplierName', align: 'left' },
          { header: 'Bobbins (Avail/Total)', key: 'bobbins', align: 'right', format: (l) => `${l.availableBobbins ?? 0} / ${l.totalBobbins ?? 0}` },
          { header: 'Weight (Avail/Total)', key: 'weight', align: 'right', format: (l) => `${Number(l.availableWeight || 0).toFixed(3)} / ${Number(l.totalWeight || 0).toFixed(3)}` },
          { header: 'Crates', key: 'crateCount', align: 'right', format: (l) => l.crates?.length || l.crateCount || 0 },
        ];
      }
      return [
        { header: 'Lot No', key: 'lotNo', align: 'left' },
        { header: 'Date', key: 'date', align: 'center', format: (l) => formatDateDDMMYYYY(l.date) },
        { header: 'Item', key: 'itemName', align: 'left' },
        { header: 'Cut', key: 'cutName', align: 'left' },
        { header: 'Firm', key: 'firmName', align: 'left' },
        { header: 'Supplier', key: 'supplierName', align: 'left' },
        { header: 'Bobbins (Avail/Total)', key: 'bobbins', align: 'right', format: (l) => `${l.availableBobbins ?? 0} / ${l.totalBobbins ?? 0}` },
        { header: 'Weight (Avail/Total)', key: 'weight', align: 'right', format: (l) => `${Number(l.availableWeight || 0).toFixed(3)} / ${Number(l.totalWeight || 0).toFixed(3)}` },
        { header: 'Crates', key: 'crateCount', align: 'right', format: (l) => l.crates?.length || l.crateCount || 0 },
      ];

    case 'holo':
      if (groupBy) {
        return [
          { header: 'Lots', key: 'lots', align: 'left', format: (l) => (l.lots || []).join(', ') },
          { header: 'Item', key: 'itemName', align: 'left' },
          { header: 'Cut', key: 'cutName', align: 'left' },
          { header: 'Yarn / Twist', key: 'yarnTwist', align: 'left', format: (l) => `${l.yarnName || '—'} / ${l.twistName || '—'}` },
          { header: 'Supplier', key: 'supplierName', align: 'left' },
          { header: 'Available Rolls', key: 'totalRolls', align: 'right' },
          { header: 'Net Weight (kg)', key: 'totalWeight', align: 'right', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
        ];
      }
      return [
        { header: 'Lot No', key: 'lotNo', align: 'left' },
        { header: 'Date', key: 'date', align: 'center', format: (l) => formatDateDDMMYYYY(l.date) },
        { header: 'Item', key: 'itemName', align: 'left' },
        { header: 'Cut', key: 'cutName', align: 'left' },
        { header: 'Yarn / Twist', key: 'yarnTwist', align: 'left', format: (l) => `${l.yarnName || '—'} / ${l.twistName || '—'}` },
        { header: 'Firm', key: 'firmName', align: 'left' },
        { header: 'Supplier', key: 'supplierName', align: 'left' },
        { header: 'Available Rolls', key: 'totalRolls', align: 'right' },
        { header: 'Net Weight (kg)', key: 'totalWeight', align: 'right', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
        { header: 'Steamed', key: 'steamed', align: 'right', format: (l) => `${l.steamedRolls ?? 0} / ${l.totalRolls ?? 0}` },
      ];

    case 'coning':
      if (groupBy) {
        return [
          { header: 'Lots', key: 'lots', align: 'left', format: (l) => (l.lots || []).join(', ') },
          { header: 'Item', key: 'itemName', align: 'left' },
          { header: 'Cut', key: 'cutName', align: 'left' },
          { header: 'Yarn', key: 'yarnName', align: 'left' },
          { header: 'Supplier', key: 'supplierName', align: 'left' },
          { header: 'Available Cones', key: 'totalCones', align: 'right' },
          { header: 'Net Weight (kg)', key: 'totalWeight', align: 'right', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
        ];
      }
      return [
        { header: 'Lot No', key: 'lotNo', align: 'left' },
        { header: 'Date', key: 'date', align: 'center', format: (l) => formatDateDDMMYYYY(l.date) },
        { header: 'Item', key: 'itemName', align: 'left' },
        { header: 'Cut', key: 'cutName', align: 'left' },
        { header: 'Yarn', key: 'yarnName', align: 'left' },
        { header: 'Firm', key: 'firmName', align: 'left' },
        { header: 'Supplier', key: 'supplierName', align: 'left' },
        { header: 'Available Cones', key: 'totalCones', align: 'right' },
        { header: 'Net Weight (kg)', key: 'totalWeight', align: 'right', format: (l) => Number(l.totalWeight || 0).toFixed(3) },
      ];

    default:
      return [];
  }
}

function formatStockCell(item, col) {
  if (col.format) return col.format(item);
  return item?.[col.key] ?? '';
}

function buildStockExportRowObject(item, columns) {
  const row = {};
  columns.forEach((col) => {
    row[col.header] = formatStockCell(item, col);
  });
  return row;
}

function buildStockTotalsRow(columns, { grandTotals = {} } = {}) {
  const totalsRow = {};
  columns.forEach((col, idx) => {
    if (idx === 0) {
      totalsRow[col.header] = 'Grand Total';
      return;
    }
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
        if (grandTotals.remainingWeight !== undefined && grandTotals.remainingWeight !== null) {
          totalsRow[col.header] = `${Number(grandTotals.remainingWeight || 0).toFixed(3)} / ${Number(grandTotals.totalWeight || 0).toFixed(3)}`;
        } else {
          totalsRow[col.header] = `${Number(grandTotals.availableWeight || 0).toFixed(3)} / ${Number(grandTotals.totalWeight || 0).toFixed(3)}`;
        }
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
  });
  return totalsRow;
}

function getStockReportTitle(viewType) {
  switch (viewType) {
    case 'bobbins':
      return 'Stock Report - Bobbins';
    case 'holo':
      return 'Stock Report - Holo';
    case 'coning':
      return 'Stock Report - Coning';
    case 'jumbo':
    default:
      return 'Stock Report - Jumbo Rolls';
  }
}

function drawStockPdfHeader(doc, {
  companyName,
  title,
  printedAtStr,
  brandPrimaryRgb,
  brandGoldRgb,
  logoDataUrl,
  pageWidth,
  marginX,
  headerHeight,
}) {
  const topStripH = 4;
  doc.setFillColor(...brandPrimaryRgb);
  doc.rect(0, 0, pageWidth, topStripH, 'F');

  doc.setDrawColor(...brandGoldRgb);
  doc.setLineWidth(0.8);
  doc.line(0, headerHeight, pageWidth, headerHeight);

  const yBase = topStripH + 6;
  const logoSize = 12;
  let textX = marginX;

  const imageFormat = inferImageFormat(logoDataUrl);
  if (logoDataUrl && imageFormat) {
    try {
      doc.addImage(logoDataUrl, imageFormat, marginX, yBase - 4, logoSize, logoSize);
      textX = marginX + logoSize + 3;
    } catch {
      // ignore logo failures
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(44, 62, 80);
  doc.text(String(companyName || 'GLINTEX'), textX, yBase + 3);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(String(title || ''), textX, yBase + 9);

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Printed: ${printedAtStr}`, pageWidth - marginX, yBase + 3, { align: 'right' });
}

function drawStockPdfFooter(doc, {
  pageWidth,
  pageHeight,
  marginX,
  brandGoldRgb,
  pageNumber,
  totalPages,
}) {
  const yLine = pageHeight - 11;
  doc.setDrawColor(...brandGoldRgb);
  doc.setLineWidth(0.4);
  doc.line(marginX, yLine, pageWidth - marginX, yLine);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - marginX, pageHeight - 6, { align: 'right' });
}

function drawStockPdfMetaBox(doc, {
  x,
  y,
  width,
  pairs,
}) {
  const safePairs = (pairs || [])
    .filter((p) => p && p.label && p.value !== undefined && p.value !== null && String(p.value).trim() !== '')
    .map((p) => ({ label: String(p.label), value: String(p.value) }));

  if (safePairs.length === 0) return y;

  const padding = 3;
  const colGap = 6;
  const lineH = 4;
  const titleH = 6;

  const cols = 2;
  const rows = Math.ceil(safePairs.length / cols);
  const boxH = titleH + (rows * lineH) + padding + 2;

  doc.setFillColor(248, 249, 250);
  doc.roundedRect(x, y, width, boxH, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(44, 62, 80);
  doc.text('Report Filters', x + padding, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);

  const innerW = width - (padding * 2);
  const colW = (innerW - colGap) / 2;
  const left = safePairs.slice(0, rows);
  const right = safePairs.slice(rows);

  const startY = y + titleH + 2;

  left.forEach((p, idx) => {
    const line = `${p.label}: ${p.value}`;
    doc.text(ellipsizeToWidth(doc, line, colW), x + padding, startY + (idx * lineH));
  });
  right.forEach((p, idx) => {
    const line = `${p.label}: ${p.value}`;
    doc.text(ellipsizeToWidth(doc, line, colW), x + padding + colW + colGap, startY + (idx * lineH));
  });

  return y + boxH + 6;
}

export function exportStockPdf(data, options = {}) {
  const {
    viewType = 'jumbo',
    groupBy = false,
    grandTotals = {},
    statusFilter = '',
    brand = { primary: '#2E4CA6', gold: '#D4AF37', logoDataUrl: '' },
    companyName = 'GLINTEX',
    metaPairs = [],
  } = options;

  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  const columns = getStockExportColumns({ viewType, groupBy, statusFilter });
  if (columns.length === 0) {
    alert('Unknown view type for export');
    return;
  }

  const orientation = columns.length > 6 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const brandPrimaryRgb = hexToRgb(brand?.primary);
  const brandGoldRgb = hexToRgb(brand?.gold);
  const printedAtStr = formatPrintedAt(new Date());
  const title = getStockReportTitle(viewType);

  const marginX = 12;
  const headerHeight = 24;
  const footerHeight = 14;

  let y = headerHeight + 6;
  y = drawStockPdfMetaBox(doc, {
    x: marginX,
    y,
    width: pageWidth - (marginX * 2),
    pairs: metaPairs,
  });

  const bodyRows = data.map((item) => (
    columns.map((col) => {
      const v = formatStockCell(item, col);
      return v === null || v === undefined ? '' : String(v);
    })
  ));

  const totalsRowObj = buildStockTotalsRow(columns, { grandTotals });
  const totalsRow = columns.map((col) => String(totalsRowObj[col.header] ?? ''));
  bodyRows.push(totalsRow);

  const columnStyles = {};
  columns.forEach((col, idx) => {
    columnStyles[idx] = { halign: col.align || 'left' };
  });

  autoTable(doc, {
    startY: y,
    head: [columns.map((c) => c.header)],
    body: bodyRows,
    margin: {
      top: headerHeight + 6,
      left: marginX,
      right: marginX,
      bottom: footerHeight,
    },
    styles: {
      fontSize: 8,
      textColor: [44, 62, 80],
      cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
      lineWidth: 0.1,
      lineColor: [220, 220, 220],
    },
    headStyles: {
      fillColor: brandPrimaryRgb,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles,
    didParseCell: (data) => {
      const isTotalsRow = data.section === 'body' && data.row.index === bodyRows.length - 1;
      if (isTotalsRow) {
        data.cell.styles.fillColor = [233, 236, 239];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawStockPdfHeader(doc, {
      companyName,
      title,
      printedAtStr,
      brandPrimaryRgb,
      brandGoldRgb,
      logoDataUrl: brand?.logoDataUrl,
      pageWidth,
      marginX,
      headerHeight,
    });
    drawStockPdfFooter(doc, {
      pageWidth,
      pageHeight,
      marginX,
      brandGoldRgb,
      pageNumber: i,
      totalPages,
    });
  }

  doc.save(`stock-${viewType}${groupBy ? '-grouped' : ''}.pdf`);
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
