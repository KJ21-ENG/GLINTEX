// Label template model, version 2.
//
// Every length is in millimetres, every font size in points. A template describes the
// physical media (how the label sits on the roll) and a list of boxed elements in the
// reading orientation of the label. The renderer, not the designer, turns a landscape
// design into the portrait page the printer feeds.

export const TEMPLATE_VERSION = 2;

export const FONT_FAMILIES = [
  // Single quotes: these strings are written into double-quoted style attributes.
  { value: 'inter', label: 'Inter', css: "'Inter', sans-serif", bundled: 'Inter' },
  { value: 'roboto-mono', label: 'Roboto Mono', css: "'Roboto Mono', monospace", bundled: 'Roboto Mono' },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', css: "'IBM Plex Sans', sans-serif", bundled: 'IBM Plex Sans' },
  { value: 'courier-new', label: 'Courier New', css: "'Courier New', 'Courier', monospace", bundled: null },
];

export const fontFamilyCss = (value) => (FONT_FAMILIES.find((f) => f.value === value) || FONT_FAMILIES[0]).css;
export const isKnownFontFamily = (value) => FONT_FAMILIES.some((f) => f.value === value);

export const ORIENTATIONS = ['portrait', 'landscape'];
export const ROTATIONS = [0, 90, 180, 270];
export const TEXT_ALIGNS = ['left', 'center', 'right'];
export const TEXT_VALIGNS = ['top', 'middle', 'bottom'];
export const TEXT_OVERFLOWS = ['wrap', 'shrink', 'wrap-shrink', 'clip'];
export const COLUMN_MODES = ['repeat', 'sequence'];
export const QR_EC_LEVELS = ['L', 'M', 'Q', 'H'];
export const ELEMENT_TYPES = ['text', 'barcode', 'qr', 'line', 'rect', 'image'];

export const DEFAULT_MEDIA = Object.freeze({
  widthMm: 75,       // label width across the roll
  heightMm: 125,     // label length along the feed
  orientation: 'landscape',
  rollWidthMm: 75,
  columns: 1,
  columnGapMm: 2,
  rowGapMm: 2,
  marginLeftMm: 0,
  marginTopMm: 0,
  offsetXMm: 0,      // calibration nudge of the whole artwork on the page
  offsetYMm: 0,
  columnMode: 'repeat',
});

export const LIMITS = Object.freeze({
  mediaMinMm: 5,
  mediaMaxMm: 500,
  columnsMax: 8,
  fontMinPt: 3,
  fontMaxPt: 120,
  moduleMinMm: 0.1,
  moduleMaxMm: 2,
  copiesMax: 50,
  elementsMax: 200,
  imageBytesMax: 600 * 1024,
});

const num = (value, fallback, min = -Infinity, max = Infinity) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const round = (value, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const bool = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);
const str = (value, fallback = '') => (typeof value === 'string' ? value : value == null ? fallback : String(value));

let idCounter = 0;
export const newElementId = (type = 'el') => `${type}-${Date.now().toString(36)}-${(idCounter += 1).toString(36)}`;

// The design canvas is the label in reading orientation.
export const canvasSize = (media) => (
  media.orientation === 'landscape'
    ? { widthMm: media.heightMm, heightMm: media.widthMm }
    : { widthMm: media.widthMm, heightMm: media.heightMm }
);

export const normalizeMedia = (raw = {}) => {
  const media = {
    widthMm: round(num(raw.widthMm, DEFAULT_MEDIA.widthMm, LIMITS.mediaMinMm, LIMITS.mediaMaxMm)),
    heightMm: round(num(raw.heightMm, DEFAULT_MEDIA.heightMm, LIMITS.mediaMinMm, LIMITS.mediaMaxMm)),
    orientation: pick(raw.orientation, ORIENTATIONS, DEFAULT_MEDIA.orientation),
    rollWidthMm: round(num(raw.rollWidthMm, DEFAULT_MEDIA.rollWidthMm, LIMITS.mediaMinMm, LIMITS.mediaMaxMm)),
    columns: Math.round(num(raw.columns, DEFAULT_MEDIA.columns, 1, LIMITS.columnsMax)),
    columnGapMm: round(num(raw.columnGapMm, DEFAULT_MEDIA.columnGapMm, 0, 100)),
    rowGapMm: round(num(raw.rowGapMm, DEFAULT_MEDIA.rowGapMm, 0, 100)),
    marginLeftMm: round(num(raw.marginLeftMm, DEFAULT_MEDIA.marginLeftMm, 0, 100)),
    marginTopMm: round(num(raw.marginTopMm, DEFAULT_MEDIA.marginTopMm, 0, 100)),
    offsetXMm: round(num(raw.offsetXMm, DEFAULT_MEDIA.offsetXMm, -50, 50)),
    offsetYMm: round(num(raw.offsetYMm, DEFAULT_MEDIA.offsetYMm, -50, 50)),
    columnMode: pick(raw.columnMode, COLUMN_MODES, DEFAULT_MEDIA.columnMode),
  };
  if (media.rollWidthMm < media.widthMm) media.rollWidthMm = media.widthMm;
  return media;
};

