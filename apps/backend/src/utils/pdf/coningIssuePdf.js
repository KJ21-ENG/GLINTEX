/**
 * Coning Issue Summary PDF Generator
 * Professional PDF with overview and detailed table
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
 * Generate Coning Issue Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateConingIssuePdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Coning Issue Summary',
        date: data.date,
        pageWidth,
    });

    // Overview section
    const metrics = [
        { label: 'Total Issues', value: formatNumber(data.totalCount) },
        { label: 'Total Rolls Issued', value: formatNumber(data.totalRollsIssued) },
        { label: 'Expected Cones', value: formatNumber(data.totalExpectedCones) },
    ];
    y = drawOverview(doc, { y, metrics, pageWidth });

    // Prepare table data
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Operator', align: 'left' },
        { text: 'Shift', align: 'center' },
        { text: 'Note', align: 'left' },
        { text: 'Rolls Issued', align: 'right' },
        { text: 'Expected Cones', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [12, 35, 45, 35, 40, 20, 40, 30, 30];

    const rows = [];
    let totalRolls = 0;
    let totalCones = 0;

    if (data.details && data.details.length > 0) {
        data.details.forEach((item, idx) => {
            const rolls = Number(item.rollsIssued || 0);
            const cones = Number(item.expectedCones || 0);
            totalRolls += rolls;
            totalCones += cones;

            rows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.machineName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: item.shift || '-', align: 'center' },
                    { text: item.note || '-', align: 'left' },
                    { text: formatNumber(rolls), align: 'right' },
                    { text: formatNumber(Math.round(cones)), align: 'right' },
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
                { text: '', align: 'center' },
                { text: '', align: 'left' },
                { text: formatNumber(totalRolls), align: 'right' },
                { text: formatNumber(Math.round(totalCones)), align: 'right' },
            ],
        });
    }

    y = drawTable(doc, {
        y,
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Issue Details',
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
