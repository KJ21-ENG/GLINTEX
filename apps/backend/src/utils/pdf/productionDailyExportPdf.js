import {
  getJsPDF,
  formatDateDDMMYYYY,
  formatWeight,
  formatNumber,
  drawTable,
  drawFooter,
} from './pdfHelpers.js';

const PAGE_MARGIN = 12;
const COMPACT_PAGE_START_Y = 14;
const SUMMARY_GAP = 4;
const SUMMARY_BOTTOM_MARGIN = 12;
const SUMMARY_TITLE_SPACING = 4;
const TABLE_HEADER_FILL = [52, 73, 94];
const TABLE_HEADER_TEXT = [255, 255, 255];
const TABLE_BODY_TEXT = [44, 62, 80];
const TABLE_ALT_FILL = [248, 249, 250];
const TABLE_TOTAL_FILL = [233, 236, 239];
const TABLE_BORDER = [200, 200, 200];

function getTableWidth(colWidths = []) {
  return colWidths.reduce((sum, width) => sum + width, 0);
}

function formatOptionalWeight(value) {
  const num = Number(value);
  return Number.isFinite(num) ? formatWeight(num) : '';
}

function formatOptionalCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? formatNumber(num) : '';
}

function drawCompactHeader(doc, { title, date, pageWidth }) {
  let y = 10;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TABLE_BODY_TEXT);
  doc.text('GLINTEX', pageWidth / 2, y, { align: 'center' });
  y += 5.5;

  doc.setFontSize(11.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(52, 73, 94);
  doc.text(title, pageWidth / 2, y, { align: 'center' });
  y += 4.8;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Date: ${formatDateDDMMYYYY(date)}`, pageWidth / 2, y, { align: 'center' });
  y += 3.6;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);

  return y + 4;
}

function shouldWrap(config = {}) {
  return Boolean(config.wrap);
}

function truncateToWidth(doc, text, maxWidth) {
  let displayText = String(text ?? '');
  while (doc.getTextWidth(displayText) > maxWidth && displayText.length > 3) {
    displayText = `${displayText.slice(0, -4)}...`;
  }
  return displayText;
}

function getCellLines(doc, text, header, colWidth, padding) {
  const content = String(text ?? '');
  const maxWidth = colWidth - (padding * 2);
  if (shouldWrap(header)) {
    return doc.splitTextToSize(content, maxWidth);
  }
  return [truncateToWidth(doc, content, maxWidth)];
}

function getRowHeight(doc, row, headers, colWidths, { rowHeight, padding }) {
  if (!row) return rowHeight;
  const maxLines = row.cells.reduce((max, cell, index) => {
    const lines = getCellLines(doc, cell?.text ?? cell ?? '', {
      wrap: cell?.wrap ?? headers[index]?.wrap,
    }, colWidths[index], padding);
    return Math.max(max, lines.length || 1);
  }, 1);
  return rowHeight * maxLines;
}

function resolveHeaderHeight(doc, headers, colWidths, {
  headerHeight,
  padding,
  lineHeight,
}) {
  const maxLines = headers.reduce((count, header, index) => {
    const lines = getCellLines(doc, header.text || header, header, colWidths[index], padding);
    return Math.max(count, lines.length || 1);
  }, 1);
  const wrappedHeight = 2 + (maxLines * lineHeight) + 2;
  return Math.max(headerHeight, wrappedHeight);
}

function drawTableHeaderAt(doc, {
  x,
  y,
  headers,
  colWidths,
  headerHeight,
  padding,
  lineHeight,
}) {
  const tableWidth = getTableWidth(colWidths);
  const colPositions = [x];
  colWidths.forEach((width, index) => {
    colPositions.push(colPositions[index] + width);
  });

  doc.setFillColor(...TABLE_HEADER_FILL);
  doc.rect(x, y, tableWidth, headerHeight, 'F');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TABLE_HEADER_TEXT);
  headers.forEach((header, index) => {
    const align = header.align || 'left';
    const lines = getCellLines(doc, header.text || header, header, colWidths[index], padding);
    const startY = y + (headerHeight - (lines.length - 1) * lineHeight) / 2 + 0.7;
    let xPos = colPositions[index] + padding;
    if (align === 'right') {
      xPos = colPositions[index + 1] - padding;
    } else if (align === 'center') {
      xPos = colPositions[index] + (colWidths[index] / 2);
    }
    lines.forEach((line, lineIndex) => {
      doc.text(line, xPos, startY + (lineIndex * lineHeight), { align });
    });
  });

  return { tableWidth, colPositions };
}

function drawTableRowAt(doc, {
  row,
  x,
  y,
  rowHeight,
  headers,
  colWidths,
  padding,
  lineHeight,
}) {
  if (!row) return;

  const tableWidth = getTableWidth(colWidths);
  const colPositions = [x];
  colWidths.forEach((width, index) => {
    colPositions.push(colPositions[index] + width);
  });

  if (row.isTotal) {
    doc.setFillColor(...TABLE_TOTAL_FILL);
    doc.rect(x, y, tableWidth, rowHeight, 'F');
    doc.setFont('helvetica', 'bold');
  } else {
    doc.setFont('helvetica', 'normal');
  }

  doc.setFontSize(8);
  doc.setTextColor(...TABLE_BODY_TEXT);
  row.cells.forEach((cell, index) => {
    const align = cell.align || headers[index]?.align || 'left';
    const lines = getCellLines(doc, cell.text ?? cell, {
      wrap: cell.wrap ?? headers[index]?.wrap,
    }, colWidths[index], padding);
    const startY = y + (rowHeight - (lines.length - 1) * lineHeight) / 2 + 0.7;
    let xPos = colPositions[index] + padding;
    if (align === 'right') {
      xPos = colPositions[index + 1] - padding;
    } else if (align === 'center') {
      xPos = colPositions[index] + (colWidths[index] / 2);
    }
    lines.forEach((line, lineIndex) => {
      doc.text(line, xPos, startY + (lineIndex * lineHeight), { align });
    });
  });

  if (row.isTotal) {
    doc.setFont('helvetica', 'normal');
  }
}

function getSummaryTableLayout(table) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const lastRow = rows[rows.length - 1];
  if (lastRow?.isTotal) {
    return {
      bodyRows: rows.slice(0, -1),
      totalRow: lastRow,
    };
  }

  return {
    bodyRows: rows,
    totalRow: null,
  };
}

function createBlankSummaryRow(headers = []) {
  return {
    isBlank: true,
    cells: headers.map((header) => ({
      text: '',
      align: header.align || 'left',
      wrap: false,
    })),
  };
}

function getSummaryRenderRows(tables = []) {
  const layouts = tables.map((table) => getSummaryTableLayout(table));
  const maxBodyRows = Math.max(0, ...layouts.map((layout) => layout.bodyRows.length));
  const includeTotals = layouts.some((layout) => Boolean(layout.totalRow));
  const totalRowCount = maxBodyRows + (includeTotals ? 1 : 0);

  return Array.from({ length: totalRowCount }, (_, rowIndex) => tables.map((table, tableIndex) => {
    const layout = layouts[tableIndex];
    if (rowIndex < layout.bodyRows.length) return layout.bodyRows[rowIndex];
    if (rowIndex < maxBodyRows) return createBlankSummaryRow(table.headers);
    if (layout.totalRow) return layout.totalRow;
    return createBlankSummaryRow(table.headers);
  }));
}

function estimateSummarySectionHeight(doc, {
  tables,
  rowHeight,
  headerHeight,
  padding,
}) {
  const renderRows = getSummaryRenderRows(tables);
  let totalHeight = SUMMARY_TITLE_SPACING + headerHeight;
  for (const rowGroup of renderRows) {
    const rowGroupHeight = Math.max(...rowGroup.map((row, index) => getRowHeight(
      doc,
      row,
      tables[index].headers,
      tables[index].colWidths,
      { rowHeight, padding }
    )));
    totalHeight += rowGroupHeight;
  }
  return totalHeight + 5;
}

function drawTableColumnLines(doc, x, topY, colWidths, height) {
  let currentX = x;
  for (let index = 0; index < colWidths.length - 1; index += 1) {
    currentX += colWidths[index];
    doc.line(currentX, topY, currentX, topY + height);
  }
}

function drawSummaryTablesRow(doc, {
  y,
  pageWidth,
  pageHeight,
  tables,
  rowHeight = 6,
  headerHeight = 8,
  padding = 2,
  lineHeight = 3,
  bottomMargin = SUMMARY_BOTTOM_MARGIN,
}) {
  const availableWidth = pageWidth - (PAGE_MARGIN * 2);
  const slotWidth = (availableWidth - (SUMMARY_GAP * (tables.length - 1))) / tables.length;
  const tableXs = tables.map((_, index) => PAGE_MARGIN + (index * (slotWidth + SUMMARY_GAP)));
  const tableWidths = tables.map((table) => getTableWidth(table.colWidths));
  const resolvedHeaderHeight = Math.max(...tables.map((table) => resolveHeaderHeight(doc, table.headers, table.colWidths, {
    headerHeight,
    padding,
    lineHeight,
  })));
  const estimatedHeight = estimateSummarySectionHeight(doc, {
    tables,
    rowHeight,
    headerHeight: resolvedHeaderHeight,
    padding,
  });

  if (y + estimatedHeight > pageHeight - bottomMargin) {
    doc.addPage();
    y = COMPACT_PAGE_START_Y;
  }

  let cursorY = y;
  let currentPageTopY = 0;
  let currentPageHeight = 0;
  const renderRows = getSummaryRenderRows(tables);

  const drawSectionHeader = () => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TABLE_BODY_TEXT);
    tables.forEach((table, index) => {
      doc.text(table.title, tableXs[index], cursorY);
    });
    cursorY += SUMMARY_TITLE_SPACING;

    tables.forEach((table, index) => {
      drawTableHeaderAt(doc, {
        x: tableXs[index],
        y: cursorY,
        headers: table.headers,
        colWidths: table.colWidths,
        headerHeight: resolvedHeaderHeight,
        padding,
        lineHeight,
      });
    });

    currentPageTopY = cursorY;
    currentPageHeight = resolvedHeaderHeight;
    cursorY += resolvedHeaderHeight;
  };

  const drawPageBorders = () => {
    doc.setDrawColor(...TABLE_BORDER);
    doc.setLineWidth(0.3);
    tables.forEach((table, index) => {
      doc.rect(tableXs[index], currentPageTopY, tableWidths[index], currentPageHeight);
      drawTableColumnLines(doc, tableXs[index], currentPageTopY, table.colWidths, currentPageHeight);
    });
  };

  drawSectionHeader();

  for (let index = 0; index < renderRows.length; index += 1) {
    const rowGroup = renderRows[index];
    const combinedRowHeight = Math.max(...rowGroup.map((row, tableIndex) => getRowHeight(
      doc,
      row,
      tables[tableIndex].headers,
      tables[tableIndex].colWidths,
      { rowHeight, padding }
    )));

    if (cursorY + combinedRowHeight > pageHeight - bottomMargin) {
      drawPageBorders();
      doc.addPage();
      cursorY = COMPACT_PAGE_START_Y;
      drawSectionHeader();
    }

    if (index % 2 === 0) {
      doc.setFillColor(...TABLE_ALT_FILL);
      rowGroup.forEach((row, tableIndex) => {
        if (row && !row.isTotal && !row.isBlank) {
          doc.rect(tableXs[tableIndex], cursorY, tableWidths[tableIndex], combinedRowHeight, 'F');
        }
      });
    }

    rowGroup.forEach((row, tableIndex) => {
      drawTableRowAt(doc, {
        row,
        x: tableXs[tableIndex],
        y: cursorY,
        rowHeight: combinedRowHeight,
        headers: tables[tableIndex].headers,
        colWidths: tables[tableIndex].colWidths,
        padding,
        lineHeight,
      });
    });

    doc.setDrawColor(...TABLE_BORDER);
    doc.setLineWidth(0.2);
    tables.forEach((_, tableIndex) => {
      doc.line(
        tableXs[tableIndex],
        cursorY + combinedRowHeight,
        tableXs[tableIndex] + tableWidths[tableIndex],
        cursorY + combinedRowHeight
      );
    });

    cursorY += combinedRowHeight;
    currentPageHeight += combinedRowHeight;
  }

  drawPageBorders();
  return cursorY + 5;
}

function drawFooterOnAllPages(doc, pageHeight) {
  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawFooter(doc, pageHeight);
  }
  doc.setPage(pageCount);
}

export async function createProductionDailyExportPdfDocument(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let y = drawCompactHeader(doc, {
    title: `${data.processLabel || 'Production'} Daily Production Sheet`,
    date: data.date,
    pageWidth,
  });

  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    doc.setDrawColor(214, 220, 230);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(PAGE_MARGIN, y, pageWidth - (PAGE_MARGIN * 2), 30, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(44, 62, 80);
    doc.text('No data available', pageWidth / 2, y + 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90, 98, 108);
    doc.text('No production receive rows were found for the selected date.', pageWidth / 2, y + 25, { align: 'center' });

    drawFooterOnAllPages(doc, pageHeight);
    return doc;
  }

  const detailHeaders = [
    { text: 'YARN', align: 'left', wrap: true },
    { text: 'ITEM', align: 'left', wrap: true },
    { text: 'CUT', align: 'left', wrap: true },
    { text: 'MACHINE', align: 'left', wrap: true },
    { text: 'WORKER', align: 'left', wrap: true },
    { text: 'CRATES', align: 'left', wrap: true },
    { text: 'ROLL TYPE', align: 'left', wrap: true },
    { text: 'QUANTITY', align: 'right', wrap: true },
    { text: 'GROSS', align: 'right' },
    { text: 'TARE', align: 'right' },
    { text: 'NET', align: 'right' },
  ];
  const detailColWidths = [35, 40, 18, 24, 28, 16, 31, 18, 18, 18, 18];

  const sortedRows = [...data.rows].sort((a, b) =>
    String(a.machine || '').localeCompare(String(b.machine || ''), undefined, { numeric: true, sensitivity: 'base' })
  );

  const detailRows = sortedRows.map((row) => ({
    cells: [
      { text: row.yarn || '-', align: 'left' },
      { text: row.item || '-', align: 'left' },
      { text: row.cut || '-', align: 'left' },
      { text: row.machine || 'Unassigned', align: 'left' },
      { text: row.worker || '-', align: 'left' },
      { text: row.crates || '-', align: 'left' },
      { text: row.rollType || '-', align: 'left' },
      { text: formatOptionalCount(row.quantity), align: 'right' },
      { text: formatOptionalWeight(row.gross), align: 'right' },
      { text: formatOptionalWeight(row.tare), align: 'right' },
      { text: formatOptionalWeight(row.net), align: 'right' },
    ],
  }));

  detailRows.push({
    isTotal: true,
    cells: [
      { text: 'TOTAL', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: formatNumber(data.meta?.totalQuantity || 0), align: 'right' },
      { text: formatWeight(data.meta?.totalGross || 0), align: 'right' },
      { text: formatWeight(data.meta?.totalTare || 0), align: 'right' },
      { text: formatWeight(data.meta?.totalNet || 0), align: 'right' },
    ],
  });

  y = drawTable(doc, {
    y,
    headers: detailHeaders,
    rows: detailRows,
    colWidths: detailColWidths,
    pageWidth,
    rowHeight: 5,
    headerHeight: 7,
    padding: 1.2,
    lineHeight: 2.6,
    bottomMargin: 12,
    pageStartY: COMPACT_PAGE_START_Y,
  });

  const machineSummaryRows = (data.machineSummary || []).map((entry) => ({
    cells: [
      { text: entry.machine || 'Unassigned', align: 'left', wrap: true },
      { text: formatNumber(entry.totalQuantity || 0), align: 'right' },
      { text: formatWeight(entry.totalNetProduction || 0), align: 'right' },
    ],
  }));
  machineSummaryRows.push({
    isTotal: true,
    cells: [
      { text: 'TOTAL', align: 'left' },
      { text: formatNumber(data.meta?.totalQuantity || 0), align: 'right' },
      { text: formatWeight(data.meta?.totalNet || 0), align: 'right' },
    ],
  });

  const itemSummaryRows = (data.itemSummary || []).map((entry) => ({
    cells: [
      { text: entry.item || 'Unassigned', align: 'left', wrap: true },
      { text: formatNumber(entry.totalQuantity || 0), align: 'right' },
      { text: formatWeight(entry.totalNetProduction || 0), align: 'right' },
    ],
  }));
  itemSummaryRows.push({
    isTotal: true,
    cells: [
      { text: 'TOTAL', align: 'left' },
      { text: formatNumber(data.meta?.totalQuantity || 0), align: 'right' },
      { text: formatWeight(data.meta?.totalNet || 0), align: 'right' },
    ],
  });

  const yarnSummaryRows = (data.yarnSummary || []).map((entry) => ({
    cells: [
      { text: entry.yarn || 'Unassigned', align: 'left', wrap: true },
      { text: formatNumber(entry.totalQuantity || 0), align: 'right' },
      { text: formatWeight(entry.totalNetProduction || 0), align: 'right' },
    ],
  }));
  yarnSummaryRows.push({
    isTotal: true,
    cells: [
      { text: 'TOTAL', align: 'left' },
      { text: formatNumber(data.meta?.totalQuantity || 0), align: 'right' },
      { text: formatWeight(data.meta?.totalNet || 0), align: 'right' },
    ],
  });

  y = drawSummaryTablesRow(doc, {
    y,
    pageWidth,
    pageHeight,
    rowHeight: 5,
    headerHeight: 7,
    padding: 1.2,
    lineHeight: 2.6,
    bottomMargin: SUMMARY_BOTTOM_MARGIN,
    tables: [{
      title: 'Machine Summary',
      headers: [
        { text: 'MACHINE', align: 'left', wrap: true },
        { text: 'QTY', align: 'right' },
        { text: 'TOTAL NET PRODUCTION', align: 'right', wrap: true },
      ],
      rows: machineSummaryRows,
      colWidths: [31, 14, 39],
    }, {
      title: 'Item Summary',
      headers: [
        { text: 'ITEM', align: 'left', wrap: true },
        { text: 'QTY', align: 'right' },
        { text: 'TOTAL NET PRODUCTION', align: 'right', wrap: true },
      ],
      rows: itemSummaryRows,
      colWidths: [35, 14, 35],
    }, {
      title: 'Yarn Summary',
      headers: [
        { text: 'YARN', align: 'left', wrap: true },
        { text: 'QTY', align: 'right' },
        { text: 'TOTAL NET PRODUCTION', align: 'right', wrap: true },
      ],
      rows: yarnSummaryRows,
      colWidths: [35, 14, 35],
    }],
  });

  drawFooterOnAllPages(doc, pageHeight);
  return doc;
}

export async function generateProductionDailyExportPdf(data) {
  const doc = await createProductionDailyExportPdfDocument(data);
  return Buffer.from(doc.output('arraybuffer'));
}
