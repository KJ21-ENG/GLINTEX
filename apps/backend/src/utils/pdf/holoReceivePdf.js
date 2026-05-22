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

    const summaryHeaders = [
        { text: 'Machine', align: 'left' },
        { text: 'Yarn', align: 'left' },
        { text: 'Item', align: 'left', wrap: true },
        { text: 'Cut', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Rolls', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
    ];
    const summaryColWidths = [30, 34, 56, 34, 34, 32, 47];

    const detailHeaders = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Yarn', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Rolls', align: 'right' },
        { text: 'Net Wt (kg)', align: 'right' },
    ];
    const detailColWidths = [12, 30, 34, 46, 34, 34, 32, 45];

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
                item.yarnName || '-',
                item.itemName || '-',
                item.cutName || '-',
                item.twistName || '-',
            ].join('||');
            if (!summaryGroupedMap.has(summaryKey)) {
                summaryGroupedMap.set(summaryKey, {
                    machineNames: new Set(),
                    yarnName: item.yarnName || '-',
                    itemName: item.itemName || '-',
                    cutName: item.cutName || '-',
                    twistName: item.twistName || '-',
                    rollCount: 0,
                    netWeight: 0,
                });
            }
            const summaryEntry = summaryGroupedMap.get(summaryKey);
            summaryEntry.machineNames.add(item.machineName || '-');
            summaryEntry.rollCount += rolls;
            summaryEntry.netWeight += netWeight;

            detailsRows.push({
                cells: [
                    { text: String(idx + 1), align: 'center' },
                    { text: item.machineName || '-', align: 'left' },
                    { text: item.yarnName || '-', align: 'left' },
                    { text: item.itemName || '-', align: 'left' },
                    { text: item.cutName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: formatNumber(rolls), align: 'right' },
                    { text: formatWeight(netWeight), align: 'right' },
                ],
            });
        });

        Array.from(summaryGroupedMap.values())
            .sort((a, b) => (
                String(a.yarnName || '').localeCompare(String(b.yarnName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.itemName || '').localeCompare(String(b.itemName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.cutName || '').localeCompare(String(b.cutName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.twistName || '').localeCompare(String(b.twistName || ''), undefined, { numeric: true, sensitivity: 'base' })
            ))
            .forEach((entry) => {
                summaryRows.push({
                    cells: [
                        { text: Array.from(entry.machineNames).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })).join(', '), align: 'left' },
                        { text: entry.yarnName, align: 'left' },
                        { text: entry.itemName, align: 'left' },
                        { text: entry.cutName, align: 'left' },
                        { text: entry.twistName, align: 'left' },
                        { text: formatNumber(entry.rollCount), align: 'right' },
                        { text: formatWeight(entry.netWeight), align: 'right' },
                    ],
                });
            });

        // Totals row
        detailsRows.push({
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
        headers: summaryHeaders,
        rows: summaryRows,
        colWidths: summaryColWidths,
        pageWidth,
        title: 'Summary (Grouped by Yarn/Item/Cut/Twist)',
        rowHeight: 6,
        headerHeight: 7,
        padding: 1.5,
        bottomMargin: 15,
        lineHeight: 3,
    });

    y = drawTable(doc, {
        y,
        headers: detailHeaders,
        rows: detailsRows,
        colWidths: detailColWidths,
        pageWidth,
        title: 'Receive Details (Base Machine Grouped)',
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
