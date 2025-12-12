// Shared label printing helpers for StickerTest and stage flows.
// Handles template storage (localStorage), TSPL generation for text + Code128 barcodes,
// placeholder substitution, and posting jobs to the local print service.

const DOTS_PER_MM = 8; // 203dpi ~ 8 dots per mm
const DEFAULT_MATERIAL_CODE = (import.meta.env.VITE_BARCODE_MATERIAL_CODE || 'MET').toUpperCase();

export const LABEL_STAGE_KEYS = {
  INBOUND: 'inbound',
  CUTTER_ISSUE: 'cutter_issue',
  CUTTER_RECEIVE: 'cutter_receive',
  HOLO_ISSUE: 'holo_issue',
  HOLO_RECEIVE: 'holo_receive',
  CONING_ISSUE: 'coning_issue',
  CONING_RECEIVE: 'coning_receive',
};

export const STAGE_VARIABLES = {
  [LABEL_STAGE_KEYS.INBOUND]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'firmName', label: 'Firm Name' },
    { key: 'supplierName', label: 'Supplier Name' },
    { key: 'pieceId', label: 'Piece ID' },
    { key: 'seq', label: 'Sequence' },
    { key: 'weight', label: 'Weight' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Barcode' },
  ],
  [LABEL_STAGE_KEYS.CUTTER_ISSUE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'count', label: 'Pieces Count' },
    { key: 'totalWeight', label: 'Total Weight' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Issue Barcode' },
  ],
  [LABEL_STAGE_KEYS.CUTTER_RECEIVE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'pieceId', label: 'Piece ID' },
    { key: 'seq', label: 'Sequence' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'bobbinQty', label: 'Bobbin Qty' },
    { key: 'bobbinName', label: 'Bobbin' },
    { key: 'boxName', label: 'Box' },
    { key: 'cutName', label: 'Cut' },
    { key: 'helperName', label: 'Helper' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Receive Barcode' },
  ],
  [LABEL_STAGE_KEYS.HOLO_ISSUE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'totalRolls', label: 'Total Rolls' },
    { key: 'totalWeight', label: 'Total Weight' },
    { key: 'yarnKg', label: 'Yarn Kg' },
    { key: 'twistName', label: 'Twist' },
    { key: 'yarnName', label: 'Yarn' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Issue Barcode' },
  ],
  [LABEL_STAGE_KEYS.HOLO_RECEIVE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'rollCount', label: 'Roll Count' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'rollType', label: 'Roll Type' },
    { key: 'boxName', label: 'Box' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Receive Barcode' },
  ],
  [LABEL_STAGE_KEYS.CONING_ISSUE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'totalRolls', label: 'Total Rolls' },
    { key: 'totalWeight', label: 'Total Weight' },
    { key: 'expectedCones', label: 'Expected Cones' },
    { key: 'perConeTargetG', label: 'Target g/cone' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Issue Barcode' },
  ],
  [LABEL_STAGE_KEYS.CONING_RECEIVE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'issueBarcode', label: 'Issue Barcode' },
    { key: 'barcode', label: 'Receive Barcode' },
    { key: 'coneCount', label: 'Cone Count' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'boxName', label: 'Box' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
  ],
};

export const getStageVariables = (stage) => STAGE_VARIABLES[stage] || [];

const TEMPLATE_KEY = (stage) => `stickerTemplate:${stage}`;
const LEGACY_DIM_KEY = 'stickerDimensions';
const LEGACY_CONTENT_KEY = 'stickerContent';

export const DEFAULT_DIMENSIONS = {
  width: 48,
  height: 25,
  horizontalGap: 2,
  verticalGap: 2,
  pageWidth: 104,
  marginTop: 0,
  marginLeft: 0,
  fontSize: 10,
  columns: 2,
  offsetX: 0,
  offsetY: 0,
  orientation: 'portrait',
};

export const DEFAULT_CONTENT = {
  copies: 1,
  texts: [],
};

