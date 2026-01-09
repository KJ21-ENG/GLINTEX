/**
 * PDF Summary Generation Utility
 * Generates summary PDFs for issue/receive operations using jsPDF
 */

// We'll use a simple text-based PDF approach that works server-side
// Using dynamic import for jsPDF to handle ES module

let jsPDFModule = null;

async function getJsPDF() {
  if (!jsPDFModule) {
    // Dynamic import for jsPDF - v4.x exports jsPDF as a named export
    const jspdfModule = await import('jspdf');
    // Handle both ESM default export and CJS scenarios
    jsPDFModule = jspdfModule.jsPDF || jspdfModule.default?.jsPDF || jspdfModule.default;
  }
  return jsPDFModule;
}

const PAGE_MARGIN = 12;
const TABLE_FONT_SIZE = 8.5;

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  // Parse YYYY-MM-DD directly without creating Date object to avoid timezone issues
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, yyyy, mm, dd] = match;
    return `${dd}/${mm}/${yyyy}`;
  }
  // Fallback for other formats
  return str;
}

function formatWeight(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num.toFixed(3) : '0.000';
}

function formatNumber(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num.toLocaleString('en-IN') : '0';
}

function safeText(val, fallback = '') {
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  return str.length ? str : fallback;
}

function drawReportHeader(doc, title, date) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = PAGE_MARGIN;
  let y = margin;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('GLINTEX', margin, y);
  doc.setFontSize(11);
  doc.text(title, margin, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${formatDateDDMMYYYY(date)}`, pageWidth - margin, y, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, pageWidth - margin, y + 5, { align: 'right' });

  y += 12;
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  return y + 6;
}

function drawOverview(doc, startY, items = []) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = PAGE_MARGIN;
  const columns = 2;
  const columnWidth = (pageWidth - margin * 2) / columns;
  const rowHeight = 5;

  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('OVERVIEW', margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * columnWidth;
    const rowY = y + row * rowHeight;
    doc.text(`${item.label}: ${item.value}`, x, rowY);
  });

  y += Math.ceil(items.length / columns) * rowHeight + 4;
  return y;
}

function wrapText(doc, text, width) {
  const normalized = safeText(text, '');
  if (!normalized) return [''];
  const parts = normalized.split('\n');
  const lines = [];
  for (const part of parts) {
    const wrapped = doc.splitTextToSize(part, width);
    if (Array.isArray(wrapped)) {
      lines.push(...wrapped);
    } else {
      lines.push(String(wrapped));
    }
  }
  return lines.length ? lines : [''];
}

function drawTable(doc, startY, { title, columns, rows, totalRow }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = PAGE_MARGIN;
  let y = startY;

  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, margin, y);
    y += 6;
  }

  const availableWidth = pageWidth - margin * 2;
  const definedWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const scale = definedWidth > availableWidth ? availableWidth / definedWidth : 1;
  const cols = columns.map(col => ({ ...col, width: col.width * scale }));

  doc.setFontSize(TABLE_FONT_SIZE);
  const baseLineHeight = typeof doc.getTextDimensions === 'function'
    ? doc.getTextDimensions('Mg').h
    : 4;
  const lineHeight = baseLineHeight * 1.15;
  const padding = 2;
  const minRowHeight = lineHeight + padding * 2;
  const headerHeight = lineHeight + padding * 2;

  const drawHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setFillColor(234, 237, 240);
    doc.setDrawColor(200, 200, 200);
    doc.rect(margin, y, availableWidth, headerHeight, 'F');
    doc.rect(margin, y, availableWidth, headerHeight);

    let x = margin;
    cols.forEach((col) => {
      const headerLines = wrapText(doc, col.header, col.width - padding * 2);
      const textX = col.align === 'right'
        ? x + col.width - padding
        : col.align === 'center'
          ? x + col.width / 2
          : x + padding;
      const textY = y + padding + baseLineHeight;
      doc.text(headerLines, textX, textY, { align: col.align || 'left', lineHeightFactor: 1.15 });
      x += col.width;
      doc.line(x, y, x, y + headerHeight);
    });
    y += headerHeight;
  };

  if (y + headerHeight > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }
  drawHeader();

  if (!rows || rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('No entries found', margin, y + 5);
    return y + 10;
  }

  const drawRow = (row, { isTotal = false, isStriped = false } = {}) => {
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(TABLE_FONT_SIZE);

    const cellLines = cols.map(col => {
      const raw = typeof col.format === 'function' ? col.format(row) : row[col.key];
      return wrapText(doc, raw, col.width - padding * 2);
    });
    const rowHeight = Math.max(
      minRowHeight,
      Math.max(...cellLines.map(lines => lines.length * lineHeight)) + padding * 2
    );

    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
      drawHeader();
    }

    if (isTotal) {
      doc.setFillColor(230, 230, 230);
      doc.rect(margin, y, availableWidth, rowHeight, 'F');
    } else if (isStriped) {
      doc.setFillColor(248, 248, 248);
      doc.rect(margin, y, availableWidth, rowHeight, 'F');
    }

    doc.setDrawColor(210, 210, 210);
    doc.rect(margin, y, availableWidth, rowHeight);

    let x = margin;
    cols.forEach((col, colIndex) => {
      const textX = col.align === 'right'
        ? x + col.width - padding
        : col.align === 'center'
          ? x + col.width / 2
          : x + padding;
      const textY = y + padding + baseLineHeight;
      doc.text(cellLines[colIndex], textX, textY, { align: col.align || 'left', lineHeightFactor: 1.15 });
      x += col.width;
      doc.line(x, y, x, y + rowHeight);
    });

    y += rowHeight;
  };

  rows.forEach((row, index) => {
    drawRow(row, { isStriped: index % 2 === 1 });
  });

  if (totalRow) {
    drawRow(totalRow, { isTotal: true });
  }

  return y + 4;
}

function addFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - PAGE_MARGIN, pageHeight - 6, { align: 'right' });
  }
}

/**
 * Generate Cutter Issue Summary PDF
 */
export async function generateCutterIssueSummaryPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = drawReportHeader(doc, 'Cutter Issue Summary', data.date);

  y = drawOverview(doc, y, [
    { label: 'Total Issues', value: formatNumber(data.totalCount) },
    { label: 'Total Pieces', value: formatNumber(data.totalPieces) },
    { label: 'Total Weight (kg)', value: formatWeight(data.totalWeight) },
    { label: 'Machines Used', value: formatNumber(data.totalMachines || 0) },
  ]);

  const columns = [
    { header: 'Machine', key: 'machine', width: 26 },
    { header: 'Item', key: 'item', width: 32 },
    { header: 'Lot', key: 'lotNo', width: 16 },
    { header: 'Cut', key: 'cut', width: 24 },
    { header: 'Operator', key: 'operator', width: 28 },
    { header: 'Pieces', key: 'pieces', width: 16, align: 'right', format: row => formatNumber(row.pieces) },
    { header: 'Weight (kg)', key: 'totalWeight', width: 18, align: 'right', format: row => formatWeight(row.totalWeight) },
    { header: 'Note', key: 'note', width: 26, format: row => safeText(row.note, '') },
  ];

  const rows = (data.tableRows || []).map(row => ({
    ...row,
    machine: safeText(row.machine, 'Unknown'),
    item: safeText(row.item, 'Unknown'),
    lotNo: safeText(row.lotNo, ''),
    cut: safeText(row.cut, 'Unknown'),
    operator: safeText(row.operator, 'Unknown'),
  }));

  const totalRow = {
    machine: 'Total',
    pieces: data.totalPieces || 0,
    totalWeight: data.totalWeight || 0,
  };

  y = drawTable(doc, y, {
    title: 'ISSUES BY MACHINE',
    columns,
    rows,
    totalRow,
  });

  addFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Cutter Receive Summary PDF
 */
export async function generateCutterReceiveSummaryPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = drawReportHeader(doc, 'Cutter Receive Summary', data.date);

  y = drawOverview(doc, y, [
    { label: 'Total Receives', value: formatNumber(data.totalCount) },
    { label: 'Total Bobbins', value: formatNumber(data.totalBobbins) },
    { label: 'Total Net Weight (kg)', value: formatWeight(data.totalNetWeight) },
    { label: 'Total Boxes', value: formatNumber(data.totalBoxes || 0) },
    { label: 'Total Challans', value: formatNumber(data.totalChallans) },
  ]);

  const columns = [
    { header: 'Item', key: 'item', width: 40 },
    { header: 'Cut', key: 'cut', width: 24 },
    { header: 'Machine No', key: 'machineNo', width: 22 },
    { header: 'Shift', key: 'shift', width: 14 },
    { header: 'Operator', key: 'operator', width: 32 },
    { header: 'Bobbins', key: 'totalBobbins', width: 16, align: 'right', format: row => formatNumber(row.totalBobbins) },
    { header: 'Net Wt (kg)', key: 'totalNetWeight', width: 22, align: 'right', format: row => formatWeight(row.totalNetWeight) },
    { header: 'Boxes', key: 'boxes', width: 16, align: 'right', format: row => formatNumber(row.boxes) },
  ];

  const rows = (data.tableRows || []).map(row => ({
    ...row,
    item: safeText(row.item, 'Unknown'),
    cut: safeText(row.cut, 'Unknown'),
    machineNo: safeText(row.machineNo, 'Unknown'),
    shift: safeText(row.shift, 'Unknown'),
    operator: safeText(row.operator, 'Unknown'),
  }));

  const totalRow = {
    item: 'Total',
    totalBobbins: data.totalBobbins || 0,
    totalNetWeight: data.totalNetWeight || 0,
    boxes: data.totalBoxes || 0,
  };

  y = drawTable(doc, y, {
    title: 'ITEM-WISE RECEIVE SUMMARY',
    columns,
    rows,
    totalRow,
  });

  addFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Holo Issue Summary PDF
 */
export async function generateHoloIssueSummaryPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = drawReportHeader(doc, 'Holo Issue Summary', data.date);

  y = drawOverview(doc, y, [
    { label: 'Total Issues', value: formatNumber(data.totalCount) },
    { label: 'Total Metallic Bobbins', value: formatNumber(data.totalMetallicBobbins) },
    { label: 'Total Bobbin Weight (kg)', value: formatWeight(data.totalBobbinWeight) },
    { label: 'Total Yarn (kg)', value: formatWeight(data.totalYarnKg) },
    { label: 'Machines Used', value: formatNumber(data.totalMachines || 0) },
  ]);

  const columns = [
    { header: 'Machine', key: 'machine', width: 24 },
    { header: 'Item', key: 'item', width: 30 },
    { header: 'Lot', key: 'lotNo', width: 16 },
    {
      header: 'Operator / Shift',
      key: 'operatorShift',
      width: 28,
      format: row => row.shift ? `${safeText(row.operator, 'Unknown')}\n${row.shift}` : safeText(row.operator, 'Unknown'),
    },
    {
      header: 'Yarn / Twist',
      key: 'yarnTwist',
      width: 28,
      format: row => row.twist ? `${safeText(row.yarn, '')}\n${row.twist}` : safeText(row.yarn, ''),
    },
    { header: 'Bobbins', key: 'metallicBobbins', width: 16, align: 'right', format: row => formatNumber(row.metallicBobbins) },
    { header: 'Bobbin Wt (kg)', key: 'bobbinWeight', width: 22, align: 'right', format: row => formatWeight(row.bobbinWeight) },
    { header: 'Yarn Kg', key: 'yarnKg', width: 18, align: 'right', format: row => formatWeight(row.yarnKg) },
  ];

  const rows = (data.tableRows || []).map(row => ({
    ...row,
    machine: safeText(row.machine, 'Unknown'),
    item: safeText(row.item, 'Unknown'),
    lotNo: safeText(row.lotNo, ''),
  }));

  const totalRow = {
    machine: 'Total',
    metallicBobbins: data.totalMetallicBobbins || 0,
    bobbinWeight: data.totalBobbinWeight || 0,
    yarnKg: data.totalYarnKg || 0,
  };

  y = drawTable(doc, y, {
    title: 'ISSUES BY MACHINE',
    columns,
    rows,
    totalRow,
  });

  addFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Holo Receive Summary PDF
 */
export async function generateHoloReceiveSummaryPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = drawReportHeader(doc, 'Holo Receive Summary', data.date);

  y = drawOverview(doc, y, [
    { label: 'Total Receives', value: formatNumber(data.totalCount) },
    { label: 'Total Rolls', value: formatNumber(data.totalRolls) },
    { label: 'Total Net Weight (kg)', value: formatWeight(data.totalNetWeight) },
    { label: 'Total Boxes', value: formatNumber(data.totalBoxes || 0) },
  ]);

  const columns = [
    { header: 'Item', key: 'item', width: 52 },
    { header: 'Machine No', key: 'machineNo', width: 26 },
    { header: 'Operator', key: 'operator', width: 36 },
    { header: 'Total Rolls', key: 'totalRolls', width: 20, align: 'right', format: row => formatNumber(row.totalRolls) },
    { header: 'Net Wt (kg)', key: 'totalNetWeight', width: 28, align: 'right', format: row => formatWeight(row.totalNetWeight) },
    { header: 'Boxes', key: 'boxes', width: 24, align: 'right', format: row => formatNumber(row.boxes) },
  ];

  const rows = (data.tableRows || []).map(row => ({
    ...row,
    item: safeText(row.item, 'Unknown'),
    machineNo: safeText(row.machineNo, 'Unknown'),
    operator: safeText(row.operator, 'Unknown'),
  }));

  const totalRow = {
    item: 'Total',
    totalRolls: data.totalRolls || 0,
    totalNetWeight: data.totalNetWeight || 0,
    boxes: data.totalBoxes || 0,
  };

  y = drawTable(doc, y, {
    title: 'ITEM-WISE RECEIVE SUMMARY',
    columns,
    rows,
    totalRow,
  });

  addFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Coning Issue Summary PDF
 */
export async function generateConingIssueSummaryPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = drawReportHeader(doc, 'Coning Issue Summary', data.date);

  y = drawOverview(doc, y, [
    { label: 'Total Issues', value: formatNumber(data.totalCount) },
    { label: 'Total Rolls Issued', value: formatNumber(data.totalRollsIssued) },
    { label: 'Total Issue Weight (kg)', value: formatWeight(data.totalIssueWeight || data.totalWeight || 0) },
    { label: 'Expected Cones', value: formatNumber(data.totalExpectedCones) },
  ]);

  const columns = [
    { header: 'Machine', key: 'machine', width: 24 },
    { header: 'Item', key: 'item', width: 28 },
    { header: 'Lot', key: 'lotNo', width: 16 },
    {
      header: 'Operator / Shift',
      key: 'operatorShift',
      width: 30,
      format: row => row.shift ? `${safeText(row.operator, 'Unknown')}\n${row.shift}` : safeText(row.operator, 'Unknown'),
    },
    { header: 'Rolls Issued', key: 'rollsIssued', width: 20, align: 'right', format: row => formatNumber(row.rollsIssued) },
    { header: 'Issue Wt (kg)', key: 'issueWeight', width: 24, align: 'right', format: row => formatWeight(row.issueWeight) },
    { header: 'Target Wt (g)', key: 'targetWeight', width: 22, align: 'right', format: row => formatNumber(row.targetWeight) },
    { header: 'Expected Cones', key: 'expectedCones', width: 22, align: 'right', format: row => formatNumber(row.expectedCones) },
  ];

  const rows = (data.tableRows || []).map(row => ({
    ...row,
    machine: safeText(row.machine, 'Unknown'),
    item: safeText(row.item, 'Unknown'),
    lotNo: safeText(row.lotNo, ''),
  }));

  const totalRow = {
    machine: 'Total',
    rollsIssued: data.totalRollsIssued || 0,
    issueWeight: data.totalIssueWeight || data.totalWeight || 0,
    expectedCones: data.totalExpectedCones || 0,
  };

  y = drawTable(doc, y, {
    title: 'ISSUES BY MACHINE',
    columns,
    rows,
    totalRow,
  });

  addFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Coning Receive Summary PDF
 */
export async function generateConingReceiveSummaryPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = drawReportHeader(doc, 'Coning Receive Summary', data.date);

  y = drawOverview(doc, y, [
    { label: 'Total Receives', value: formatNumber(data.totalCount) },
    { label: 'Total Cones', value: formatNumber(data.totalCones) },
    { label: 'Total Net Weight (kg)', value: formatWeight(data.totalNetWeight) },
    { label: 'Total Boxes', value: formatNumber(data.totalBoxes || 0) },
  ]);

  const columns = [
    { header: 'Item', key: 'item', width: 52 },
    { header: 'Machine No', key: 'machineNo', width: 26 },
    { header: 'Operator', key: 'operator', width: 36 },
    { header: 'Total Cones', key: 'totalCones', width: 20, align: 'right', format: row => formatNumber(row.totalCones) },
    { header: 'Net Wt (kg)', key: 'totalNetWeight', width: 28, align: 'right', format: row => formatWeight(row.totalNetWeight) },
    { header: 'Boxes', key: 'boxes', width: 24, align: 'right', format: row => formatNumber(row.boxes) },
  ];

  const rows = (data.tableRows || []).map(row => ({
    ...row,
    item: safeText(row.item, 'Unknown'),
    machineNo: safeText(row.machineNo, 'Unknown'),
    operator: safeText(row.operator, 'Unknown'),
  }));

  const totalRow = {
    item: 'Total',
    totalCones: data.totalCones || 0,
    totalNetWeight: data.totalNetWeight || 0,
    boxes: data.totalBoxes || 0,
  };

  y = drawTable(doc, y, {
    title: 'ITEM-WISE RECEIVE SUMMARY',
    columns,
    rows,
    totalRow,
  });

  addFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Main generator function that dispatches to correct PDF generator
 */
export async function generateSummaryPDF(stage, type, data) {
  const key = `${stage}_${type}`;
  switch (key) {
    case 'cutter_issue':
      return await generateCutterIssueSummaryPDF(data);
    case 'cutter_receive':
      return await generateCutterReceiveSummaryPDF(data);
    case 'holo_issue':
      return await generateHoloIssueSummaryPDF(data);
    case 'holo_receive':
      return await generateHoloReceiveSummaryPDF(data);
    case 'coning_issue':
      return await generateConingIssueSummaryPDF(data);
    case 'coning_receive':
      return await generateConingReceiveSummaryPDF(data);
    default:
      throw new Error(`Unknown stage/type combination: ${stage}/${type}`);
  }
}
