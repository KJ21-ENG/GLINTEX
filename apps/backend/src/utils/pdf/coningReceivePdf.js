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
        { text: 'Yarn', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Operator', align: 'left' },
        { text: 'Cone Type', align: 'left' },
        { text: 'Target (g)', align: 'right' },
        { text: 'Actual (g)', align: 'right' },
        { text: 'Cones', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [8, 24, 18, 18, 26, 20, 22, 22, 16, 16, 16, 22];

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
                    { text: item.yarnName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.operatorName || '-', align: 'left' },
                    { text: item.coneTypeName || '-', align: 'left' },
                    { text: formatNumber(item.perConeTargetG || 0), align: 'right' },
                    { text: formatNumber(Math.round(actualPerCone || 0)), align: 'right' },
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
                { text: '', align: 'left' },
                { text: '', align: 'right' },
                { text: '', align: 'right' },
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

    // Summary table (grouped averages)
    if (data.details && data.details.length > 0) {
        const summaryMap = new Map();
        data.details.forEach((item) => {
            const key = [
                item.machineName || '-',
                item.yarnName || '-',
                item.twistName || '-',
                item.itemName || '-',
                item.cutName || '-',
                item.coneTypeName || '-',
            ].join('||');
            if (!summaryMap.has(key)) {
                summaryMap.set(key, {
                    machineName: item.machineName || '-',
                    yarnName: item.yarnName || '-',
                    twistName: item.twistName || '-',
                    itemName: item.itemName || '-',
                    cutName: item.cutName || '-',
                    coneTypeName: item.coneTypeName || '-',
                    totalNetWeight: 0,
                    totalCones: 0,
                    targetSum: 0,
                    rowCount: 0,
                });
            }
            const entry = summaryMap.get(key);
            const cones = Number(item.coneCount || 0);
            const netWeight = Number(item.netWeight || 0);
            const target = Number(item.perConeTargetG || 0);
            entry.totalNetWeight += netWeight;
            entry.totalCones += cones;
            if (Number.isFinite(target) && target > 0) {
                entry.targetSum += target;
            }
            entry.rowCount += 1;
        });

        const summaryHeaders = [
            { text: 'Machine', align: 'left' },
            { text: 'Yarn', align: 'left' },
            { text: 'Twist', align: 'left' },
            { text: 'Item', align: 'left' },
            { text: 'Cut', align: 'left' },
            { text: 'Cone Type', align: 'left' },
            { text: 'Total Net Wt (kg)', align: 'right' },
            { text: 'Target Wt Avg (g)', align: 'right' },
            { text: 'Actual Wt Avg (g)', align: 'right' },
        ];

        const summaryColWidths = [26, 18, 18, 26, 20, 22, 24, 22, 22];

        const summaryRows = [];
        summaryMap.forEach((entry) => {
            const totalCones = entry.totalCones;
            const targetAvg = entry.rowCount > 0 ? entry.targetSum / entry.rowCount : 0;
            const actualAvg = totalCones > 0 ? (entry.totalNetWeight * 1000) / totalCones : 0;
            summaryRows.push({
                cells: [
                    { text: entry.machineName, align: 'left' },
                    { text: entry.yarnName, align: 'left' },
                    { text: entry.twistName, align: 'left' },
                    { text: entry.itemName, align: 'left' },
                    { text: entry.cutName, align: 'left' },
                    { text: entry.coneTypeName, align: 'left' },
                    { text: formatWeight(entry.totalNetWeight), align: 'right' },
                    { text: formatNumber(Math.round(targetAvg || 0)), align: 'right' },
                    { text: formatNumber(Math.round(actualAvg || 0)), align: 'right' },
                ],
            });
        });

        y = drawTable(doc, {
            y,
            headers: summaryHeaders,
            rows: summaryRows,
            colWidths: summaryColWidths,
            pageWidth,
            title: 'Summary (Avg per Cone)',
        });
    }

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