const snapAngle = (angle = 0) => {
  const normalized = ((angle % 360) + 360) % 360;
  const steps = [0, 90, 180, 270];
  return steps.reduce((best, step) => (Math.abs(step - normalized) < Math.abs(best - normalized) ? step : best), 0);
};

const mmToDots = (mm) => Math.round(mm * DOTS_PER_MM);
const sanitizeText = (text = '') => text.replace(/"/g, "'");

export const substitutePlaceholders = (value = '', data = {}) => {
  if (!value || typeof value !== 'string') return value;
  return value.replace(/(\{\{\s*([\w.]+)\s*\}\})|(@([\w.]+))/g, (match, p1, p2, p3, p4) => {
    const key = p2 || p4;
    if (key && data && Object.prototype.hasOwnProperty.call(data, key)) {
      const val = data[key];
      if (val === null || val === undefined) return '';
      return String(val);
    }
    return match;
  });
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

// Font size is stored as a "pt-like" number where 10 => scale 1.
// Use fractional scale to avoid visible jumps (1-14 all mapping to 1, etc.).
const getFontScale = (fontSize) => {
  const numeric = Number(fontSize);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return clampNumber(numeric / 10, 0.1, 10);
};

export const normalizeBlock = (block = {}, fallbackId = 0) => {
  const baseStyle = block.style || {};
  const type = block.type || 'text';
  const defaultBarcodeStyle = {
    heightMm: baseStyle.heightMm ?? 12,
    moduleMm: baseStyle.moduleMm ?? 0.3,
    humanReadable: baseStyle.humanReadable !== false,
    bold: false,
    italic: false,
    underline: false,
  };
  const defaultLineStyle = {
    lengthMm: baseStyle.lengthMm ?? 20,
    thicknessMm: baseStyle.thicknessMm ?? 0.6,
    visible: baseStyle.visible ?? true,
  };

  return {
    id: block.id || `text-${Date.now()}-${fallbackId}`,
    type,
    value: block.value ?? '',
    pos: {
      x: block.pos?.x ?? 5,
      y: block.pos?.y ?? 5,
    },
    angle: snapAngle(block.angle || 0),
    style:
      type === 'barcode'
        ? defaultBarcodeStyle
        : type === 'line'
          ? defaultLineStyle
        : {
            size: baseStyle.size ?? 10,
            bold: baseStyle.bold ?? false,
            italic: baseStyle.italic ?? false,
            underline: baseStyle.underline ?? false,
            opacity: baseStyle.opacity ?? 1,
            background: {
              enabled: baseStyle.background?.enabled ?? false,
              color: baseStyle.background?.color ?? '#000000',
              textColor: baseStyle.background?.textColor ?? '#ffffff',
              paddingMm: baseStyle.background?.paddingMm ?? 0.8,
            },
            visible: baseStyle.visible ?? true,
          },
  };
};

export const migrateContent = (raw) => {
  if (!raw) return { ...DEFAULT_CONTENT };
  if (raw.texts && Array.isArray(raw.texts)) {
    return {
      copies: raw.copies || 1,
      texts: raw.texts.map((t, idx) => normalizeBlock(t, idx)),
    };
  }
  const legacyKeys = ['title', 'subtitle', 'code', 'price'];
  const texts = legacyKeys
    .map((key, idx) => {
      if (!raw[key]) return null;
      return normalizeBlock(
        {
          id: `legacy-${key}`,
          value: raw[key],
          pos: raw[`${key}Pos`],
          angle: raw[`${key}Angle`],
          style: raw[`${key}Style`],
        },
        idx,
      );
    })
    .filter(Boolean);
  return {
    copies: raw.copies || 1,
    texts,
  };
};

export const deriveMaterialCodeFromItem = (item) => {
  if (!item) return DEFAULT_MATERIAL_CODE;
  if (item.barcodeMaterialCode) {
    return String(item.barcodeMaterialCode).trim().toUpperCase() || DEFAULT_MATERIAL_CODE;
  }
  return DEFAULT_MATERIAL_CODE;
};

export const makeInboundBarcode = ({ materialCode = DEFAULT_MATERIAL_CODE, lotNo, seq }) =>
  `INB-${String(materialCode || DEFAULT_MATERIAL_CODE).toUpperCase()}-${lotNo}-${String(seq).padStart(3, '0')}`;

export const makeIssueBarcode = ({ materialCode = DEFAULT_MATERIAL_CODE, lotNo, seq }) =>
  `ISM-${String(materialCode || DEFAULT_MATERIAL_CODE).toUpperCase()}-${lotNo}-${seq == null ? '000' : String(seq).padStart(3, '0')}`;

export const makeReceiveBarcode = ({ lotNo, seq, crateIndex = 1 }) =>
  `REC-${lotNo}-${String(seq).padStart(3, '0')}-C${String(crateIndex).padStart(3, '0')}`;

export const parseReceiveCrateIndex = (barcode) => {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/-C(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
};

export const buildTspl = (dimensions, content, data = {}) => {
  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const baseDensity = clampInt(dims.density ?? 8, 0, 15);
  const {
    width,
    height,
    pageWidth,
    horizontalGap,
    verticalGap,
    columns,
    marginLeft,
    marginTop,
    offsetX,
    offsetY,
    orientation,
  } = dims;
  const totalWidth = Math.max(pageWidth, width * columns + horizontalGap * (columns - 1));
  const lines = [
    `SIZE ${totalWidth.toFixed(2)} mm,${height.toFixed(2)} mm`,
    `GAP ${verticalGap.toFixed(2)} mm,0`,
    `DENSITY ${baseDensity}`,
    'SPEED 4',
    `DIRECTION ${orientation === 'landscape' ? 1 : 0}`,
    'REFERENCE 0,0',
    'CLS',
  ];

  const fontName = '3';
  const mergedContent = migrateContent(content);
  const fields = (mergedContent.texts || []).map((t, idx) => ({
    ...normalizeBlock(t, idx),
    font: fontName,
  }));

  for (let col = 0; col < columns; col += 1) {
    const columnOffset = marginLeft + (width + horizontalGap) * col + offsetX;
    const baseY = marginTop + offsetY;

    fields.forEach((field) => {
      if (field?.style?.visible === false) return;
      const angle = snapAngle(field.angle);
      if (field.type === 'line') {
        const lengthMm = Math.max(0.1, Number(field.style?.lengthMm ?? 20));
        const thicknessMm = Math.max(0.1, Number(field.style?.thicknessMm ?? 0.6));
        const horizontal = angle === 0 || angle === 180;
        const x = mmToDots(columnOffset + (field.pos?.x || 0));
        const y = mmToDots(baseY + (field.pos?.y || 0));
        const barW = Math.max(1, mmToDots(horizontal ? lengthMm : thicknessMm));
        const barH = Math.max(1, mmToDots(horizontal ? thicknessMm : lengthMm));
        lines.push(`BAR ${x},${y},${barW},${barH}`);
        return;
      }
      const valueRaw = field.value ?? '';
      const substituted = substitutePlaceholders(valueRaw, data);
      const finalValue = field.type === 'barcode' ? substituted || data.barcode || '' : substituted;
      if (!finalValue) return;

      if (field.type === 'barcode') {
        const moduleMm = field.style?.moduleMm ?? 0.3;
        const heightMm = field.style?.heightMm ?? 12;
        const moduleDots = Math.max(1, mmToDots(moduleMm));
        const heightDots = Math.max(16, mmToDots(heightMm));
        const humanReadable = field.style?.humanReadable === false ? 0 : 1;
        const x = mmToDots(columnOffset + (field.pos?.x || 0));
        const y = mmToDots(baseY + (field.pos?.y || 0));
        lines.push(
          `BARCODE ${x},${y},"128",${heightDots},${humanReadable},${angle},${moduleDots},${moduleDots * 3},"${sanitizeText(
            finalValue,
          )}"`,
        );
        return;
      }

      const style = field.style || {};
      const fieldScale = getFontScale(style.size || dims.fontSize);
      let tsplFont = field.font;
      let tsplScale = fieldScale;
      if (tsplScale < 1) {
        tsplFont = '1'; // font 1 is half the size of font 3
        tsplScale *= 2;
      }
      if (tsplScale < 1) tsplScale = 1;
      const x = mmToDots(columnOffset + (field.pos?.x || 0));
      const y = mmToDots(baseY + (field.pos?.y || 0));
      const opacity = clampNumber(Number(style.opacity ?? 1), 0, 1);
      if (opacity <= 0) return;
      const elementDensity = opacity < 1 ? Math.max(1, clampInt(baseDensity * opacity, 0, 15)) : baseDensity;
      if (elementDensity !== baseDensity) {
        lines.push(`DENSITY ${elementDensity}`);
      }
      const paddingMm = style.background?.paddingMm ?? 0.8;
      const charHeightMm = 3 * fieldScale;
      const charWidthMm = 2 * fieldScale;
      const textWidthMm = Math.max(1, sanitizeText(finalValue).length) * charWidthMm;
      const textHeightMm = charHeightMm;
      const boxWidthMm = textWidthMm + (style.background?.enabled ? paddingMm * 2 : 0);
      const boxHeightMm = textHeightMm + (style.background?.enabled ? paddingMm * 2 : 0);
      const underlineExtraMm = style.underline ? charHeightMm * 0.3 : 0;
      const totalBoxHeightMm = boxHeightMm + underlineExtraMm;

      let boxLeftMm = columnOffset + (field.pos?.x || 0) - paddingMm;
      let boxTopMm = baseY + (field.pos?.y || 0) - paddingMm;
      let boxWmm = boxWidthMm;
      let boxHmm = totalBoxHeightMm;

      if (angle === 90) {
        boxLeftMm = columnOffset + (field.pos?.x || 0) - paddingMm - totalBoxHeightMm;
        boxTopMm = baseY + (field.pos?.y || 0) - paddingMm;
        boxWmm = totalBoxHeightMm;
        boxHmm = boxWidthMm;
      } else if (angle === 180) {
        boxLeftMm = columnOffset + (field.pos?.x || 0) - paddingMm - boxWidthMm;
        boxTopMm = baseY + (field.pos?.y || 0) - paddingMm - totalBoxHeightMm;
      } else if (angle === 270) {
        boxLeftMm = columnOffset + (field.pos?.x || 0) - paddingMm;
        boxTopMm = baseY + (field.pos?.y || 0) - paddingMm - boxWidthMm;
        boxWmm = totalBoxHeightMm;
        boxHmm = boxWidthMm;
      }

      let boxX = mmToDots(boxLeftMm);
      let boxY = mmToDots(boxTopMm);
      let boxW = Math.max(1, mmToDots(boxWmm));
      let boxH = Math.max(1, mmToDots(boxHmm));
      if (boxX < 0) {
        boxW = Math.max(1, boxW + boxX);
        boxX = 0;
      }
      if (boxY < 0) {
        boxH = Math.max(1, boxH + boxY);
        boxY = 0;
      }
      if (style.background?.enabled) {
        boxW = Math.max(1, boxW + 2);
        boxH = Math.max(1, boxH + 2);
      }

      lines.push(`SETBOLD ${style.bold ? 3 : 0}`);
      lines.push(style.underline ? 'UNDERLINE ON' : 'UNDERLINE OFF');
      const textLine = `TEXT ${x},${y},"${tsplFont}",${angle},${tsplScale},${tsplScale},"${sanitizeText(
        finalValue,
      )}"`;
      lines.push(textLine);
      if (style.underline) {
        const textLen = Math.max(1, sanitizeText(finalValue).length);
        const charWidthDots = Math.max(1, Math.round(16 * fieldScale));
        const charHeightDots = Math.max(1, Math.round(24 * fieldScale));
        const lineWidth = Math.max(1, Math.round(textLen * charWidthDots));
        const underlineY = y + charHeightDots + 4;
        lines.push(`BAR ${x},${underlineY},${lineWidth},2`);
      }
      if (style.background?.enabled) {
        lines.push(`REVERSE ${boxX},${boxY},${boxW},${boxH}`);
      }
      lines.push('UNDERLINE OFF');
      lines.push('SETBOLD 0');
      if (elementDensity !== baseDensity) {
        lines.push(`DENSITY ${baseDensity}`);
      }
    });
  }

  lines.push(`PRINT ${mergedContent.copies || 1}`);
  return `${lines.join('\r\n')}\r\n`;
};

export const buildTsplFromTemplate = (template = {}, data = {}) => {
  const dimensions = { ...DEFAULT_DIMENSIONS, ...(template.dimensions || {}) };
  const content = migrateContent(template.content || template);
  return buildTspl(dimensions, content, data);
};

export const loadTemplate = (stageKey) => {
  if (!stageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TEMPLATE_KEY(stageKey));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        dimensions: { ...DEFAULT_DIMENSIONS, ...(parsed.dimensions || {}) },
        content: migrateContent(parsed.content || parsed),
      };
    }
  } catch (err) {
    console.error('Failed to load template', stageKey, err);
  }
  try {
    const legacyDims = window.localStorage.getItem(LEGACY_DIM_KEY);
    const legacyContent = window.localStorage.getItem(LEGACY_CONTENT_KEY);
    if (legacyDims && legacyContent) {
      return {
        dimensions: { ...DEFAULT_DIMENSIONS, ...JSON.parse(legacyDims) },
        content: migrateContent(JSON.parse(legacyContent)),
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
};

export const saveTemplate = (stageKey, template) => {
  if (!stageKey || typeof window === 'undefined') return;
  try {
    const payload = {
      dimensions: { ...DEFAULT_DIMENSIONS, ...(template?.dimensions || {}) },
      content: migrateContent(template?.content || template),
    };
    window.localStorage.setItem(TEMPLATE_KEY(stageKey), JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to save template', stageKey, err);
  }
};

export const getPreferredPrinter = () => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('stickerPrinter') || '';
  } catch (e) {
    return '';
  }
};

export const setPreferredPrinter = (printerName) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('stickerPrinter', printerName || '');
  } catch (e) {
    // ignore
  }
};

