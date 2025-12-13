// Shared label printing helpers for LabelDesigner and stage flows.
// Handles template storage (localStorage), TSPL generation for text + Code128 barcodes,
// placeholder substitution, and posting jobs to the local print service.

import { formatDateDDMMYYYY } from './formatting';

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
    { key: 'pieceId', label: 'Piece ID' },
    { key: 'seq', label: 'Sequence' },
    { key: 'inboundDate', label: 'Lot Inbound Date' },
    { key: 'cut', label: 'Cut' },
    { key: 'count', label: 'Pieces Count' },
    { key: 'totalWeight', label: 'Total Weight' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Issue Barcode' },
  ],
  [LABEL_STAGE_KEYS.CUTTER_RECEIVE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'pieceId', label: 'Piece ID' },
    { key: 'seq', label: 'Sequence' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'tareWeight', label: 'Tare Weight' },
    { key: 'bobbinQty', label: 'Bobbin Qty' },
    { key: 'bobbinName', label: 'Bobbin' },
    { key: 'boxName', label: 'Box' },
    { key: 'cutName', label: 'Cut' },
    { key: 'machineName', label: 'Machine' },
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
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'bobbinQty', label: 'Bobbin Qty' },
    { key: 'bobbinType', label: 'Bobbin Type' },
    { key: 'cut', label: 'Cut' },
    { key: 'yarnKg', label: 'Yarn Kg' },
    { key: 'twistName', label: 'Twist' },
    { key: 'yarnName', label: 'Yarn' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'shift', label: 'Shift' },
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

const getApiOrigin = () => {
  if (import.meta?.env?.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined' && window.location) {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
};

const API_BASE_DEFAULT = `${getApiOrigin()}/api`;

const safeReadJson = async (response) => {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error('Invalid JSON response');
    err.cause = e;
    err.raw = raw;
    throw err;
  }
};

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
  // Keys that should be formatted as DD/MM/YYYY dates
  const dateKeys = ['date', 'inboundDate'];
  return value.replace(/(\{\{\s*([\w.]+)\s*\}\})|(@([\w.]+))/g, (match, p1, p2, p3, p4) => {
    const key = p2 || p4;
    if (key && data && Object.prototype.hasOwnProperty.call(data, key)) {
      const val = data[key];
      if (val === null || val === undefined) return '';
      // Format date values to DD/MM/YYYY
      if (dateKeys.includes(key) && val) {
        return formatDateDDMMYYYY(val) || String(val);
      }
      return String(val);
    }
    return match;
  });
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

