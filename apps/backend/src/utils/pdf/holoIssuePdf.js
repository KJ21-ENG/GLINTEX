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
    const details = [...(data.details || [])];

    // Sort details by machine name
    if (details.length > 0) {
        details.sort((a, b) => {
            const nameA = a.machineName || '';
            const nameB = b.machineName || '';
            return nameA.localeCompare(nameB, 'en', { numeric: true, sensitivity: 'base' });
        });
    }

    const summaryHeaders = [
        { text: 'Yarn', align: 'left' },
        { text: 'Item', align: 'left', wrap: true },
        { text: 'Cut', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Machine', align: 'left' },
        { text: 'M. Bobbins', align: 'right' },
        { text: 'Bob Wt (kg)', align: 'right' },
        { text: 'Yarn (kg)', align: 'right' },
    ];
    const summaryColWidths = [30, 50, 30, 30, 37, 30, 30, 30];

    const summaryRows = [];
    if (details.length > 0) {
        const summaryGroupedMap = new Map();
        details.forEach((item) => {
            const bobbins = Number(item.metallicBobbins || 0);
            const bobbinWeight = Number(item.metallicBobbinsWeight || 0);
            const yarnKg = Number(item.yarnKg || 0);

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
                    bobbins: 0,
                    bobbinWeight: 0,
                    yarnKg: 0,
                });
            }

            const summaryEntry = summaryGroupedMap.get(summaryKey);
            summaryEntry.machineNames.add(item.machineName || '-');
            summaryEntry.bobbins += bobbins;
            summaryEntry.bobbinWeight += bobbinWeight;
            summaryEntry.yarnKg += yarnKg;
        });

        Array.from(summaryGroupedMap.values())
            .sort((a, b) => (
                String(a.itemName || '').localeCompare(String(b.itemName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.cutName || '').localeCompare(String(b.cutName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.twistName || '').localeCompare(String(b.twistName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.yarnName || '').localeCompare(String(b.yarnName || ''), undefined, { numeric: true, sensitivity: 'base' })
            ))
            .forEach((entry) => {
                summaryRows.push({
                    cells: [
                        { text: entry.yarnName, align: 'left' },
                        { text: entry.itemName, align: 'left' },
                        { text: entry.cutName, align: 'left' },
                        { text: entry.twistName, align: 'left' },
                        { text: Array.from(entry.machineNames).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })).join(', '), align: 'left' },
                        { text: formatNumber(entry.bobbins), align: 'right' },
                        { text: formatWeight(entry.bobbinWeight), align: 'right' },
                        { text: formatWeight(entry.yarnKg), align: 'right' },
                    ],
                });
            });
    }

    const headers = [
        { text: 'S.No', align: 'center' },
        { text: 'Machine', align: 'left' },
        { text: 'Lot No', align: 'left' },
        { text: 'Yarn', align: 'left' },
        { text: 'Item', align: 'left' },
        { text: 'Cut', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Operator', align: 'left' },
        { text: 'Shift', align: 'center' },
        { text: 'M. Bobbins', align: 'right' },
        { text: 'Bob Wt (kg)', align: 'right' },
        { text: 'Yarn (kg)', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [10, 25, 25, 25, 30, 20, 20, 30, 15, 22, 25, 22];

    const rows = [];
    let totalBobbins = 0;
    let totalBobbinWeight = 0;
    let totalYarnKg = 0;

    details.forEach((item, idx) => {
        const bobbins = Number(item.metallicBobbins || 0);
        const bobbinWeight = Number(item.metallicBobbinsWeight || 0);
        const yarnKg = Number(item.yarnKg || 0);
        totalBobbins += bobbins;
        totalBobbinWeight += bobbinWeight;
        totalYarnKg += yarnKg;

        rows.push({
            cells: [
                { text: idx + 1, align: 'center' },
                { text: item.machineName || '-', align: 'left' },
                { text: item.lotNo || '-', align: 'left' },
                { text: item.yarnName || '-', align: 'left' },
                { text: item.itemName || '-', align: 'left' },
                { text: item.cutName || '-', align: 'left' },
                { text: item.twistName || '-', align: 'left' },
                { text: item.operatorName || '-', align: 'left' },
                { text: item.shift || '-', align: 'center' },
                { text: formatNumber(bobbins), align: 'right' },
                { text: formatWeight(bobbinWeight), align: 'right' },
                { text: formatWeight(yarnKg), align: 'right' },
            ],
        });
    });

    if (rows.length > 0) {
        // Totals row - aligned with numeric headers (S.No, Machine, Lot No, Yarn, Item, Cut, Twist, Operator, Shift are blank)
        rows.push({
            isTotal: true,
            cells: [
                { text: '', align: 'center' }, // S.No
                { text: 'TOTAL', align: 'left' }, // Machine
                { text: '', align: 'left' }, // Lot No
                { text: '', align: 'left' }, // Yarn
                { text: '', align: 'left' }, // Item
                { text: '', align: 'left' }, // Cut
                { text: '', align: 'left' }, // Twist
                { text: '', align: 'left' }, // Operator
                { text: '', align: 'center' }, // Shift
                { text: formatNumber(totalBobbins), align: 'right' },
                { text: formatWeight(totalBobbinWeight), align: 'right' },
                { text: formatWeight(totalYarnKg), align: 'right' },
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
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Issue Details',
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