export const sendToLocalPrinter = async ({
  printer,
  content,
  type = 'raw',
  serviceBase = 'http://localhost:9090',
}) => {
  if (!content) {
    return { success: false, error: 'Missing print content' };
  }
  try {
    const response = await fetch(`${serviceBase}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer, content, type }),
    });
    const result = await response.json();
    if (result.success) {
      return { success: true, result };
    }
    return { success: false, error: result.error || 'Failed to send print job', result };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to send print job' };
  }
};

export const printStageTemplate = async (stageKey, data = {}, options = {}) => {
  const template = options.template || loadTemplate(stageKey);
  if (!template) {
    return { success: false, skipped: true, reason: 'Template not found' };
  }
  const tspl = buildTsplFromTemplate(template, data);
  const printer = options.printer || getPreferredPrinter();
  const result = await sendToLocalPrinter({ printer, content: tspl, type: 'raw', serviceBase: options.serviceBase });
  return { ...result, tspl };
};

export default {
  LABEL_STAGE_KEYS,
  STAGE_VARIABLES,
  DEFAULT_DIMENSIONS,
  DEFAULT_CONTENT,
  substitutePlaceholders,
  normalizeBlock,
  migrateContent,
  buildTspl,
  buildTsplFromTemplate,
  loadTemplate,
  saveTemplate,
  printStageTemplate,
  sendToLocalPrinter,
  getPreferredPrinter,
  setPreferredPrinter,
  makeInboundBarcode,
  makeIssueBarcode,
  makeReceiveBarcode,
  parseReceiveCrateIndex,
  deriveMaterialCodeFromItem,
  getStageVariables,
};
