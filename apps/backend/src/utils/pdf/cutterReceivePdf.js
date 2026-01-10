/**
 * Cutter Receive Summary PDF Generator
 * Professional PDF with overview and item-wise detailed table
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
 * Generate Cutter Receive Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateCutterReceivePdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Cutter Receive Summary',
        date: data.date,
        pageWidth,
    });

    // Overview section
    const metrics = [
        { label: 'Total Entries', value: formatNumber(data.totalCount) },
        { label: 'Total Bobbins', value: formatNumber(data.totalBobbins) },
        { label: 'Total Net Weight', value: `${formatWeight(data.totalNetWeight)} kg` },
        { label: 'Total Challans', value: formatNumber(data.totalChallans) },
    ];
    y = drawOverview(doc, { y, metrics, pageWidth });

    // Prepare table data
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Item', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Machine', align: 'left' },
        { text: 'Shift', align: 'center' },
        { text: 'Operator', align: 'left' },
        { text: 'Net Wt (kg)', align: 'right' },
        { text: 'Bobbins', align: 'right' },
        { text: 'Boxes', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [12, 45, 30, 30, 20, 40, 30, 25, 20];

    const rows = [];
    let totalNetWeight = 0;
    let totalBobbins = 0;
    let totalBoxes = 0;

    if (data.details && data.details.length > 0) {
        data.details.forEach((item, idx) => {
            const netWeight = Number(item.netWeight || 0);
            const bobbins = Number(item.bobbinCount || 0);
            const boxes = Number(item.boxCount || 0);
            totalNetWeight += netWeight;
            totalBobbins += bobbins;
            totalBoxes += boxes;

            rows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.machineNo || '-', align: 'left' },
                    { text: item.shift || '-', align: 'center' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: formatWeight(netWeight), align: 'right' },
                    { text: formatNumber(bobbins), align: 'right' },
                    { text: formatNumber(boxes), align: 'right' },
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
                { text: '', align: 'center' },
                { text: '', align: 'left' },
                { text: formatWeight(totalNetWeight), align: 'right' },
                { text: formatNumber(totalBobbins), align: 'right' },
                { text: formatNumber(totalBoxes), align: 'right' },
            ],
        });
    }

    y = drawTable(doc, {
        y,
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Receive Details (Item-wise)',
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
