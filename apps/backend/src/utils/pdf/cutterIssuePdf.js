/**
 * Cutter Issue Summary PDF Generator
 * Professional PDF with overview and detailed table by machine
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
 * Generate Cutter Issue Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateCutterIssuePdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Cutter Issue Summary',
        date: data.date,
        pageWidth,
    });

    // Overview section
    const metrics = [
        { label: 'Total Issues', value: formatNumber(data.totalCount) },
        { label: 'Total Pieces', value: formatNumber(data.totalPieces) },
        { label: 'Total Weight', value: `${formatWeight(data.totalWeight)} kg` },
    ];
    y = drawOverview(doc, { y, metrics, pageWidth });

    // Prepare table data
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Operator', align: 'left' },
        { text: 'Note', align: 'left' },
        { text: 'Pieces', align: 'right' },
        { text: 'Weight (kg)', align: 'right' },
    ];

    // Column widths for landscape A4 (297mm width - 30mm margins = 267mm)
    const colWidths = [12, 35, 40, 30, 25, 35, 40, 20, 30];

    const rows = [];
    let totalPieces = 0;
    let totalWeight = 0;

    if (data.details && data.details.length > 0) {
        data.details.forEach((item, idx) => {
            const pieces = Number(item.count || 0);
            const weight = Number(item.totalWeight || 0);
            totalPieces += pieces;
            totalWeight += weight;

            rows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.machineName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: item.note || '-', align: 'left' },
                    { text: formatNumber(pieces), align: 'right' },
                    { text: formatWeight(weight), align: 'right' },
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
                { text: formatNumber(totalPieces), align: 'right' },
                { text: formatWeight(totalWeight), align: 'right' },
            ],
        });
    }

    y = drawTable(doc, {
        y,
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Issue Details by Machine',
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
