// HTML renderer. Every element becomes absolutely positioned markup in millimetres.
// The designer preview and the printed page are built from the same strings.
import { canvasSize } from './model.js';

export const mm = (value) => `${Math.round(Number(value) * 1000) / 1000}mm`;
export const pt = (value) => `${Math.round(Number(value) * 100) / 100}pt`;
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const BASE_CSS = [
  // contain:size keeps Chromium's multi-page print layout from measuring the document width
  // from the unrotated positions of the text lines inside a landscape canvas; without it any
  // text beyond the page width makes a job with two or more pages print scaled down.
  '.pg{position:relative;overflow:hidden;contain:size;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
  '.lbw{position:absolute;overflow:hidden}',
  '.lb{position:absolute;left:0;top:0;transform-origin:0 0;overflow:visible}',
  '.el{position:absolute;transform-origin:0 0;overflow:visible;box-sizing:border-box}',
  '.el.clip{overflow:hidden}',
  '.ln{position:absolute;white-space:pre;font-kerning:normal;text-rendering:geometricPrecision;color:#000}',
  '.ln.inv{color:#fff}',
  '.bg{position:absolute;left:0;top:0;width:100%;height:100%;background:#000}',
  'svg.sym{position:absolute;display:block;left:0;top:0}',
  'img.im{position:absolute;display:block;left:0;top:0;width:100%;height:100%}',
].join('\n');

export const fontFaceCss = (fonts = []) => fonts.map((f) => (
  `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style || 'normal'};src:url(${f.dataUrl}) format("woff2")}`
)).join('\n');

export const rotationTransform = (rotation, w, h) => {
  if (rotation === 90) return `rotate(90deg) translate(0,-${mm(h)})`;
  if (rotation === 180) return `rotate(180deg) translate(-${mm(w)},-${mm(h)})`;
  if (rotation === 270) return `rotate(270deg) translate(-${mm(w)},0)`;
  return '';
};

const elementStyle = (box, rotation, extra = '') => {
  const transform = rotationTransform(rotation, box.w, box.h);
  return `left:${mm(box.x)};top:${mm(box.y)};width:${mm(box.w)};height:${mm(box.h)};${transform ? `transform:${transform};` : ''}${extra}`;
};

const lineHtml = (line, font, cls = 'ln') => (
  `<div class="${cls}" style="left:${mm(line.x)};top:${mm(line.y)};height:${mm(font.lineHeightMm)};line-height:${mm(font.lineHeightMm)};font-size:${pt(font.sizePt)};font-family:${font.family};font-weight:${font.bold ? 700 : 400};font-style:${font.italic ? 'italic' : 'normal'}${font.letterSpacingPt ? `;letter-spacing:${pt(font.letterSpacingPt)}` : ''}${font.underline ? ';text-decoration:underline' : ''}">${esc(line.text)}</div>`
);

export const renderTextElement = (el, fontFamilyCss) => {
  const { layout, box } = el;
  const font = { lineHeightMm: layout.lineHeightMm, sizePt: layout.fontSizePt, family: fontFamilyCss(el.fontFamily), bold: el.bold, italic: el.italic, letterSpacingPt: el.letterSpacingPt, underline: el.underline };
  const parts = [];
  if (el.invert) parts.push('<div class="bg"></div>');
  for (const line of layout.lines) parts.push(lineHtml(line, font, el.invert ? 'ln inv' : 'ln'));
  return `<div class="el${layout.clip ? ' clip' : ''}" data-id="${esc(el.id)}" style="${elementStyle(box, el.rotation)}">${parts.join('')}</div>`;
};

