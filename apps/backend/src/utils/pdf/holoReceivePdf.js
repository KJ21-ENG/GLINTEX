/**
 * Holo Receive Summary PDF Generator
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
 * Generate Holo Receive Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateHoloReceivePdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Holo Receive Summary',
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

    // Prepare table data
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Operator', align: 'left' },
        { text: 'Box', align: 'left' },
        { text: 'Roll Count', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [12, 35, 45, 35, 40, 35, 30, 35];

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
                    { text: item.machineName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: item.boxName || '-', align: 'left' },
                    { text: formatNumber(rolls), align: 'right' },
                    { text: formatWeight(netWeight), align: 'right' },
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
                { text: formatNumber(totalRolls), align: 'right' },
                { text: formatWeight(totalNetWeight), align: 'right' },
            ],
        });
    }

    y = drawTable(doc, {
        y,
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Receive Details',
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