export const usedRollWidthMm = (media) => media.marginLeftMm + media.widthMm * media.columns + media.columnGapMm * (media.columns - 1);

export const ELEMENT_DEFAULTS = {
  text: {
    text: 'Text', fontFamily: 'inter', fontSizePt: 10, bold: false, italic: false, underline: false,
    align: 'left', valign: 'top', overflow: 'wrap-shrink', minFontSizePt: 5, lineHeight: 1.15,
    invert: false, paddingMm: 0.5, uppercase: false, letterSpacingPt: 0,
  },
  barcode: { value: '{{barcode}}', symbology: 'code128', moduleMm: 0.375, barHeightMm: 10, showText: true, textSizePt: 7, quietZoneMm: 2.5, maxWidthMm: 0 },
  qr: { value: '{{barcode}}', sizeMm: 15, ecLevel: 'M' },
  line: { lengthMm: 30, thicknessMm: 0.4, direction: 'horizontal' },
  rect: { strokeMm: 0.3, fill: false, radiusMm: 0 },
  image: { src: '', fit: 'contain' },
};

const normalizeBox = (raw, fallbackW, fallbackH) => ({
  x: round(num(raw.x, 0, -500, 500)),
  y: round(num(raw.y, 0, -500, 500)),
  w: round(num(raw.w, fallbackW, 0.1, 500)),
  h: round(num(raw.h, fallbackH, 0.1, 500)),
});

