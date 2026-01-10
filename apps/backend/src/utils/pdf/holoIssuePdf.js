/**
 * Holo Issue Summary PDF Generator
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
 * Generate Holo Issue Summary PDF
 * @param {object} data - Summary data including details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateHoloIssuePdf(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header
    let y = drawHeader(doc, {
        title: 'Holo Issue Summary',
        date: data.date,
        pageWidth,
    });

    // Overview section
    const metrics = [
        { label: 'Total Issues', value: formatNumber(data.totalCount) },
        { label: 'Metallic Bobbins', value: formatNumber(data.totalMetallicBobbins) },
        { label: 'Bobbin Weight', value: `${formatWeight(data.totalBobbinWeight)} kg` },
        { label: 'Yarn Weight', value: `${formatWeight(data.totalYarnKg)} kg` },
    ];
    y = drawOverview(doc, { y, metrics, pageWidth });

    // Prepare table data
    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Yarn', align: 'left' },
        { text: 'Operator', align: 'left' },
        { text: 'Shift', align: 'center' },
        { text: 'M. Bobbins', align: 'right' },
        { text: 'Bob Wt (kg)', align: 'right' },
        { text: 'Yarn (kg)', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [10, 25, 30, 25, 20, 20, 25, 30, 15, 22, 25, 22];

    const rows = [];
    let totalBobbins = 0;
    let totalBobbinWeight = 0;
    let totalYarnKg = 0;

    if (data.details && data.details.length > 0) {
        data.details.forEach((item, idx) => {
            const bobbins = Number(item.metallicBobbins || 0);
            const bobbinWeight = Number(item.metallicBobbinsWeight || 0);
            const yarnKg = Number(item.yarnKg || 0);
            totalBobbins += bobbins;
            totalBobbinWeight += bobbinWeight;
            totalYarnKg += yarnKg;

            rows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.machineName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.lotNo || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: item.yarnName || '-', align: 'left' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: item.shift || '-', align: 'center' },
                    { text: formatNumber(bobbins), align: 'right' },
                    { text: formatWeight(bobbinWeight), align: 'right' },
                    { text: formatWeight(yarnKg), align: 'right' },
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
                { text: '', align: 'left' },
                { text: '', align: 'center' },
                { text: formatNumber(totalBobbins), align: 'right' },
                { text: formatWeight(totalBobbinWeight), align: 'right' },
                { text: formatWeight(totalYarnKg), align: 'right' },
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
