// Public label API used by every stage flow and the Label Designer.
// Rendering lives in ./label/*: one HTML-in-millimetres renderer feeds both the preview
// and the printer. Silent printing goes through the GLINTEX desktop app; a browser
// falls back to the operating system print dialog on the very same document.
import { LABEL_STAGE_KEYS, STAGE_VARIABLES, STAGE_LABELS, STAGE_GROUPS, getStageVariables, getStageLabel } from './label/stages.js';
import { toV2Template } from './label/migrate.js';
import { DEFAULT_STAGE_TEMPLATES, getDefaultTemplate, CALIBRATION_TEMPLATE } from './label/defaults.js';
import { buildPrintableArtifact as buildArtifact, artifactToDocument, normalizeCopies, ARTIFACT_VERSION } from './label/artifact.js';
import { substitutePlaceholders } from './label/placeholders.js';
import { normalizeTemplate, cloneTemplate } from './label/model.js';

export { LABEL_STAGE_KEYS, STAGE_VARIABLES, STAGE_LABELS, STAGE_GROUPS, getStageVariables, getStageLabel };
export { DEFAULT_STAGE_TEMPLATES, getDefaultTemplate, CALIBRATION_TEMPLATE };
export { substitutePlaceholders, normalizeCopies, toV2Template, normalizeTemplate, cloneTemplate, artifactToDocument, ARTIFACT_VERSION };

// Same resolution as api/client.js: Vite only substitutes the exact `import.meta.env` token.
const viteEnv = import.meta.env || {};
const getApiOrigin = () => {
  if (typeof window !== 'undefined' && window.glintexDesktop) return window.location.origin;
  if (viteEnv.VITE_API_BASE) return String(viteEnv.VITE_API_BASE).replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location) return `${window.location.protocol}//${window.location.hostname}:4000`;
  return 'http://localhost:4000';
};
const API_BASE_DEFAULT = `${getApiOrigin()}/api`;

const safeReadJson = async (response) => {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const notifyUnauthorized = (response) => {
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
  }
};

export const hasDesktopPrinting = () => typeof window !== 'undefined' && !!window.glintexDesktop?.printers;

// Version 2 designs are stored under `v2:<stage>`. Desktop builds that still run the
// previous renderer keep reading and printing the untouched legacy `<stage>` rows.
export const V2_KEY_PREFIX = 'v2:';
export const templateStorageKey = (stageKey) => `${V2_KEY_PREFIX}${stageKey}`;

const fetchTemplateRow = async (apiBase, key) => {
  const response = await fetch(`${apiBase}/sticker_templates/${encodeURIComponent(key)}`, { credentials: 'include' });
  notifyUnauthorized(response);
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Label template could not be loaded (${response.status}). No label was printed.`);
    error.status = response.status;
    throw error;
  }
  const payload = await safeReadJson(response);
  return payload?.template || null;
};

// Resolves the design for a stage and says where it came from:
// 'saved' = version 2 row, 'legacy' = converted from the previous designer's row.
export const loadTemplateWithOrigin = async (stageKey, options = {}) => {
  const apiBase = options.apiBase || API_BASE_DEFAULT;
  if (!stageKey) throw new Error('Missing label stage');
  const current = await fetchTemplateRow(apiBase, templateStorageKey(stageKey));
  if (current) return { template: toV2Template(current), origin: 'saved' };
  const legacy = await fetchTemplateRow(apiBase, stageKey);
  if (legacy) return { template: toV2Template(legacy), origin: 'legacy' };
  const error = new Error('No saved label design for this stage. Open it in Settings > Label Designer, check it and press Save. No label was printed.');
  error.status = 404;
  throw error;
};

export const loadTemplate = async (stageKey, options = {}) => (await loadTemplateWithOrigin(stageKey, options)).template;

// Stored shape: { dimensions, content } for compatibility with the existing route and
// table; version 2 designs keep the whole template in `content` and a summary in `dimensions`.
export const saveTemplate = async (stageKey, template, options = {}) => {
  const apiBase = options.apiBase || API_BASE_DEFAULT;
  if (!stageKey) return { success: false, error: 'Missing stageKey' };
  try {
    const normalized = normalizeTemplate(template);
    const response = await fetch(`${apiBase}/sticker_templates/${encodeURIComponent(templateStorageKey(stageKey))}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        dimensions: { version: 2, ...normalized.media },
        content: normalized,
      }),
    });
    notifyUnauthorized(response);
    const result = await safeReadJson(response);
    if (!response.ok) return { success: false, error: result?.error || 'Failed to save template', result };
    return { success: true, template: result?.template ? toV2Template(result.template) : normalized, result };
  } catch (err) {
    console.error('Failed to save template', stageKey, err);
    return { success: false, error: err.message || 'Failed to save template' };
  }
};

// Browser-only support (canvas text measurement, bundled font files) is loaded lazily so
// this module also runs under Node for tests, which inject their own support here.
let support = null;
export const setLabelPrintSupport = (value) => { support = value; };
const getSupport = async () => {
  if (!support) {
    const [{ createCanvasMeasurer }, { loadEmbeddedFonts, ensureFontsReady }] = await Promise.all([import('./label/measure.js'), import('./label/fonts.js')]);
    const measurer = createCanvasMeasurer();
    support = { measurer, loadEmbeddedFonts, ensureFontsReady };
  }
  return support;
};

