/**
 * Boiler Steamed Summary PDF Generator
 * Professional PDF with overview and detailed table of steamed items
 */

import {
    getJsPDF,
    formatWeight,
    formatNumber,
    drawHeader,
    drawOverview,
    drawTable,
    drawFooter,
} from './pdfHelpers.js';

/**
 * Format timestamp to 12-hour time string
 */
function formatTime(val) {
    if (!val) return '-';
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return '-';
        return d.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        });
    } catch {
        return '-';
    }
}

/**
 * Generate Boiler Steamed Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateBoilerSteamedPdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Boiler Steamed Summary',
        date: data.date,
        pageWidth,
    });

    // Overview section
    const metrics = [
        { label: 'Total Entries', value: formatNumber(data.totalCount) },
        { label: 'Total Rolls', value: formatNumber(data.totalRolls) },
        { label: 'Total Net Weight', value: `${formatWeight(data.totalNetWeight)} kg` },
    ];
    y = drawOverview(doc, { y, metrics, pageWidth });

    // Summary table headers
    const summaryHeaders = [
        { text: 'Item', align: 'left', wrap: true },
        { text: 'Boilers', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Rolls', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
    ];
    // Column widths for landscape A4 (sum to 267)
    const summaryColWidths = [60, 60, 35, 30, 32, 50];

    // Detailed table headers
    const detailHeaders = [
        { text: 'S.No', align: 'center' },
        { text: 'Barcode', align: 'left' },
        { text: 'Boiler', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Rolls', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
        { text: 'Steamed At', align: 'center' },
        { text: 'Added By', align: 'left' },
    ];
    // Column widths for landscape A4 (sum to 267)
    const detailColWidths = [10, 35, 32, 42, 22, 18, 18, 16, 24, 25, 25];

    const summaryRows = [];
    const detailsRows = [];
    let totalRolls = 0;
    let totalNetWeight = 0;

    if (data.details && data.details.length > 0) {
        const summaryGroupedMap = new Map();

        data.details.forEach((item, idx) => {
            const rolls = Number(item.rollCount || 0);
            const netWeight = Number(item.netWeight || 0);
            totalRolls += rolls;
            totalNetWeight += netWeight;

            const summaryKey = [
                item.itemName || '-',
                item.twistName || '-',
                item.cutName || '-',
            ].join('||');

            if (!summaryGroupedMap.has(summaryKey)) {
                summaryGroupedMap.set(summaryKey, {
                    boilerLabels: new Set(),
                    itemName: item.itemName || '-',
                    twistName: item.twistName || '-',
                    cutName: item.cutName || '-',
                    rollCount: 0,
                    netWeight: 0,
                });
            }

            const summaryEntry = summaryGroupedMap.get(summaryKey);
            if (item.boilerLabel && item.boilerLabel !== '-') {
                summaryEntry.boilerLabels.add(item.boilerLabel);
            }
            summaryEntry.rollCount += rolls;
            summaryEntry.netWeight += netWeight;

            detailsRows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.barcode || '-', align: 'left' },
                    { text: item.boilerLabel || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: formatNumber(rolls), align: 'right' },
                    { text: formatWeight(netWeight), align: 'right' },
                    { text: formatTime(item.steamedAt), align: 'center' },
                    { text: item.addedBy || '-', align: 'left' },
                ],
            });
        });

        // Generate summary rows
        Array.from(summaryGroupedMap.values())
            .sort((a, b) => (
                String(a.itemName || '').localeCompare(String(b.itemName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.twistName || '').localeCompare(String(b.twistName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.cutName || '').localeCompare(String(b.cutName || ''), undefined, { numeric: true, sensitivity: 'base' })
            ))
            .forEach((entry) => {
                const boilersList = Array.from(entry.boilerLabels).sort().join(', ') || '-';
                summaryRows.push({
                    cells: [
                        { text: entry.itemName, align: 'left' },
                        { text: boilersList, align: 'left' },
                        { text: entry.twistName, align: 'left' },
                        { text: entry.cutName, align: 'left' },
                        { text: formatNumber(entry.rollCount), align: 'right' },
                        { text: formatWeight(entry.netWeight), align: 'right' },
                    ],
                });
            });

        // Totals row for detailed list
        detailsRows.push({
            isTotal: true,
            cells: [
                { text: '', align: 'center' },
                { text: 'TOTAL', align: 'left' },
                { text: '', align: 'left' },
                { text: '', align: 'left' },
                { text: '', align: 'left' },
                { text: '', align: 'left' },
                { text: '', align: 'left' },
                { text: formatNumber(totalRolls), align: 'right' },
                { text: formatWeight(totalNetWeight), align: 'right' },
                { text: '', align: 'center' },
                { text: '', align: 'left' },
            ],
        });
    }

    // Draw summary table
    y = drawTable(doc, {
        y,
        headers: summaryHeaders,
        rows: summaryRows,
        colWidths: summaryColWidths,
        pageWidth,
        title: 'Summary (Grouped by Item/Twist/Cut)',
        rowHeight: 6,
        headerHeight: 7,
        padding: 1.5,
        bottomMargin: 15,
        lineHeight: 3,
    });

    // Draw detailed table
    y = drawTable(doc, {
        y,
        headers: detailHeaders,
        rows: detailsRows,
        colWidths: detailColWidths,
        pageWidth,
        title: 'Steamed Items Details',
        rowHeight: 6,
        headerHeight: 7,
        padding: 1.5,
        bottomMargin: 15,
        lineHeight: 3,
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
