// Printable artifact, version 2: self-contained HTML pages in millimetres plus the fonts
// they need. The Electron queue validates and prints it; the designer previews it.
import { normalizeTemplate, usedRollWidthMm, usedSheetHeightMm, labelsPerPage, fontFamilyCss, LIMITS } from './model.js';
import { layoutLabel, createEstimateMeasurer } from './layout.js';
import { renderLabelMarkup, renderPage, pageGeometry, assemblePrintDocument, BASE_CSS } from './html.js';

export const ARTIFACT_VERSION = 2;
export const SUPPORTED_DPI = [203, 300, 600];
export const MAX_PAGES = 100;
// The desktop validator refuses pages over 2 MB and jobs over 20 MB; fail earlier with a clear message.
const PAGE_HTML_MAX = 2 * 1024 * 1024;
const JOB_HTML_MAX = 18 * 1024 * 1024;

export const normalizeCopies = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > LIMITS.copiesMax) throw new Error(`At most ${LIMITS.copiesMax} copies per job; print the rest as another job`);
  return n;
};

export const validateMedia = (media) => {
  if (media.kind === 'sheet') {
    if (usedRollWidthMm(media) > media.pageWidthMm + 0.001) throw new Error('Columns, gaps and left margin exceed the sheet width');
    if (usedSheetHeightMm(media) > media.pageHeightMm + 0.001) throw new Error('Rows, gaps and top margin exceed the sheet height');
  } else if (usedRollWidthMm(media) > media.rollWidthMm + 0.001) throw new Error('Columns, gaps and left margin exceed the roll width');
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
  // A printer's calibration nudge moves every label on that printer; the design's own
  // offsets stay in the template. Both end up in the page geometry.
  const nudgeX = Number(options.offsetXMm) || 0;
  const nudgeY = Number(options.offsetYMm) || 0;
  const media = { ...template.media, offsetXMm: template.media.offsetXMm + nudgeX, offsetYMm: template.media.offsetYMm + nudgeY };
  const rows = [];
  // Each entry of `rows` is one printed page. On a sheet, copies repeat each record in place
  // (one sticker per container), and a null record leaves its slot blank so a part-used
  // sheet can be finished first.
  const sheet = media.kind === 'sheet';
  const perPage = labelsPerPage(media);
  const records = sheet ? dataArray.flatMap((data) => Array.from({ length: data == null ? 1 : copies }, () => data)) : dataArray;
  const pageCopies = sheet ? 1 : copies;
  if (media.columnMode === 'sequence') {
    for (let i = 0; i < records.length; i += perPage) rows.push(records.slice(i, i + perPage));
  } else {
    for (const data of records) rows.push(Array.from({ length: media.columns }, () => data));
  }
  if (sheet && !records.some((data) => data != null)) throw new Error('Nothing to print');
  if (rows.length * pageCopies > MAX_PAGES) throw new Error(`Split label jobs into batches of at most ${MAX_PAGES} pages`);
  const geometry = pageGeometry(media);
  const pages = [];
  const warnings = [];
  let projectedBytes = 0;
  for (const row of rows) {
    const inners = row.map((data) => {
      if (data == null) return null;
      const layout = layoutLabel(template, data, measurer, { dpi });
      for (const el of layout.elements) {
        if (el.layout?.error) warnings.push(`${el.id}: ${el.layout.error}`);
        if (el.layout?.overflowing) warnings.push(el.type === 'barcode' ? `${el.id}: barcode is wider than its limit even at two dots per module` : `${el.id}: text does not fit its box`);
      }
      return renderLabelMarkup(layout, fontFamilyCss);
    });
    while (inners.length < perPage) inners.push(null);
    const html = renderPage(media, inners);
    if (html.length > PAGE_HTML_MAX) throw new Error('A label page is larger than 2 MB; use a smaller image');
    projectedBytes += html.length * pageCopies;
    if (projectedBytes > JOB_HTML_MAX) throw new Error('Label job is larger than 18 MB; split the batch or use a smaller image');
    for (let copy = 0; copy < pageCopies; copy += 1) pages.push({ html });
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
    profileSnapshot: { dpi, mediaKind: media.kind, rowGapMm: media.rowGapMm, columns: media.columns, rows: media.rows, copies, columnMode: media.columnMode, offsetXMm: nudgeX, offsetYMm: nudgeY },
  };
};

export const artifactToDocument = (artifact) => assemblePrintDocument({ widthMm: artifact.widthMm, heightMm: artifact.heightMm, fonts: artifact.fonts, pages: artifact.pages });

// Markup for a preview surface (shadow DOM) of one page or of one label.
export const artifactPageMarkup = (artifact, index = 0) => `<style>${artifact.css}</style>${artifact.pages[index]?.html || ''}`;