export const normalizeElement = (raw = {}, index = 0) => {
  const type = pick(raw.type, ELEMENT_TYPES, 'text');
  const d = ELEMENT_DEFAULTS[type];
  const base = {
    id: str(raw.id) || `el-${index + 1}`,
    type,
    name: str(raw.name).slice(0, 60),
    rotation: pick(Number(raw.rotation) || 0, ROTATIONS, 0),
    locked: bool(raw.locked),
    hidden: bool(raw.hidden),
  };
  if (type === 'text') {
    return {
      ...base, ...normalizeBox(raw, 30, 6),
      text: str(raw.text).slice(0, 2000),
      fontFamily: isKnownFontFamily(raw.fontFamily) ? raw.fontFamily : d.fontFamily,
      fontSizePt: round(num(raw.fontSizePt, d.fontSizePt, LIMITS.fontMinPt, LIMITS.fontMaxPt), 1),
      bold: bool(raw.bold), italic: bool(raw.italic), underline: bool(raw.underline),
      align: pick(raw.align, TEXT_ALIGNS, d.align),
      valign: pick(raw.valign, TEXT_VALIGNS, d.valign),
      overflow: pick(raw.overflow, TEXT_OVERFLOWS, d.overflow),
      minFontSizePt: round(num(raw.minFontSizePt, d.minFontSizePt, LIMITS.fontMinPt, LIMITS.fontMaxPt), 1),
      lineHeight: round(num(raw.lineHeight, d.lineHeight, 0.8, 3)),
      invert: bool(raw.invert),
      paddingMm: round(num(raw.paddingMm, d.paddingMm, 0, 20)),
      uppercase: bool(raw.uppercase),
      letterSpacingPt: round(num(raw.letterSpacingPt, 0, -2, 10)),
    };
  }
  if (type === 'barcode') {
    return {
      ...base, x: round(num(raw.x, 0, -500, 500)), y: round(num(raw.y, 0, -500, 500)),
      value: str(raw.value, d.value).slice(0, 200) || d.value,
      symbology: 'code128',
      moduleMm: round(num(raw.moduleMm, d.moduleMm, LIMITS.moduleMinMm, LIMITS.moduleMaxMm), 3),
      barHeightMm: round(num(raw.barHeightMm, d.barHeightMm, 2, 100)),
      showText: bool(raw.showText, d.showText),
      textSizePt: round(num(raw.textSizePt, d.textSizePt, LIMITS.fontMinPt, 40), 1),
      quietZoneMm: round(num(raw.quietZoneMm, d.quietZoneMm, 0, 20)),
      maxWidthMm: round(num(raw.maxWidthMm, d.maxWidthMm, 0, 500)),
    };
  }
  if (type === 'qr') {
    return {
      ...base, x: round(num(raw.x, 0, -500, 500)), y: round(num(raw.y, 0, -500, 500)),
      value: str(raw.value, d.value).slice(0, 500) || d.value,
      sizeMm: round(num(raw.sizeMm, d.sizeMm, 4, 200)),
      ecLevel: pick(raw.ecLevel, QR_EC_LEVELS, d.ecLevel),
    };
  }
  if (type === 'line') {
    return {
      ...base, x: round(num(raw.x, 0, -500, 500)), y: round(num(raw.y, 0, -500, 500)),
      lengthMm: round(num(raw.lengthMm, d.lengthMm, 0.1, 500)),
      thicknessMm: round(num(raw.thicknessMm, d.thicknessMm, 0.1, 20)),
      direction: pick(raw.direction, ['horizontal', 'vertical'], d.direction),
    };
  }
  if (type === 'rect') {
    return {
      ...base, ...normalizeBox(raw, 20, 10),
      strokeMm: round(num(raw.strokeMm, d.strokeMm, 0, 20)),
      fill: bool(raw.fill),
      radiusMm: round(num(raw.radiusMm, d.radiusMm, 0, 50)),
    };
  }
  // image
  const src = str(raw.src);
  return {
    ...base, ...normalizeBox(raw, 20, 20),
    src: /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length <= LIMITS.imageBytesMax * 1.4 ? src : '',
    fit: pick(raw.fit, ['contain', 'stretch'], d.fit),
  };
};

export const createElement = (type, overrides = {}) => normalizeElement({ ...ELEMENT_DEFAULTS[type], ...overrides, type, id: overrides.id || newElementId(type) });

export const isV2Template = (raw) => raw && typeof raw === 'object' && Number(raw.version) === TEMPLATE_VERSION && Array.isArray(raw.elements);

// Accepts a version 2 template, or anything else as an opaque object for the migrator to handle.
export const normalizeTemplate = (raw = {}) => {
  const media = normalizeMedia(raw.media || {});
  const seen = new Set();
  const elements = (Array.isArray(raw.elements) ? raw.elements : []).slice(0, LIMITS.elementsMax).map((el, index) => {
    const normalized = normalizeElement(el, index);
    while (seen.has(normalized.id)) normalized.id = `${normalized.id}-${index + 1}`;
    seen.add(normalized.id);
    return normalized;
  });
  return {
    version: TEMPLATE_VERSION,
    media,
    copies: Math.round(num(raw.copies, 1, 1, LIMITS.copiesMax)),
    elements,
  };
};

export const cloneTemplate = (template) => JSON.parse(JSON.stringify(template));

// Geometry of an element's bounding box in the reading canvas, before rotation.
export const elementBox = (el, measured = null) => {
  if (el.type === 'line') {
    return el.direction === 'horizontal'
      ? { x: el.x, y: el.y, w: el.lengthMm, h: el.thicknessMm }
      : { x: el.x, y: el.y, w: el.thicknessMm, h: el.lengthMm };
  }
  if (el.type === 'barcode' || el.type === 'qr') {
    return { x: el.x, y: el.y, w: measured?.w ?? (el.type === 'qr' ? el.sizeMm : 30), h: measured?.h ?? (el.type === 'qr' ? el.sizeMm : el.barHeightMm + (el.showText ? 3 : 0)) };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
};

// Visual bounding box after rotation (rotation keeps x,y as the visual top-left).
export const rotatedBox = (box, rotation) => (
  rotation === 90 || rotation === 270 ? { x: box.x, y: box.y, w: box.h, h: box.w } : { ...box }
);
