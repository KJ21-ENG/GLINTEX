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
        { text: 'Yarn', align: 'left' },
        { text: 'Twist', align: 'left' },
        { text: 'Cone Type', align: 'left' },
        { text: 'Per Cone (g)', align: 'right' },
        { text: 'Operator', align: 'left' },
        { text: 'Shift', align: 'center' },
        { text: 'Note', align: 'left' },
        { text: 'Rolls Issued', align: 'right' },
        { text: 'Expected Cones', align: 'right' },
    ];

    // Column widths for landscape A4
    const colWidths = [10, 28, 30, 24, 22, 20, 24, 18, 28, 16, 32, 22, 22];
    const itemNameMaxLen = (data.details || []).reduce((max, item) => {
        const name = String(item?.itemName || '');
        return Math.max(max, name.length);
    }, 0);
    const desiredItemWidth = Math.min(40, Math.max(20, Math.round(itemNameMaxLen * 1.2)));

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
                    { text: item.yarnName || '-', align: 'left' },
                    { text: item.twistName || '-', align: 'left' },
                    { text: item.coneTypeName || '-', align: 'left' },
                    { text: formatNumber(item.perConeTargetG || 0), align: 'right' },
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
                { text: '', align: 'left' },
                { text: '', align: 'left' },
                { text: '', align: 'right' },
                { text: '', align: 'left' },
                { text: '', align: 'center' },
                { text: '', align: 'left' },
                { text: formatNumber(totalRolls), align: 'right' },
                { text: formatNumber(Math.round(totalCones)), align: 'right' },
            ],
        });
    }

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
                    totalRollsIssued: 0,
                    totalExpectedCones: 0,
                    targetSum: 0,
                    targetCount: 0,
                });
            }
            const entry = summaryMap.get(key);
            const rolls = Number(item.rollsIssued || 0);
            const cones = Number(item.expectedCones || 0);
            const target = Number(item.perConeTargetG || 0);
            entry.totalRollsIssued += rolls;
            entry.totalExpectedCones += cones;
            if (Number.isFinite(target) && target > 0) {
                entry.targetSum += target;
                entry.targetCount += 1;
            }
        });

        const summaryHeaders = [
            { text: 'Machine', align: 'left' },
            { text: 'Yarn', align: 'left' },
            { text: 'Twist', align: 'left' },
            { text: 'Item', align: 'left', wrap: true },
            { text: 'Cut', align: 'left' },
            { text: 'Cone Type', align: 'left' },
            { text: 'Rolls Issued', align: 'right', wrap: true },
            { text: 'Expected Cones', align: 'right', wrap: true },
            { text: 'Target Wt Avg (g)', align: 'right', wrap: true },
        ];

        const baseSummaryColWidths = [26, 20, 20, 30, 22, 26, 28, 30, 28];
        const totalSummaryWidth = baseSummaryColWidths.reduce((sum, w) => sum + w, 0);
        const summaryItemIndex = 3;
        const summaryMachineIndex = 0;
        const minSummaryMachine = 16;
        let summaryColWidths = [...baseSummaryColWidths];
        const summaryDelta = desiredItemWidth - baseSummaryColWidths[summaryItemIndex];
        if (summaryDelta !== 0) {
            const nextMachine = baseSummaryColWidths[summaryMachineIndex] - summaryDelta;
            if (nextMachine >= minSummaryMachine) {
                summaryColWidths[summaryItemIndex] = desiredItemWidth;
                summaryColWidths[summaryMachineIndex] = nextMachine;
            } else {
                const maxItem = baseSummaryColWidths[summaryMachineIndex] - minSummaryMachine + baseSummaryColWidths[summaryItemIndex];
                const clampedItem = Math.min(desiredItemWidth, maxItem);
                summaryColWidths[summaryItemIndex] = clampedItem;
                summaryColWidths[summaryMachineIndex] = totalSummaryWidth - summaryColWidths.reduce((sum, w, i) => sum + (i === summaryMachineIndex ? 0 : w), 0);
            }
        }

        const summaryRows = [];
        Array.from(summaryMap.values())
            .sort((a, b) => (
                String(a.machineName || '').localeCompare(String(b.machineName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.yarnName || '').localeCompare(String(b.yarnName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.twistName || '').localeCompare(String(b.twistName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.itemName || '').localeCompare(String(b.itemName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.cutName || '').localeCompare(String(b.cutName || ''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.coneTypeName || '').localeCompare(String(b.coneTypeName || ''), undefined, { numeric: true, sensitivity: 'base' })
            ))
            .forEach((entry) => {
                const targetAvg = entry.targetCount > 0 ? entry.targetSum / entry.targetCount : 0;
                summaryRows.push({
                    cells: [
                        { text: entry.machineName, align: 'left' },
                        { text: entry.yarnName, align: 'left' },
                        { text: entry.twistName, align: 'left' },
                        { text: entry.itemName, align: 'left' },
                        { text: entry.cutName, align: 'left' },
                        { text: entry.coneTypeName, align: 'left' },
                        { text: formatNumber(entry.totalRollsIssued), align: 'right' },
                        { text: formatNumber(Math.round(entry.totalExpectedCones)), align: 'right' },
                        { text: formatNumber(Math.round(targetAvg || 0)), align: 'right' },
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
            rowHeight: 6,
            headerHeight: 7,
            padding: 1.5,
            bottomMargin: 15,
            lineHeight: 3,
        });
    }

    const estimateTableHeight = (tableHeaders, tableRows, tableColWidths, opts) => {
        const baseRowHeight = opts.rowHeight ?? 7;
        const headerHeight = opts.headerHeight ?? 8;
        const padding = opts.padding ?? 2;
        const lineHeight = opts.lineHeight ?? 3.5;
        let total = headerHeight;
        tableRows.forEach((row) => {
            const maxLines = row.cells.reduce((max, cell, i) => {
                const header = tableHeaders[i] || {};
                if (!header.wrap) return Math.max(max, 1);
                const text = String(cell?.text ?? cell ?? '');
                const maxWidth = tableColWidths[i] - (padding * 2);
                const lines = doc.splitTextToSize(text, maxWidth);
                return Math.max(max, lines.length || 1);
            }, 1);
            total += baseRowHeight * maxLines;
        });
        return total;
    };

    const detailsTableOpts = {
        rowHeight: 6,
        headerHeight: 7,
        padding: 1.5,
        bottomMargin: 15,
        lineHeight: 3,
    };
    const detailsHeight = estimateTableHeight(headers, rows, colWidths, detailsTableOpts);
    if (y + detailsHeight > pageHeight - detailsTableOpts.bottomMargin) {
        doc.addPage();
        y = 20;
    }

    y = drawTable(doc, {
        y,
        headers,
        rows,
        colWidths,
        pageWidth,
        title: 'Issue Details',
        ...detailsTableOpts,
    });

    // Footer
    drawFooter(doc, pageHeight);

    return Buffer.from(doc.output('arraybuffer'));
}