export const renderBarcodeElement = (el, fontFamilyCss) => {
  const { layout, box } = el;
  const rects = layout.bars.map((bar) => `<rect x="${round3(bar.x)}" y="0" width="${round3(bar.w)}" height="${round3(layout.barHeightMm)}"/>`).join('');
  const svg = `<svg class="sym" style="width:${mm(box.w)};height:${mm(box.h)}" viewBox="0 0 ${round3(box.w)} ${round3(box.h)}" shape-rendering="crispEdges" fill="#000" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  const text = layout.textLine
    ? lineHtml(layout.textLine, { lineHeightMm: layout.textLine.lineHeightMm, sizePt: layout.textLine.fontSizePt, family: fontFamilyCss('inter'), bold: false, italic: false, letterSpacingPt: 0, underline: false })
    : '';
  return `<div class="el" data-id="${esc(el.id)}" style="${elementStyle(box, el.rotation)}">${svg}${text}</div>`;
};

export const renderQrElement = (el) => {
  const { layout, box } = el;
  const m = layout.moduleMm;
  const rects = [];
  layout.rows.forEach((runs, y) => {
    for (const run of runs) rects.push(`<rect x="${round3(run.x * m)}" y="${round3(y * m)}" width="${round3(run.w * m)}" height="${round3(m)}"/>`);
  });
  const svg = `<svg class="sym" style="width:${mm(box.w)};height:${mm(box.h)}" viewBox="0 0 ${round3(box.w)} ${round3(box.h)}" shape-rendering="crispEdges" fill="#000" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`;
  return `<div class="el" data-id="${esc(el.id)}" style="${elementStyle(box, el.rotation)}">${svg}</div>`;
};

export const renderLineElement = (el) => `<div class="el" data-id="${esc(el.id)}" style="${elementStyle(el.box, el.rotation, 'background:#000;')}"></div>`;

export const renderRectElement = (el) => {
  const extra = `border:${mm(el.strokeMm)} solid #000;border-radius:${mm(el.radiusMm)};background:${el.fill ? '#000' : 'transparent'};`;
  return `<div class="el" data-id="${esc(el.id)}" style="${elementStyle(el.box, el.rotation, extra)}"></div>`;
};

export const renderImageElement = (el) => {
  if (!el.src) return `<div class="el" data-id="${esc(el.id)}" style="${elementStyle(el.box, el.rotation, 'border:0.2mm dashed #999;')}"></div>`;
  return `<div class="el" data-id="${esc(el.id)}" style="${elementStyle(el.box, el.rotation)}"><img class="im" alt="" src="${el.src}" style="object-fit:${el.fit === 'stretch' ? 'fill' : 'contain'}"></div>`;
};

const round3 = (v) => Math.round(Number(v) * 1000) / 1000;

// Inner markup of one label in reading orientation.
export const renderLabelMarkup = (layoutResult, fontFamilyCss) => layoutResult.elements.map((el) => {
  if (el.type === 'text') return renderTextElement(el, fontFamilyCss);
  if (el.type === 'barcode') return renderBarcodeElement(el, fontFamilyCss);
  if (el.type === 'qr') return renderQrElement(el);
  if (el.type === 'line') return renderLineElement(el);
  if (el.type === 'rect') return renderRectElement(el);
  if (el.type === 'image') return renderImageElement(el);
  return '';
}).join('');

// The label wrapper rotates a landscape design onto the portrait page.
export const labelTransform = (media) => (media.orientation === 'landscape' ? `rotate(-90deg) translate(-${mm(media.heightMm)},0)` : '');

export const renderLabelWrapper = (media, inner, position) => {
  const canvas = canvasSize(media);
  const transform = labelTransform(media);
  return `<div class="lbw" style="left:${mm(position.x)};top:${mm(position.y)};width:${mm(media.widthMm)};height:${mm(media.heightMm)}"><div class="lb" style="width:${mm(canvas.widthMm)};height:${mm(canvas.heightMm)}${transform ? `;transform:${transform}` : ''}">${inner}</div></div>`;
};

export const pageGeometry = (media) => ({
  widthMm: media.rollWidthMm,
  heightMm: media.heightMm + media.marginTopMm,
  columnPosition: (column) => ({
    x: media.marginLeftMm + media.offsetXMm + column * (media.widthMm + media.columnGapMm),
    y: media.marginTopMm + media.offsetYMm,
  }),
});

export const renderPage = (media, labelInners) => {
  const geometry = pageGeometry(media);
  const columns = labelInners.map((inner, column) => (inner == null ? '' : renderLabelWrapper(media, inner, geometry.columnPosition(column)))).join('');
  return `<div class="pg" style="width:${mm(geometry.widthMm)};height:${mm(geometry.heightMm)}">${columns}</div>`;
};

export const PRINT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

export const assemblePrintDocument = ({ widthMm, heightMm, fonts = [], pages = [] }) => (
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}"><title>GLINTEX label</title><style>@page{size:${mm(widthMm)} ${mm(heightMm)};margin:0}html,body{margin:0;padding:0;background:#fff}.pg{break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}\n${fontFaceCss(fonts)}\n${BASE_CSS}</style></head><body>${pages.map((p) => p.html).join('')}</body></html>`
);
