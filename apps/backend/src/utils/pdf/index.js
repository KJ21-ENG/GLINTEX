/**
 * PDF Summary Generators - Central Export
 * Dispatches to the correct PDF generator based on stage and type
 */

import { generateCutterIssuePdf } from './cutterIssuePdf.js';
import { generateCutterReceivePdf } from './cutterReceivePdf.js';
import { generateHoloIssuePdf } from './holoIssuePdf.js';
import { generateHoloReceivePdf } from './holoReceivePdf.js';
import { generateConingIssuePdf } from './coningIssuePdf.js';
import { generateConingReceivePdf } from './coningReceivePdf.js';
import { generateProductionDailyExportPdf } from './productionDailyExportPdf.js';
import { generateHoloWeeklyExportPdf } from './holoWeeklyExportPdf.js';

/**
 * Generate summary PDF based on stage and type
 * @param {string} stage - 'cutter' | 'holo' | 'coning'
 * @param {string} type - 'issue' | 'receive'
 * @param {object} data - Summary data with details array
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateSummaryPDF(stage, type, data) {
    const key = `${stage}_${type}`;
    switch (key) {
        case 'cutter_issue':
            return await generateCutterIssuePdf(data);
        case 'cutter_receive':
            return await generateCutterReceivePdf(data);
        case 'holo_issue':
            return await generateHoloIssuePdf(data);
        case 'holo_receive':
            return await generateHoloReceivePdf(data);
        case 'coning_issue':
            return await generateConingIssuePdf(data);
        case 'coning_receive':
            return await generateConingReceivePdf(data);
        default:
            throw new Error(`Unknown stage/type combination: ${stage}/${type}`);
    }
}

// Re-export individual generators for direct use if needed
export {
    generateCutterIssuePdf,
    generateCutterReceivePdf,
    generateHoloIssuePdf,
    generateHoloReceivePdf,
    generateConingIssuePdf,
    generateConingReceivePdf,
    generateProductionDailyExportPdf,
    generateHoloWeeklyExportPdf,
};