// Artifact for printing: fonts are embedded so the printing window needs nothing else.
export const buildPrintableArtifact = async (template, dataArray = [{}], options = {}) => {
  const normalized = normalizeTemplate(template);
  const { measurer, loadEmbeddedFonts, ensureFontsReady } = await getSupport();
  await ensureFontsReady(normalized);
  const fonts = options.embedFonts === false ? [] : await loadEmbeddedFonts();
  return buildArtifact(normalized, dataArray, { ...options, measurer: options.measurer || measurer, fonts });
};

const BROWSER_PRINT_TIMEOUT_MS = 120000;

// Browser fallback: the same document, through the operating system print dialog.
export const printArtifactInBrowser = (artifact) => new Promise((resolve) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    setTimeout(() => frame.remove(), 1000);
    resolve(result);
  };
  const timer = setTimeout(() => finish({ success: true, transport: 'browser-dialog', message: 'Print dialog opened; confirm the label on the printer.' }), BROWSER_PRINT_TIMEOUT_MS);
  frame.addEventListener('load', async () => {
    try {
      const win = frame.contentWindow;
      await win.document.fonts?.ready;
      await Promise.all(Array.from(win.document.images, (img) => img.decode().catch(() => null)));
      win.addEventListener('afterprint', () => finish({ success: true, transport: 'browser-dialog', message: 'Print dialog closed. Check the printer for the label.' }));
      win.focus();
      win.print();
    } catch (error) {
      finish({ success: false, error: error.message || 'Browser print failed' });
    }
  });
  frame.srcdoc = artifactToDocument(artifact);
  document.body.appendChild(frame);
});

export const printStageTemplatesBatch = async (stageKey, dataArray = [], options = {}) => {
  if (!stageKey || !Array.isArray(dataArray) || dataArray.length === 0) throw new Error('Missing stageKey or empty label batch');
  const template = options.template ? toV2Template(options.template) : await loadTemplate(stageKey, { apiBase: options.apiBase });
  if (!template) throw new Error('Label template not found');
  const copies = options.copies || template.copies || 1;
  if (hasDesktopPrinting()) {
    const status = await window.glintexDesktop.printers.status();
    if (!status.profile) throw new Error('Configure the Windows printer in Workstation setup first');
    const profile = options.printer ? { ...status.profile, printerName: options.printer } : status.profile;
    const artifact = await buildPrintableArtifact(template, dataArray, { stageKey, copies, dpi: profile.dpi });
    const result = await window.glintexDesktop.printers.submit({ artifact, profile });
    if (!result.success) throw new Error(`${result.error || 'Label submission failed'}${result.job?.id ? ` (job ${result.job.id})` : ''}`);
    return result;
  }
  const artifact = await buildPrintableArtifact(template, dataArray, { stageKey, copies, dpi: 203 });
  const result = await printArtifactInBrowser(artifact);
  if (!result.success) throw new Error(result.error || 'Label print failed');
  return result;
};

export const printStageTemplate = async (stageKey, data = {}, options = {}) => printStageTemplatesBatch(stageKey, [data], options);

const padSeq = (seq, length = 3) => {
  const num = Number(seq);
  if (!Number.isFinite(num)) return String(seq || '').padStart(length, '0');
  return String(num).padStart(length, '0');
};

// Material code deprecated but kept for backward compatibility
export const deriveMaterialCodeFromItem = () => 'MET';

// INBOUND: INB-{LOT}-{SEQ}
export const makeInboundBarcode = ({ lotNo, seq }) => `INB-${padSeq(lotNo)}-${padSeq(seq)}`;
// CUTTER ISSUE: ICU-{LOT}-{SEQ}
export const makeIssueBarcode = ({ lotNo, seq }) => `ICU-${padSeq(lotNo)}-${seq == null ? '000' : padSeq(seq)}`;
// CUTTER RECEIVE: RCU-{LOT}-{SEQ}-C{CRATE}
export const makeReceiveBarcode = ({ lotNo, seq, crateIndex = 1 }) => `RCU-${padSeq(lotNo)}-${padSeq(seq)}-C${padSeq(crateIndex)}`;
// HOLO ISSUE: IHO-{SERIES}
export const makeHoloIssueBarcode = ({ series }) => `IHO-${padSeq(series)}`;
// HOLO RECEIVE: RHO-{SERIES}-C{CRATE}
export const makeHoloReceiveBarcode = ({ series, crateIndex = 1 }) => `RHO-${padSeq(series)}-C${padSeq(crateIndex)}`;
// CONING ISSUE: ICO-{SERIES}
export const makeConingIssueBarcode = ({ series }) => `ICO-${padSeq(series)}`;
// CONING RECEIVE: RCO-{SERIES}-C{CRATE}
export const makeConingReceiveBarcode = ({ series, crateIndex = 1 }) => `RCO-${padSeq(series)}-C${padSeq(crateIndex)}`;

export const parseReceiveCrateIndex = (barcode) => {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/-C(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
};

export default {
  LABEL_STAGE_KEYS,
  STAGE_VARIABLES,
  DEFAULT_STAGE_TEMPLATES,
  substitutePlaceholders,
  getDefaultTemplate,
  loadTemplate,
  saveTemplate,
  printStageTemplate,
  printStageTemplatesBatch,
  makeReceiveBarcode,
  parseReceiveCrateIndex,
  deriveMaterialCodeFromItem,
  getStageVariables,
};
