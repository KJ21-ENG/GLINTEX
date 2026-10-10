// Pure layout engine. Takes a template, the transaction data and a text measurer, and
// returns every element resolved to exact millimetre geometry in the reading canvas.
// Text becomes explicit lines, so the HTML renderer never asks the browser to wrap.
import { normalizeTemplate, canvasSize, fontFamilyCss, elementBox } from './model.js';
import { substitutePlaceholders, PLACEHOLDER_PATTERN } from './placeholders.js';
import { encodeCode128, encodeQr, qrRuns } from './barcode.js';

export const PT_TO_MM = 25.4 / 72;
const EPS = 0.02;

export const dotPitchMm = (dpi) => 25.4 / (dpi || 203);
export const quantizeToDots = (mm, dpi) => {
  const dot = dotPitchMm(dpi);
  return Math.max(dot, Math.round(mm / dot) * dot);
};

const splitWords = (text) => text.split(/(\s+)/).filter((part) => part.length > 0);

const breakLongWord = (word, maxWidth, measure) => {
  const pieces = [];
  let current = '';
  for (const ch of word) {
    if (current && measure(current + ch) > maxWidth) {
      pieces.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) pieces.push(current);
  return pieces;
};

export const wrapParagraph = (text, maxWidth, measure) => {
  const lines = [];
  let line = '';
  for (const part of splitWords(text)) {
    if (/^\s+$/.test(part)) {
      if (line) line += ' ';
      continue;
    }
    const candidate = line ? `${line}${part}` : part;
    if (measure(candidate) <= maxWidth + EPS) {
      line = candidate;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    if (measure(part) > maxWidth + EPS) {
      const pieces = breakLongWord(part, maxWidth, measure);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] || '';
    } else {
      line = part;
    }
  }
  if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
  return lines;
};

const layoutText = (el, text, measurer) => {
  const innerW = Math.max(0.1, el.w - el.paddingMm * 2);
  const innerH = Math.max(0.1, el.h - el.paddingMm * 2);
  const shrinkAllowed = el.overflow === 'shrink' || el.overflow === 'wrap-shrink';
  const wrapAllowed = el.overflow !== 'shrink';
  const paragraphs = text.split(/\r?\n/);
  let sizePt = el.fontSizePt;
  let lines = [];
  let fits = false;
  let lineMm = 0;
  for (;;) {
    const font = { family: fontFamilyCss(el.fontFamily), sizePt, bold: el.bold, italic: el.italic, letterSpacingPt: el.letterSpacingPt };
    const measure = (s) => measurer.measure(s, font);
    lines = [];
    for (const paragraph of paragraphs) {
      if (wrapAllowed) lines.push(...wrapParagraph(paragraph, innerW, measure));
      else lines.push(paragraph);
    }
    lineMm = sizePt * PT_TO_MM * el.lineHeight;
    const widths = lines.map((l) => measure(l));
    const maxW = widths.length ? Math.max(...widths) : 0;
    const totalH = lines.length * lineMm;
    fits = maxW <= innerW + EPS && totalH <= innerH + EPS;
    if (fits || !shrinkAllowed || sizePt - 0.5 < el.minFontSizePt) {
      lines = lines.map((l, i) => ({ text: l, w: widths[i] }));
      break;
    }
    sizePt = Math.round((sizePt - 0.5) * 2) / 2;
  }
  const totalH = lines.length * lineMm;
  let startY = el.paddingMm;
  if (el.valign === 'middle') startY = el.paddingMm + (innerH - totalH) / 2;
  else if (el.valign === 'bottom') startY = el.paddingMm + innerH - totalH;
  const placed = lines.map((line, i) => {
    let x = el.paddingMm;
    if (el.align === 'center') x = el.paddingMm + (innerW - line.w) / 2;
    else if (el.align === 'right') x = el.paddingMm + innerW - line.w;
    return { text: line.text, x, y: startY + i * lineMm, w: line.w };
  });
  return { fontSizePt: sizePt, lineHeightMm: lineMm, lines: placed, overflowing: !fits, clip: el.overflow === 'clip' };
};

const layoutBarcode = (el, value, dpi, measurer) => {
  const encoded = value ? encodeCode128(value) : { ok: false, error: 'No barcode value', sbs: [], totalModules: 0 };
  const quiet = el.quietZoneMm;
  let moduleMm = quantizeToDots(el.moduleMm, dpi);
  let narrowed = false;
  if (el.maxWidthMm > 0 && encoded.totalModules > 0) {
    // Long values narrow the module in whole dots rather than running off the label.
    const dot = dotPitchMm(dpi);
    const available = Math.max(0, el.maxWidthMm - quiet * 2);
    // Never below two dots: a one-dot module does not scan reliably on thermal media.
    const fitting = Math.max(2 * dot, Math.floor(available / encoded.totalModules / dot) * dot);
    if (fitting < moduleMm) { moduleMm = fitting; narrowed = true; }
  }
  const barsW = encoded.totalModules * moduleMm;
  const textPt = el.showText ? el.textSizePt : 0;
  const textMm = el.showText ? textPt * PT_TO_MM * 1.2 : 0;
  const textFont = { family: fontFamilyCss('inter'), sizePt: textPt, bold: false, italic: false, letterSpacingPt: 0 };
  const tw = el.showText && value ? measurer.measure(value, textFont) : 0;
  const w = quiet * 2 + Math.max(barsW, tw, 10);
  const h = el.barHeightMm + textMm;
  // Bars and text are centred inside the element so neither can start left of its box.
  const barsLeft = quiet + (Math.max(barsW, tw, 10) - barsW) / 2;
  const overflowing = el.maxWidthMm > 0 && w > el.maxWidthMm + 0.001;
  const bars = [];
  let cursor = barsLeft;
  encoded.sbs.forEach((modules, index) => {
    const width = modules * moduleMm;
    if (index % 2 === 0) bars.push({ x: cursor, w: width });
    cursor += width;
  });
  let textLine = null;
  if (el.showText && value) {
    textLine = { text: value, x: (w - tw) / 2, y: el.barHeightMm + textPt * PT_TO_MM * 0.1, w: tw, fontSizePt: textPt, lineHeightMm: textPt * PT_TO_MM * 1.1 };
  }
  return { w, h, moduleMm, narrowed, overflowing, bars, barHeightMm: el.barHeightMm, textLine, error: encoded.ok ? null : encoded.error, value };
};

const layoutQr = (el, value, dpi) => {
  const encoded = value ? encodeQr(value, el.ecLevel) : { ok: false, error: 'No QR value', size: 0, pixels: [] };
  const size = encoded.size || 21;
  // Whole printer dots per module; the printed symbol is the nearest size that allows it.
  const moduleMm = quantizeToDots(el.sizeMm / size, dpi);
  const sizeMm = moduleMm * size;
  return { w: sizeMm, h: sizeMm, moduleMm, modules: size, rows: encoded.ok ? qrRuns(encoded.size, encoded.pixels) : [], error: encoded.ok ? null : encoded.error, value };
};

export const resolveElementText = (el, data) => {
  const raw = el.type === 'text' ? el.text : el.value;
  const substituted = substitutePlaceholders(raw ?? '', data);
  if (el.type === 'barcode' || el.type === 'qr') {
    // A symbol must never encode an unresolved placeholder literally.
    const value = substituted || data?.barcode || '';
    return new RegExp(PLACEHOLDER_PATTERN.source).test(value) ? '' : value;
  }
  return el.uppercase ? substituted.toUpperCase() : substituted;
};

export const layoutLabel = (templateInput, data = {}, measurer, options = {}) => {
  const template = normalizeTemplate(templateInput);
  const dpi = options.dpi || 203;
  const canvas = canvasSize(template.media);
  const elements = template.elements.filter((el) => !el.hidden).map((el) => {
    const text = resolveElementText(el, data);
    if (el.type === 'text') return { ...el, box: elementBox(el), layout: layoutText(el, text, measurer), text };
    if (el.type === 'barcode') {
      const layout = layoutBarcode(el, text, dpi, measurer);
      return { ...el, box: elementBox(el, layout), layout };
    }
    if (el.type === 'qr') {
      const layout = layoutQr(el, text, dpi);
      return { ...el, box: elementBox(el, layout), layout };
    }
    return { ...el, box: elementBox(el) };
  });
  return { template, canvas, dpi, elements };
};

// A canvas-free measurer for tests and fallbacks: proportional estimate by character class.
export const createEstimateMeasurer = () => ({
  measure: (text, font) => {
    const mono = /mono|courier/i.test(font.family);
    let em = 0;
    for (const ch of String(text)) {
      if (mono) em += 0.6;
      else if (/[iljtfI.,:;'|!]/.test(ch)) em += 0.3;
      else if (/[mwMW@]/.test(ch)) em += 0.9;
      else if (/[A-Z0-9]/.test(ch)) em += 0.66;
      else if (ch === ' ') em += 0.28;
      else em += 0.55;
    }
    if (font.bold) em *= 1.06;
    // CSS letter-spacing follows every glyph, the last one included.
    const widthMm = em * font.sizePt * PT_TO_MM + String(text).length * (font.letterSpacingPt || 0) * PT_TO_MM;
    return widthMm;
  },
});
