/**
 * Shared PDF Helper Utilities
 * Common functions used across all PDF generators
 */

let jsPDFModule = null;

export async function getJsPDF() {
    if (!jsPDFModule) {
        const jspdfModule = await import('jspdf');
        jsPDFModule = jspdfModule.jsPDF || jspdfModule.default?.jsPDF || jspdfModule.default;
    }
    return jsPDFModule;
}

/**
 * Format date from YYYY-MM-DD to DD/MM/YYYY
 */
export function formatDateDDMMYYYY(dateStr) {
    if (!dateStr) return '';
    const str = String(dateStr).trim();
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [, yyyy, mm, dd] = match;
        return `${dd}/${mm}/${yyyy}`;
    }
    return str;
}

/**
 * Format weight to 3 decimal places
 */
export function formatWeight(val) {
    const num = Number(val);
    return Number.isFinite(num) ? num.toFixed(3) : '0.000';
}

/**
 * Format number with Indian locale
 */
export function formatNumber(val) {
    const num = Number(val);
    return Number.isFinite(num) ? num.toLocaleString('en-IN') : '0';
}

/**
 * Draw a professional header for the PDF
 */
export function drawHeader(doc, { title, date, pageWidth }) {
    let y = 15;

    // Company name
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(44, 62, 80); // Dark blue-gray
    doc.text('GLINTEX', pageWidth / 2, y, { align: 'center' });
    y += 8;

    // Report title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(52, 73, 94);
    doc.text(title, pageWidth / 2, y, { align: 'center' });
    y += 7;

    // Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Date: ${formatDateDDMMYYYY(date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Horizontal line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(15, y, pageWidth - 15, y);
    y += 8;

    return y;
}

/**
 * Draw overview cards section
 */
export function drawOverview(doc, { y, metrics, pageWidth }) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(44, 62, 80);
    doc.text('OVERVIEW', 15, y);
    y += 6;

    // Draw metrics in a clean card-like layout
    const cardPadding = 5;
    const cardWidth = (pageWidth - 40) / Math.min(metrics.length, 4);
    let startX = 15;

    metrics.forEach((metric, idx) => {
        const x = startX + (idx % 4) * cardWidth;

        // Card background
        doc.setFillColor(248, 249, 250);
        doc.roundedRect(x, y, cardWidth - 5, 18, 2, 2, 'F');

        // Metric label
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(metric.label, x + cardPadding, y + 6);

        // Metric value
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text(String(metric.value), x + cardPadding, y + 14);
    });

    return y + 25;
}

/**
 * Draw a professional data table
 * @param {object} doc - jsPDF document
 * @param {object} options - Table options
 * @returns {number} - New Y position after table
 */
export function drawTable(doc, { y, headers, rows, colWidths, pageWidth, title }) {
    const startX = 15;
    const rowHeight = 7;
    const headerHeight = 8;
    const padding = 2;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 25;
    const lineHeight = 3.5;

    // Section title if provided
    if (title) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text(title, startX, y);
        y += 6;
    }

    // Calculate column positions
    const colPositions = [startX];
    colWidths.forEach((w, i) => {
        colPositions.push(colPositions[i] + w);
    });
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);

    // Draw header background
    doc.setFillColor(52, 73, 94); // Dark header color
    doc.rect(startX, y, tableWidth, headerHeight, 'F');

    // Draw header text
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    headers.forEach((header, i) => {
        const text = String(header.text || header);
        const align = header.align || 'left';
        let xPos = colPositions[i] + padding;
        if (align === 'right') {
            xPos = colPositions[i + 1] - padding;
        } else if (align === 'center') {
            xPos = colPositions[i] + colWidths[i] / 2;
        }
        doc.text(text, xPos, y + 5.5, { align });
    });
    y += headerHeight;

    // Draw rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    rows.forEach((row, rowIdx) => {
        const maxLines = row.cells.reduce((max, cell, i) => {
            const header = headers[i] || {};
            if (!header.wrap) return Math.max(max, 1);
            const text = String(cell?.text ?? cell ?? '');
            const maxWidth = colWidths[i] - (padding * 2);
            const lines = doc.splitTextToSize(text, maxWidth);
            return Math.max(max, lines.length || 1);
        }, 1);
        const rowHeightDynamic = rowHeight * maxLines;

        // Check for page break
        if (y + rowHeightDynamic > pageHeight - bottomMargin) {
            doc.addPage();
            y = 20;

            // Redraw header on new page
            doc.setFillColor(52, 73, 94);
            doc.rect(startX, y, tableWidth, headerHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            headers.forEach((header, i) => {
                const text = String(header.text || header);
                const align = header.align || 'left';
                let xPos = colPositions[i] + padding;
                if (align === 'right') {
                    xPos = colPositions[i + 1] - padding;
                } else if (align === 'center') {
                    xPos = colPositions[i] + colWidths[i] / 2;
                }
                doc.text(text, xPos, y + 5.5, { align });
            });
            y += headerHeight;
            doc.setFont('helvetica', 'normal');
        }

        // Alternate row background
        if (rowIdx % 2 === 0) {
            doc.setFillColor(248, 249, 250);
            doc.rect(startX, y, tableWidth, rowHeightDynamic, 'F');
        }

        // Check if this is a totals row
        const isTotalsRow = row.isTotal;
        if (isTotalsRow) {
            doc.setFillColor(233, 236, 239);
            doc.rect(startX, y, tableWidth, rowHeightDynamic, 'F');
            doc.setFont('helvetica', 'bold');
        }

        doc.setTextColor(44, 62, 80);
        row.cells.forEach((cell, i) => {
            const text = String(cell.text ?? cell);
            const align = cell.align || headers[i]?.align || 'left';
            let xPos = colPositions[i] + padding;
            if (align === 'right') {
                xPos = colPositions[i + 1] - padding;
            } else if (align === 'center') {
                xPos = colPositions[i] + colWidths[i] / 2;
            }

            const maxWidth = colWidths[i] - (padding * 2);
            if (headers[i]?.wrap) {
                const lines = doc.splitTextToSize(text, maxWidth);
                lines.forEach((line, idx) => {
                    doc.text(line, xPos, y + 5 + idx * lineHeight, { align });
                });
            } else {
                let displayText = text;
                while (doc.getTextWidth(displayText) > maxWidth && displayText.length > 3) {
                    displayText = displayText.slice(0, -4) + '...';
                }
                doc.text(displayText, xPos, y + 5, { align });
            }
        });

        if (isTotalsRow) {
            doc.setFont('helvetica', 'normal');
        }

        y += rowHeightDynamic;
    });

    // Draw table border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.rect(startX, y - (rows.length * rowHeight) - headerHeight, tableWidth, (rows.length * rowHeight) + headerHeight);

    return y + 5;
}

/**
 * Draw footer
 */
export function drawFooter(doc, pageHeight) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, pageHeight - 10);
}
