// Printable artifact, version 2: self-contained HTML pages in millimetres plus the fonts
// they need. The Electron queue validates and prints it; the designer previews it.
import { normalizeTemplate, usedRollWidthMm, fontFamilyCss, LIMITS } from './model.js';
import { layoutLabel, createEstimateMeasurer } from './layout.js';
import { renderLabelMarkup, renderPage, pageGeometry, assemblePrintDocument, BASE_CSS } from './html.js';

export const ARTIFACT_VERSION = 2;
export const SUPPORTED_DPI = [203, 300, 600];
export const MAX_PAGES = 100;

export const normalizeCopies = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(LIMITS.copiesMax, n) : 1;
};

export const validateMedia = (media) => {
  if (usedRollWidthMm(media) > media.rollWidthMm + 0.001) throw new Error('Columns, gaps and left margin exceed the roll width');
  if (media.widthMm < LIMITS.mediaMinMm || media.heightMm < LIMITS.mediaMinMm) throw new Error('Label size is too small');
  return media;
};

export const buildPrintableArtifact = (templateInput, dataArray = [{}], options = {}) => {
  const template = normalizeTemplate(templateInput);
  validateMedia(template.media);
  const dpi = options.dpi || 203;
  if (!SUPPORTED_DPI.includes(dpi)) throw new Error('Unsupported printer DPI');
  const measurer = options.measurer || createEstimateMeasurer();
  const copies = normalizeCopies(options.copies || template.copies || 1);
  if (!Array.isArray(dataArray) || dataArray.length === 0) throw new Error('Nothing to print');
  const { media } = template;
  const rows = [];
  if (media.columnMode === 'sequence') {
    for (let i = 0; i < dataArray.length; i += media.columns) rows.push(dataArray.slice(i, i + media.columns));
  } else {
    for (const data of dataArray) rows.push(Array.from({ length: media.columns }, () => data));
  }
  if (rows.length * copies > MAX_PAGES) throw new Error(`Split label jobs into batches of at most ${MAX_PAGES} pages`);
  const geometry = pageGeometry(media);
  const pages = [];
  const warnings = [];
  for (const row of rows) {
    const inners = row.map((data) => {
      const layout = layoutLabel(template, data, measurer, { dpi });
      for (const el of layout.elements) {
        if (el.layout?.error) warnings.push(`${el.id}: ${el.layout.error}`);
        if (el.layout?.overflowing) warnings.push(el.type === 'barcode' ? `${el.id}: barcode is wider than its limit even at two dots per module` : `${el.id}: text does not fit its box`);
      }
      return renderLabelMarkup(layout, fontFamilyCss);
    });
    while (inners.length < media.columns) inners.push(null);
    const html = renderPage(media, inners);
    for (let copy = 0; copy < copies; copy += 1) pages.push({ html });
  }
  return {
    version: ARTIFACT_VERSION,
    dpi,
    widthMm: geometry.widthMm,
    heightMm: geometry.heightMm,
    css: BASE_CSS,
    fonts: Array.isArray(options.fonts) ? options.fonts : [],
    pages,
    warnings: [...new Set(warnings)],
    templateSnapshot: { stageKey: options.stageKey || 'calibration', template },
    profileSnapshot: { dpi, rowGapMm: media.rowGapMm, columns: media.columns, copies, columnMode: media.columnMode },
  };
};

export const artifactToDocument = (artifact) => assemblePrintDocument({ widthMm: artifact.widthMm, heightMm: artifact.heightMm, fonts: artifact.fonts, pages: artifact.pages });

// Markup for a preview surface (shadow DOM) of one page or of one label.
export const artifactPageMarkup = (artifact, index = 0) => `<style>${artifact.css}</style>${artifact.pages[index]?.html || ''}`;
