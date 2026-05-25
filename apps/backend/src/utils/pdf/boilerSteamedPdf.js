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

    // Detailed table headers
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Barcode', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Boiler', align: 'left' },
        { text: 'Rolls', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
        { text: 'Steamed At', align: 'center' },
        { text: 'Added By', align: 'left' },
    ];

    // Column widths for landscape A4 (sum to 267)
    const colWidths = [10, 35, 42, 22, 18, 18, 32, 16, 24, 25, 25];

    const rows = [];
    let totalRolls = 0;
    let totalNetWeight = 0;

    if (data.details && data.details.length > 0) {
        data.details.forEach((item, idx) => {
            const rolls = Number(item.rollCount || 0);
            const netWeight = Number(item.netWeight || 0);
            totalRolls += rolls;
            totalNetWeight += netWeight;

            rows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.barcode || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: item.boilerLabel || '-', align: 'left' },
                    { text: formatNumber(rolls), align: 'right' },
                    { text: formatWeight(netWeight), align: 'right' },
                    { text: formatTime(item.steamedAt), align: 'center' },
                    { text: item.addedBy || '-', align: 'left' },
                ],
            });
        });

        // Totals row
        rows.push({
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

    y = drawTable(doc, {
        y,
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Steamed Items Details',
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
