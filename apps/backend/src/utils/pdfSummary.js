/**
 * PDF Summary Generation Utility
 * Generates summary PDFs for issue/receive operations using jsPDF
 */

// We'll use a simple text-based PDF approach that works server-side
// Using dynamic import for jsPDF to handle ES module

let jsPDFModule = null;

async function getJsPDF() {
    if (!jsPDFModule) {
        // Dynamic import for ES module compatibility
        const { default: jsPDF } = await import('jspdf');
        jsPDFModule = jsPDF;
    }
    return jsPDFModule;
}

function formatDateDDMMYYYY(dateStr) {
    if (!dateStr) return '';
    // Parse YYYY-MM-DD directly without creating Date object to avoid timezone issues
    const str = String(dateStr).trim();
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [, yyyy, mm, dd] = match;
        return `${dd}/${mm}/${yyyy}`;
    }
    // Fallback for other formats
    return str;
}

function formatWeight(val) {
    const num = Number(val);
    return Number.isFinite(num) ? num.toFixed(3) : '0.000';
}

function formatNumber(val) {
    const num = Number(val);
    return Number.isFinite(num) ? num.toLocaleString('en-IN') : '0';
}

/**
 * Generate Cutter Issue Summary PDF
 */
export async function generateCutterIssueSummaryPDF(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('GLINTEX - Cutter Issue Summary', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formatDateDDMMYYYY(data.date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Overview section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('OVERVIEW', 15, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Issues: ${formatNumber(data.totalCount)}`, 15, y);
    y += 5;
    doc.text(`Total Pieces: ${formatNumber(data.totalPieces)}`, 15, y);
    y += 5;
    doc.text(`Total Weight: ${formatWeight(data.totalWeight)} kg`, 15, y);
    y += 10;

    // By Operator
    if (data.byOperator && data.byOperator.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY OPERATOR', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const op of data.byOperator) {
            doc.text(`${op.name || 'Unknown'}`, 15, y);
            doc.text(`${op.count} issues`, 80, y);
            doc.text(`${formatWeight(op.weight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Machine
    if (data.byMachine && data.byMachine.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY MACHINE', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const m of data.byMachine) {
            doc.text(`${m.name || 'Unknown'}`, 15, y);
            doc.text(`${m.count} issues`, 80, y);
            doc.text(`${formatWeight(m.weight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Lot
    if (data.byLot && data.byLot.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY LOT', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const lot of data.byLot.slice(0, 20)) { // Limit to 20
            doc.text(`${lot.lotNo || 'Unknown'}`, 15, y);
            doc.text(`${lot.count} issues`, 80, y);
            doc.text(`${formatWeight(lot.weight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        if (data.byLot.length > 20) {
            doc.text(`... and ${data.byLot.length - 20} more lots`, 15, y);
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, 285);

    return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Cutter Receive Summary PDF
 */
export async function generateCutterReceiveSummaryPDF(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('GLINTEX - Cutter Receive Summary', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formatDateDDMMYYYY(data.date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Overview section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('OVERVIEW', 15, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Receives: ${formatNumber(data.totalCount)}`, 15, y);
    y += 5;
    doc.text(`Total Bobbins: ${formatNumber(data.totalBobbins)}`, 15, y);
    y += 5;
    doc.text(`Total Net Weight: ${formatWeight(data.totalNetWeight)} kg`, 15, y);
    y += 5;
    doc.text(`Total Challans: ${formatNumber(data.totalChallans)}`, 15, y);
    y += 10;

    // By Operator
    if (data.byOperator && data.byOperator.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY OPERATOR', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const op of data.byOperator) {
            doc.text(`${op.name || 'Unknown'}`, 15, y);
            doc.text(`${op.count} rows`, 80, y);
            doc.text(`${formatWeight(op.netWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Piece
    if (data.byPiece && data.byPiece.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY PIECE', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const p of data.byPiece.slice(0, 20)) {
            doc.text(`${p.pieceId || 'Unknown'}`, 15, y);
            doc.text(`${p.count} rows`, 80, y);
            doc.text(`${formatWeight(p.netWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        if (data.byPiece.length > 20) {
            doc.text(`... and ${data.byPiece.length - 20} more pieces`, 15, y);
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, 285);

    return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Holo Issue Summary PDF
 */
export async function generateHoloIssueSummaryPDF(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('GLINTEX - Holo Issue Summary', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formatDateDDMMYYYY(data.date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Overview section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('OVERVIEW', 15, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Issues: ${formatNumber(data.totalCount)}`, 15, y);
    y += 5;
    doc.text(`Total Metallic Bobbins: ${formatNumber(data.totalMetallicBobbins)}`, 15, y);
    y += 5;
    doc.text(`Total Bobbin Weight: ${formatWeight(data.totalBobbinWeight)} kg`, 15, y);
    y += 5;
    doc.text(`Total Yarn: ${formatWeight(data.totalYarnKg)} kg`, 15, y);
    y += 10;

    // By Operator
    if (data.byOperator && data.byOperator.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY OPERATOR', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const op of data.byOperator) {
            doc.text(`${op.name || 'Unknown'}`, 15, y);
            doc.text(`${op.count} issues`, 80, y);
            doc.text(`${formatWeight(op.bobbinWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Machine
    if (data.byMachine && data.byMachine.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY MACHINE', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const m of data.byMachine) {
            doc.text(`${m.name || 'Unknown'}`, 15, y);
            doc.text(`${m.count} issues`, 80, y);
            doc.text(`${formatWeight(m.bobbinWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, 285);

    return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Holo Receive Summary PDF
 */
export async function generateHoloReceiveSummaryPDF(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('GLINTEX - Holo Receive Summary', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formatDateDDMMYYYY(data.date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Overview section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('OVERVIEW', 15, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Receives: ${formatNumber(data.totalCount)}`, 15, y);
    y += 5;
    doc.text(`Total Rolls: ${formatNumber(data.totalRolls)}`, 15, y);
    y += 5;
    doc.text(`Total Net Weight: ${formatWeight(data.totalNetWeight)} kg`, 15, y);
    y += 10;

    // By Operator
    if (data.byOperator && data.byOperator.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY OPERATOR', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const op of data.byOperator) {
            doc.text(`${op.name || 'Unknown'}`, 15, y);
            doc.text(`${op.count} rows`, 80, y);
            doc.text(`${formatWeight(op.netWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Machine
    if (data.byMachine && data.byMachine.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY MACHINE', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const m of data.byMachine) {
            doc.text(`${m.name || 'Unknown'}`, 15, y);
            doc.text(`${m.count} rows`, 80, y);
            doc.text(`${formatWeight(m.netWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, 285);

    return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Coning Issue Summary PDF
 */
export async function generateConingIssueSummaryPDF(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('GLINTEX - Coning Issue Summary', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formatDateDDMMYYYY(data.date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Overview section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('OVERVIEW', 15, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Issues: ${formatNumber(data.totalCount)}`, 15, y);
    y += 5;
    doc.text(`Total Rolls Issued: ${formatNumber(data.totalRollsIssued)}`, 15, y);
    y += 5;
    doc.text(`Expected Cones: ${formatNumber(data.totalExpectedCones)}`, 15, y);
    y += 10;

    // By Operator
    if (data.byOperator && data.byOperator.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY OPERATOR', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const op of data.byOperator) {
            doc.text(`${op.name || 'Unknown'}`, 15, y);
            doc.text(`${op.count} issues`, 80, y);
            doc.text(`${op.rollsIssued} rolls`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Machine
    if (data.byMachine && data.byMachine.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY MACHINE', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const m of data.byMachine) {
            doc.text(`${m.name || 'Unknown'}`, 15, y);
            doc.text(`${m.count} issues`, 80, y);
            doc.text(`${m.rollsIssued} rolls`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, 285);

    return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Coning Receive Summary PDF
 */
export async function generateConingReceiveSummaryPDF(data) {
    const jsPDF = await getJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('GLINTEX - Coning Receive Summary', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formatDateDDMMYYYY(data.date)}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Overview section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('OVERVIEW', 15, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Receives: ${formatNumber(data.totalCount)}`, 15, y);
    y += 5;
    doc.text(`Total Cones: ${formatNumber(data.totalCones)}`, 15, y);
    y += 5;
    doc.text(`Total Net Weight: ${formatWeight(data.totalNetWeight)} kg`, 15, y);
    y += 10;

    // By Operator
    if (data.byOperator && data.byOperator.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY OPERATOR', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const op of data.byOperator) {
            doc.text(`${op.name || 'Unknown'}`, 15, y);
            doc.text(`${op.count} rows`, 80, y);
            doc.text(`${formatWeight(op.netWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
        y += 5;
    }

    // By Machine
    if (data.byMachine && data.byMachine.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('BY MACHINE', 15, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const m of data.byMachine) {
            doc.text(`${m.name || 'Unknown'}`, 15, y);
            doc.text(`${m.count} rows`, 80, y);
            doc.text(`${formatWeight(m.netWeight)} kg`, 120, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 15; }
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 15, 285);

    return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Main generator function that dispatches to correct PDF generator
 */
export async function generateSummaryPDF(stage, type, data) {
    const key = `${stage}_${type}`;
    switch (key) {
        case 'cutter_issue':
            return await generateCutterIssueSummaryPDF(data);
        case 'cutter_receive':
            return await generateCutterReceiveSummaryPDF(data);
        case 'holo_issue':
            return await generateHoloIssueSummaryPDF(data);
        case 'holo_receive':
            return await generateHoloReceiveSummaryPDF(data);
        case 'coning_issue':
            return await generateConingIssueSummaryPDF(data);
        case 'coning_receive':
            return await generateConingReceiveSummaryPDF(data);
        default:
            throw new Error(`Unknown stage/type combination: ${stage}/${type}`);
    }
}
