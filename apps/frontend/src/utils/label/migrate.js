// Converts version 1 templates (dimensions + content.texts, printer-frame coordinates,
// pseudo-point font sizes) into version 2. Saved production templates are version 1.
import { normalizeTemplate, isV2Template, TEMPLATE_VERSION } from './model.js';

const V1_FONT_PT_PER_UNIT = 0.85; // v1 size 10 drew a 3 mm character cell = 8.5 pt
const PT_TO_MM = 25.4 / 72;

const n = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const snapAngle = (angle = 0) => {
  const normalized = ((n(angle) % 360) + 360) % 360;
  return [0, 90, 180, 270].reduce((best, step) => (Math.abs(step - normalized) < Math.abs(best - normalized) ? step : best), 0);
};

const v1FontPt = (size, fallback = 10) => Math.max(3, Math.round(n(size, fallback) * V1_FONT_PT_PER_UNIT * 2) / 2);
const v1LineMm = (sizePt) => sizePt * PT_TO_MM * 1.05;

// Map a point in the v1 printer frame (portrait page) to the reading canvas.
const toReading = (landscape, pageHeight, px, py) => (landscape ? { x: pageHeight - py, y: px } : { x: px, y: py });

const lineEndpoints = (pos, angle, length) => {
  const x = n(pos?.x), y = n(pos?.y);
  if (angle === 0) return [{ x, y }, { x: x + length, y }];
  if (angle === 90) return [{ x, y }, { x, y: y + length }];
  if (angle === 180) return [{ x, y }, { x: x - length, y }];
  return [{ x, y }, { x, y: y - length }];
};

export const migrateV1Template = (raw = {}) => {
  const dims = { width: 48, height: 25, horizontalGap: 2, verticalGap: 2, pageWidth: 104, marginTop: 0, marginLeft: 0, fontSize: 10, columns: 2, offsetX: 0, offsetY: 0, orientation: 'portrait', ...(raw.dimensions || {}) };
  const content = raw.content && typeof raw.content === 'object' ? raw.content : raw;
  const landscape = dims.orientation === 'landscape';
  const pageW = n(dims.width, 48), pageH = n(dims.height, 25);
  const canvasW = landscape ? pageH : pageW;
  const canvasH = landscape ? pageW : pageH;
  const media = {
    widthMm: pageW, heightMm: pageH, orientation: landscape ? 'landscape' : 'portrait',
    rollWidthMm: n(dims.pageWidth, pageW), columns: n(dims.columns, 1), columnGapMm: n(dims.horizontalGap, 2),
    rowGapMm: n(dims.verticalGap, 2), marginLeftMm: n(dims.marginLeft, 0), marginTopMm: n(dims.marginTop, 0),
    offsetXMm: n(dims.offsetX, 0), offsetYMm: n(dims.offsetY, 0), columnMode: 'repeat',
  };
  const elements = [];
  (Array.isArray(content.texts) ? content.texts : []).forEach((block, index) => {
    if (!block || typeof block !== 'object') return;
    const type = block.type || 'text';
    const angle = snapAngle(block.angle);
    const style = block.style || {};
    const id = block.id || `${type}-${index + 1}`;
    const common = { id, locked: block.locked === true, hidden: style.visible === false };
    if (type === 'line') {
      const length = Math.max(0.1, n(style.lengthMm, 20));
      const [a, b] = lineEndpoints(block.pos, angle, length).map((p) => toReading(landscape, pageH, p.x, p.y));
      const horizontal = Math.abs(a.y - b.y) < 0.001;
      elements.push({
        ...common, type: 'line', direction: horizontal ? 'horizontal' : 'vertical',
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), lengthMm: length, thicknessMm: Math.max(0.1, n(style.thicknessMm, 0.6)),
      });
      return;
    }
    // v1 anchored every block at its top-left; the standard orientations map exactly.
    const standard = landscape ? angle === 270 : angle === 0;
    const page = { x: n(block.pos?.x), y: n(block.pos?.y) };
    const origin = toReading(landscape, pageH, page.x, page.y);
    let rotation = 0;
    if (!standard) rotation = landscape ? (angle + 90) % 360 : angle;
    if (type === 'barcode') {
      const isQr = style.codeType === 'qr';
      if (isQr) {
        elements.push({ ...common, type: 'qr', x: origin.x, y: origin.y, rotation, value: block.value || '{{barcode}}', sizeMm: n(style.sizeMm, 15) || 15, ecLevel: style.ecLevel || 'M' });
      } else {
        const moduleMm = n(style.moduleMm, 0.3) || 0.3;
        const quiet = style.quietZoneMm && Number.isFinite(Number(style.quietZoneMm.left)) ? Number(style.quietZoneMm.left) : Math.max(2.5, 10 * moduleMm);
        elements.push({
          ...common, type: 'barcode', x: origin.x, y: origin.y, rotation, value: block.value || '{{barcode}}', symbology: 'code128',
          moduleMm, barHeightMm: Math.max(2, n(style.heightMm, 12)), showText: style.humanReadable !== false, textSizePt: 7, quietZoneMm: quiet,
        });
      }
      return;
    }
    const sizePt = v1FontPt(style.size, n(dims.fontSize, 10));
    const value = typeof block.value === 'string' ? block.value : '';
    const wrapAtCenter = style.wrapAtCenter === true;
    // Width: v1 wrapped at the label edge, or at the centre line for wrapAtCenter.
    const axisMax = rotation === 0 || rotation === 180 ? canvasW : canvasH;
    const start = rotation === 0 || rotation === 180 ? origin.x : origin.y;
    const centre = axisMax / 2;
    const limit = wrapAtCenter && start < centre ? centre : axisMax;
    // v1 wrapped at the label edge (or the centre line), never at the text's own width.
    const w = Math.max(4, limit - start);
    const lineMm = v1LineMm(sizePt);
    const padding = style.background?.enabled ? n(style.background?.paddingMm, 0.8) : 0;
    const lines = wrapAtCenter ? 2 : 1;
    elements.push({
      ...common, type: 'text', x: origin.x - padding, y: origin.y - padding, w: w + padding * 2, h: lineMm * lines + padding * 2, rotation,
      text: value, fontFamily: ['courier-new', 'inter', 'roboto-mono', 'ibm-plex-sans'].includes(style.fontFamily) ? style.fontFamily : 'courier-new',
      fontSizePt: sizePt, bold: style.bold === true, italic: style.italic === true, underline: style.underline === true,
      align: 'left', valign: 'top', overflow: 'wrap', minFontSizePt: Math.min(5, sizePt), lineHeight: 1.05,
      invert: style.background?.enabled === true, paddingMm: padding, uppercase: false, letterSpacingPt: 0,
    });
  });
  return normalizeTemplate({ version: TEMPLATE_VERSION, media, copies: n(content.copies, 1) || 1, elements });
};

// Any stored shape in, canonical version 2 out.
export const toV2Template = (raw) => {
  if (!raw || typeof raw !== 'object') return normalizeTemplate({});
  if (isV2Template(raw)) return normalizeTemplate(raw);
  // Stored rows keep the whole version 2 template in `content` (dimensions is a summary).
  if (raw.content && isV2Template(raw.content)) return normalizeTemplate(raw.content);
  return migrateV1Template(raw);
};
