/**
 * Coning Receive Summary PDF Generator
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
 * Generate Coning Receive Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateConingReceivePdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Coning Receive Summary',
        date: data.date,
        pageWidth,
    });

    // Overview section
    const metrics = [
        { label: 'Total Entries', value: formatNumber(data.totalCount) },
        { label: 'Total Cones', value: formatNumber(data.totalCones) },
        { label: 'Total Net Weight', value: `${formatWeight(data.totalNetWeight)} kg` },
    ];
    y = drawOverview(doc, { y, metrics, pageWidth });

    // Prepare table data
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Yarn', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Cone Type', align: 'left' },
        { text: 'Target (g)', align: 'right' },
        { text: 'Actual (g)', align: 'right' },
        { text: 'Operator', align: 'left' },
        { text: 'Cones', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [8, 26, 30, 22, 18, 18, 22, 16, 16, 26, 18, 22];

    const rows = [];
    let totalCones = 0;
    let totalNetWeight = 0;

    if (data.details && data.details.length > 0) {
        data.details.forEach((item, idx) => {
            const cones = Number(item.coneCount || 0);
            const netWeight = Number(item.netWeight || 0);
            totalCones += cones;
            totalNetWeight += netWeight;

            const actualPerCone = cones > 0 ? (netWeight * 1000) / cones : 0;
            rows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.machineName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: item.yarnName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: item.coneTypeName || '-', align: 'left' },
                    { text: formatNumber(item.perConeTargetG || 0), align: 'right' },
                    { text: formatNumber(Math.round(actualPerCone || 0)), align: 'right' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: formatNumber(cones), align: 'right' },
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
                { text: '', align: 'left' },
                { text: '', align: 'right' },
                { text: '', align: 'right' },
                { text: '', align: 'left' },
                { text: formatNumber(totalCones), align: 'right' },
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