const wrapTextByChars = (text = '', maxChars = 0) => {
  const max = Math.max(1, Math.floor(maxChars || 0));
  const inputLines = String(text ?? '').split(/\r?\n/);
  const out = [];

  inputLines.forEach((lineRaw) => {
    let line = String(lineRaw ?? '');
    while (line.length > max) {
      let breakAt = line.lastIndexOf(' ', max);
      if (breakAt <= 0) breakAt = max;
      out.push(line.slice(0, breakAt).trimEnd());
      line = line.slice(breakAt).trimStart();
    }
    if (line.length) out.push(line);
  });

  return out.length ? out : [''];
};

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
            wrapAtCenter: baseStyle.wrapAtCenter ?? false,
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
  const baseFields = (mergedContent.texts || []).map((t, idx) => ({
    ...normalizeBlock(t, idx),
    font: fontName,
  }));

  const getHalfWrapMaxChars = (field, fieldScale) => {
    if (!field || field.type !== 'text') return null;
    if (field.style?.wrapAtCenter !== true) return null;
    const angle = snapAngle(field.angle);
    const charWidthMm = 2 * fieldScale;

    const originX = offsetX + (field.pos?.x || 0);
    const originY = offsetY + (field.pos?.y || 0);
    const left = offsetX;
    const right = offsetX + width;
    const top = offsetY;
    const bottom = offsetY + height;
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;

    let axisMaxMm = null;
    if (angle === 0) axisMaxMm = (originX < centerX ? centerX : right) - originX;
    else if (angle === 180) axisMaxMm = originX - (originX > centerX ? centerX : left);
    else if (angle === 90) axisMaxMm = (originY < centerY ? centerY : bottom) - originY;
    else if (angle === 270) axisMaxMm = originY - (originY > centerY ? centerY : top);

    if (!axisMaxMm || axisMaxMm <= 0) return null;
    const maxChars = Math.floor(axisMaxMm / Math.max(0.1, charWidthMm));
    return maxChars >= 1 ? maxChars : 1;
  };

  const applyFlowLayout = (fields) => {
    const AFTER_WRAP_GAP_LINES = 1;
    const groups = new Map();
    const keyFor = (f) => {
      const angle = snapAngle(f.angle);
      const pos = f.pos || { x: 0, y: 0 };
      const originX = offsetX + (pos.x || 0);
      const originY = offsetY + (pos.y || 0);
      const centerX = (offsetX + offsetX + width) / 2;
      const centerY = (offsetY + offsetY + height) / 2;
      const half = angle === 0 || angle === 180 ? (originX < centerX ? 'A' : 'B') : originY < centerY ? 'A' : 'B';
      const laneRaw = angle === 0 || angle === 180 ? originX : originY;
      const lane = Math.round(laneRaw * 2) / 2;
      return `${angle}:${half}:${lane}`;
    };

    (fields || []).forEach((f) => {
      if (f?.style?.visible === false) return;
      const k = keyFor(f);
      const arr = groups.get(k) || [];
      arr.push(f);
      groups.set(k, arr);
    });

    const shifts = new Map();
    const getAxis = (f) => {
      const pos = f.pos || { x: 0, y: 0 };
      const angle = snapAngle(f.angle);
      return angle === 0 || angle === 180 ? (pos.y || 0) : (pos.x || 0);
    };
    const setShiftAlongAxis = (f, delta) => {
      if (!delta) return;
      const angle = snapAngle(f.angle);
      const cur = shifts.get(f.id) || { dx: 0, dy: 0 };
      if (angle === 0 || angle === 180) shifts.set(f.id, { ...cur, dy: (cur.dy || 0) + delta });
      else shifts.set(f.id, { ...cur, dx: (cur.dx || 0) + delta });
    };
    const dirSign = (angle) => {
      if (angle === 0) return 1;
      if (angle === 180) return -1;
      if (angle === 270) return 1;
      if (angle === 90) return -1;
      return 1;
    };

    for (const [_, list] of groups.entries()) {
      if (!list || list.length < 2) continue;
      const angle = snapAngle(list[0]?.angle);
      const sign = dirSign(angle);
      const sorted = [...list].sort((a, b) => (sign >= 0 ? getAxis(a) - getAxis(b) : getAxis(b) - getAxis(a)));
      let cursor = null;
      sorted.forEach((f) => {
        const baseAxis = getAxis(f);
        const currentShift = shifts.get(f.id);
        const axis = baseAxis + (angle === 0 || angle === 180 ? currentShift?.dy || 0 : currentShift?.dx || 0);
        if (cursor !== null) {
          if (sign >= 0 && axis < cursor) setShiftAlongAxis(f, cursor - axis);
          if (sign < 0 && axis > cursor) setShiftAlongAxis(f, cursor - axis);
        }

        const style = f.style || {};
        const fieldScale = getFontScale(style.size || dims.fontSize);
        const charHeightMm = 3 * fieldScale;
        const stepMm = charHeightMm * 1.05;

        const maxChars = getHalfWrapMaxChars(f, fieldScale);
        const raw = f._computedValue ?? f.value ?? '';
        const effectiveLines =
          f.type === 'text' && maxChars && sanitizeText(raw).length > maxChars ? wrapTextByChars(raw, maxChars) : [raw];
        const lineCount = Math.max(1, effectiveLines.length);
        const extraGap = f.type === 'text' && style.wrapAtCenter === true && lineCount > 1 ? AFTER_WRAP_GAP_LINES : 0;
        const advanceLines = f.type === 'text' && style.wrapAtCenter === true ? lineCount + extraGap : 1;

        const newShift = shifts.get(f.id);
        const axisAfterShift = baseAxis + (angle === 0 || angle === 180 ? newShift?.dy || 0 : newShift?.dx || 0);
        cursor = axisAfterShift + sign * stepMm * advanceLines;
      });
    }

    return (fields || []).map((f) => {
      const delta = shifts.get(f.id);
      if (!delta) return f;
      return {
        ...f,
        pos: { ...(f.pos || {}), x: (f.pos?.x || 0) + (delta.dx || 0), y: (f.pos?.y || 0) + (delta.dy || 0) },
      };
    });
  };

  for (let col = 0; col < columns; col += 1) {
    const columnOffset = marginLeft + (width + horizontalGap) * col + offsetX;
    const baseY = marginTop + offsetY;

    const fields = applyFlowLayout(
      baseFields.map((field) => {
        if (field?.style?.visible === false) return field;
        const valueRaw = field.value ?? '';
        const substituted = substitutePlaceholders(valueRaw, data);
        const finalValue = field.type === 'barcode' ? substituted || data.barcode || '' : substituted;
        return { ...field, _computedValue: finalValue };
      }),
    );

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
      const finalValue = field._computedValue ?? '';
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
      const opacity = clampNumber(Number(style.opacity ?? 1), 0, 1);
      if (opacity <= 0) return;
      const elementDensity = opacity < 1 ? Math.max(1, clampInt(baseDensity * opacity, 0, 15)) : baseDensity;
      if (elementDensity !== baseDensity) {
        lines.push(`DENSITY ${elementDensity}`);
      }
      const paddingMm = style.background?.paddingMm ?? 0.8;
      const charHeightMm = 3 * fieldScale;
      const charWidthMm = 2 * fieldScale;
      const wrapMaxChars = getHalfWrapMaxChars(field, fieldScale);
      const valueLines =
        wrapMaxChars && sanitizeText(finalValue).length > wrapMaxChars
          ? wrapTextByChars(finalValue, wrapMaxChars)
          : [finalValue];

      const lineStepMm = charHeightMm * 1.05;
      const lineOffset = (i) => {
        const step = lineStepMm * i;
        if (angle === 0) return { dx: 0, dy: step };
        if (angle === 90) return { dx: -step, dy: 0 };
        if (angle === 180) return { dx: 0, dy: -step };
        if (angle === 270) return { dx: step, dy: 0 };
        return { dx: 0, dy: step };
      };

      valueLines.forEach((lineValueRaw, i) => {
        const lineValue = lineValueRaw ?? '';
        if (!lineValue) return;

        const { dx, dy } = lineOffset(i);
        const x = mmToDots(columnOffset + (field.pos?.x || 0) + dx);
        const y = mmToDots(baseY + (field.pos?.y || 0) + dy);

        const textWidthMm = Math.max(1, sanitizeText(lineValue).length) * charWidthMm;
        const textHeightMm = charHeightMm;
        const boxWidthMm = textWidthMm + (style.background?.enabled ? paddingMm * 2 : 0);
        const boxHeightMm = textHeightMm + (style.background?.enabled ? paddingMm * 2 : 0);
        const underlineExtraMm = style.underline ? charHeightMm * 0.3 : 0;
        const totalBoxHeightMm = boxHeightMm + underlineExtraMm;

        let boxLeftMm = columnOffset + (field.pos?.x || 0) + dx - paddingMm;
        let boxTopMm = baseY + (field.pos?.y || 0) + dy - paddingMm;
        let boxWmm = boxWidthMm;
        let boxHmm = totalBoxHeightMm;

        if (angle === 90) {
          boxLeftMm = columnOffset + (field.pos?.x || 0) + dx - paddingMm - totalBoxHeightMm;
          boxTopMm = baseY + (field.pos?.y || 0) + dy - paddingMm;
          boxWmm = totalBoxHeightMm;
          boxHmm = boxWidthMm;
        } else if (angle === 180) {
          boxLeftMm = columnOffset + (field.pos?.x || 0) + dx - paddingMm - boxWidthMm;
          boxTopMm = baseY + (field.pos?.y || 0) + dy - paddingMm - totalBoxHeightMm;
        } else if (angle === 270) {
          boxLeftMm = columnOffset + (field.pos?.x || 0) + dx - paddingMm;
          boxTopMm = baseY + (field.pos?.y || 0) + dy - paddingMm - boxWidthMm;
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
        lines.push(`TEXT ${x},${y},"${tsplFont}",${angle},${tsplScale},${tsplScale},"${sanitizeText(lineValue)}"`);
        // Many thermal printers ignore TSPL bold settings; emulate bold by overprinting with a 1-dot offset.
        if (style.bold) {
          lines.push(
            `TEXT ${x + 1},${y},"${tsplFont}",${angle},${tsplScale},${tsplScale},"${sanitizeText(lineValue)}"`,
          );
        }
        if (style.underline) {
          const textLen = Math.max(1, sanitizeText(lineValue).length);
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
      });
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

export const loadTemplate = async (stageKey, options = {}) => {
  const apiBase = options.apiBase || API_BASE_DEFAULT;
  if (!stageKey) return null;
  try {
    const response = await fetch(`${apiBase}/sticker_templates/${encodeURIComponent(stageKey)}`);
    if (response.status === 404) return null;
    const payload = await safeReadJson(response);
    const tpl = payload?.template;
    if (!tpl) return null;
    return {
      dimensions: { ...DEFAULT_DIMENSIONS, ...(tpl.dimensions || {}) },
      content: migrateContent(tpl.content || {}),
    };
  } catch (err) {
    console.error('Failed to load template', stageKey, err);
    return null;
  }
};

export const saveTemplate = async (stageKey, template, options = {}) => {
  const apiBase = options.apiBase || API_BASE_DEFAULT;
  if (!stageKey) return { success: false, error: 'Missing stageKey' };
  try {
    const payload = {
      dimensions: { ...DEFAULT_DIMENSIONS, ...(template?.dimensions || {}) },
      content: migrateContent(template?.content || template),
    };
    const response = await fetch(`${apiBase}/sticker_templates/${encodeURIComponent(stageKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensions: payload.dimensions, content: payload.content }),
    });
    const result = await safeReadJson(response);
    if (!response.ok) {
      return { success: false, error: result?.error || 'Failed to save template', result };
    }
    return { success: true, template: result?.template || null, result };
  } catch (err) {
    console.error('Failed to save template', stageKey, err);
    return { success: false, error: err.message || 'Failed to save template' };
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
  const template = options.template || (await loadTemplate(stageKey, { apiBase: options.apiBase }));
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
