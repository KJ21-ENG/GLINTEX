// Shared label printing helpers for LabelDesigner and stage flows.
// Handles template storage (localStorage), TSPL generation for text + Code128 barcodes,
// placeholder substitution, and posting jobs to the local print service.

import { formatDateDDMMYYYY } from './formatting';
import { buildBitmapTsplFromTemplate } from './labelBitmap';

export const DOTS_PER_MM = 8; // 203dpi ~ 8 dots per mm
const DEFAULT_MATERIAL_CODE = (import.meta.env.VITE_BARCODE_MATERIAL_CODE || 'MET').toUpperCase();

export const LABEL_STAGE_KEYS = {
  INBOUND: 'inbound',
  CUTTER_ISSUE: 'cutter_issue',
  CUTTER_ISSUE_SMALL: 'cutter_issue_small',
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
  [LABEL_STAGE_KEYS.CUTTER_ISSUE_SMALL]: [
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
    { key: 'cutName', label: 'Cut (Old)' },
    { key: 'cut', label: 'Cut' },
    { key: 'machineName', label: 'Machine' },
    { key: 'helperName', label: 'Helper' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'shift', label: 'Shift' },
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
    { key: 'twistName', label: 'Twist (Old)' },
    { key: 'twist', label: 'Twist' },
    { key: 'yarnName', label: 'Yarn' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'shift', label: 'Shift' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Issue Barcode' },
  ],
  [LABEL_STAGE_KEYS.HOLO_RECEIVE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'rollCount', label: 'Roll Count' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'tareWeight', label: 'Tare Weight' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'rollType', label: 'Roll Type' },
    { key: 'boxName', label: 'Box' },
    { key: 'cut', label: 'Cut' },
    { key: 'yarnName', label: 'Yarn' },
    { key: 'twist', label: 'Twist' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'shift', label: 'Shift' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Receive Barcode' },
  ],
  [LABEL_STAGE_KEYS.CONING_ISSUE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'cut', label: 'Cut' },
    { key: 'yarnName', label: 'Yarn' },
    { key: 'twist', label: 'Twist' },
    { key: 'rollType', label: 'Roll Type' },
    { key: 'coneType', label: 'Cone Type' },
    { key: 'wrapperName', label: 'Wrapper' },
    { key: 'totalRolls', label: 'Total Rolls' },
    { key: 'rollCount', label: 'Roll Count' },
    { key: 'totalWeight', label: 'Total Weight' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'tareWeight', label: 'Tare Weight' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'expectedCones', label: 'Expected Cones' },
    { key: 'perConeTargetG', label: 'Target g/cone' },
    { key: 'machineName', label: 'Machine' },
    { key: 'operatorName', label: 'Operator' },
    { key: 'date', label: 'Date' },
    { key: 'barcode', label: 'Issue Barcode' },
    { key: 'shift', label: 'Shift' },
  ],
  [LABEL_STAGE_KEYS.CONING_RECEIVE]: [
    { key: 'lotNo', label: 'Lot No' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'cut', label: 'Cut' },
    { key: 'yarnName', label: 'Yarn' },
    { key: 'twist', label: 'Twist' },
    { key: 'rollType', label: 'Roll Type' },
    { key: 'coneType', label: 'Cone Type' },
    { key: 'wrapperName', label: 'Wrapper' },
    { key: 'issueBarcode', label: 'Issue Barcode' },
    { key: 'barcode', label: 'Receive Barcode' },
    { key: 'rollCount', label: 'Roll Count' },
    { key: 'coneCount', label: 'Cone Count' },
    { key: 'grossWeight', label: 'Gross Weight' },
    { key: 'tareWeight', label: 'Tare Weight' },
    { key: 'netWeight', label: 'Net Weight' },
    { key: 'shift', label: 'Shift' },
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

const notifyUnauthorized = (response) => {
  if (!response || response.status !== 401) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
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

export const FONT_FAMILY_OPTIONS = [
  { value: 'courier-new', label: 'Courier New', cssFamily: '"Courier New", monospace' },
  { value: 'inter', label: 'Inter', cssFamily: '"Inter", sans-serif' },
  { value: 'roboto-mono', label: 'Roboto Mono', cssFamily: '"Roboto Mono", monospace' },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', cssFamily: '"IBM Plex Sans", sans-serif' },
];

export const getFontFamilyCss = (fontFamily = 'courier-new') => {
  const match = FONT_FAMILY_OPTIONS.find((option) => option.value === fontFamily);
  return match?.cssFamily || FONT_FAMILY_OPTIONS[0].cssFamily;
};

export const getBarcodeQuietZoneMm = (style = {}) => {
  const moduleMm = Math.max(0.1, Number(style.moduleMm ?? 0.3));
  const profile = style.profile === 'robust' ? 'robust' : 'balanced';
  const defaultLeftRight = profile === 'robust' ? Math.max(3.5, 12 * moduleMm) : Math.max(2.5, 10 * moduleMm);
  const defaultTop = 0.5;
  const defaultBottom = style.humanReadable === false ? 0.5 : 1.5;
  const quietZone = style.quietZoneMm || {};

  return {
    left: Math.max(0, Number(quietZone.left ?? defaultLeftRight)),
    right: Math.max(0, Number(quietZone.right ?? defaultLeftRight)),
    top: Math.max(0, Number(quietZone.top ?? defaultTop)),
    bottom: Math.max(0, Number(quietZone.bottom ?? defaultBottom)),
  };
};

export const snapAngle = (angle = 0) => {
  const normalized = ((angle % 360) + 360) % 360;
  const steps = [0, 90, 180, 270];
  return steps.reduce((best, step) => (Math.abs(step - normalized) < Math.abs(best - normalized) ? step : best), 0);
};

export const mmToDots = (mm) => Math.round(mm * DOTS_PER_MM);
export const sanitizeText = (text = '') => text.replace(/"/g, "'");

export const substitutePlaceholders = (value = '', data = {}) => {
  if (!value || typeof value !== 'string') return value;
  // Keys that should be formatted as DD/MM/YYYY dates
  const dateKeys = ['date', 'inboundDate'];
  // Keys that should be formatted with 3 decimals (weight values)
  const weightKeys = [
    'weight', 'totalWeight', 'netWeight', 'grossWeight', 'tareWeight',
    'rollWeight', 'coneWeight', 'yarnKg', 'metallicBobbinsWeight',
    'perConeTargetG', 'issuedBobbinWeight'
  ];
  return value.replace(/(\{\{\s*([\w.]+)\s*\}\})|(@([\w.]+))/g, (match, p1, p2, p3, p4) => {
    const key = p2 || p4;
    if (key && data && Object.prototype.hasOwnProperty.call(data, key)) {
      const val = data[key];
      if (val === null || val === undefined) return '';
      // Format date values to DD/MM/YYYY
      if (dateKeys.includes(key) && val) {
        return formatDateDDMMYYYY(val) || String(val);
      }
      // Format weight values to 3 decimals
      if (weightKeys.includes(key)) {
        const num = Number(val);
        return Number.isFinite(num) ? num.toFixed(3) : String(val);
      }
      return String(val);
    }
    return match;
  });
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

export const wrapTextByChars = (text = '', maxChars = 0) => {
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

export const wrapTextByWords = (text = '', maxWidth = 0, measureWidth = () => 0) => {
  const limit = Math.max(0, Number(maxWidth) || 0);
  const inputLines = String(text ?? '').split(/\r?\n/);
  const out = [];

  inputLines.forEach((lineRaw) => {
    const trimmed = String(lineRaw ?? '').trim();
    if (!trimmed) {
      out.push('');
      return;
    }

    const words = trimmed.split(/\s+/);
    let current = '';

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (!current) {
        current = word;
        return;
      }
      if (limit > 0 && measureWidth(candidate) > limit) {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });

    if (current) out.push(current);
  });

  return out.length ? out : [''];
};

// Font size is stored as a "pt-like" number where 10 => scale 1.
// Use fractional scale to avoid visible jumps (1-14 all mapping to 1, etc.).
export const getFontScale = (fontSize) => {
  const numeric = Number(fontSize);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return clampNumber(numeric / 10, 0.1, 10);
};

export const getWrapMaxChars = (field, dimensions, options = {}) => {
  if (!field || field.type !== 'text') return null;

  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const stageKey = options.stageKey || '';
  const angle = snapAngle(field.angle);
  const fieldScale = getFontScale(field.style?.size || dims.fontSize);
  const charWidthMm = 2 * fieldScale;
  const originX = dims.offsetX + (field.pos?.x || 0);
  const originY = dims.offsetY + (field.pos?.y || 0);
  const left = dims.offsetX;
  const right = dims.offsetX + dims.width;
  const top = dims.offsetY;
  const bottom = dims.offsetY + dims.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const wrapAtCenter = field.style?.wrapAtCenter === true;
  const useFullWidth = wrapAtCenter && stageKey === LABEL_STAGE_KEYS.CUTTER_ISSUE_SMALL;

  let axisMaxMm = null;
  if (wrapAtCenter && !useFullWidth) {
    if (angle === 0) axisMaxMm = (originX < centerX ? centerX : right) - originX;
    else if (angle === 180) axisMaxMm = originX - (originX > centerX ? centerX : left);
    else if (angle === 90) axisMaxMm = (originY < centerY ? centerY : bottom) - originY;
    else if (angle === 270) axisMaxMm = originY - (originY > centerY ? centerY : top);
  } else {
    if (angle === 0) axisMaxMm = right - originX;
    else if (angle === 180) axisMaxMm = originX - left;
    else if (angle === 90) axisMaxMm = bottom - originY;
    else if (angle === 270) axisMaxMm = originY - top;
  }

  if (!axisMaxMm || axisMaxMm <= 0) return null;
  const maxChars = Math.floor(axisMaxMm / Math.max(0.1, charWidthMm));
  return maxChars >= 1 ? maxChars : 1;
};

export const getWrappedTextLines = (field, dimensions, value = '', options = {}) => {
  if (!field || field.type !== 'text') return [String(value ?? '')];

  const maxChars = getWrapMaxChars(field, dimensions, options);
  if (!maxChars) return [String(value ?? '')];

  if (typeof document === 'undefined') {
    return wrapTextByChars(value, maxChars);
  }

  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const fieldScale = getFontScale(field.style?.size || dims.fontSize);
  const fontSizePx = Math.max(1, Math.round(3 * fieldScale * 10));
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return wrapTextByChars(value, maxChars);
  context.font = `${field.style?.italic ? 'italic ' : ''}${field.style?.bold ? '700 ' : '500 '}${fontSizePx}px ${getFontFamilyCss(field.style?.fontFamily)}`;
  context.textBaseline = 'top';

  const averageCharWidth = Math.max(1, context.measureText('MMMMMMMMMM').width / 10);
  return wrapTextByWords(value, maxChars * averageCharWidth, (line) => context.measureText(line).width);
};

export const applyFlowLayout = (fields = [], dimensions, options = {}) => {
  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const AFTER_WRAP_GAP_LINES = 1;
  const FLOW_LANE_CLUSTER_MM = 10;
  const groups = new Map();
  const laneKeyById = new Map();
  const laneMeta = fields
    .filter((field) => field?.style?.visible !== false)
    .map((field) => {
      const angle = snapAngle(field.angle);
      const pos = field.pos || { x: 0, y: 0 };
      const originX = dims.offsetX + (pos.x || 0);
      const originY = dims.offsetY + (pos.y || 0);
      const centerX = (dims.offsetX + dims.offsetX + dims.width) / 2;
      const centerY = (dims.offsetY + dims.offsetY + dims.height) / 2;
      const half = angle === 0 || angle === 180 ? (originX < centerX ? 'A' : 'B') : originY < centerY ? 'A' : 'B';
      const laneRaw = angle === 0 || angle === 180 ? originX : originY;
      return { id: field.id, angle, half, laneRaw };
    });

  const clusteredByStream = new Map();
  laneMeta.forEach((meta) => {
    const streamKey = `${meta.angle}:${meta.half}`;
    const list = clusteredByStream.get(streamKey) || [];
    list.push(meta);
    clusteredByStream.set(streamKey, list);
  });

  clusteredByStream.forEach((list, streamKey) => {
    const sorted = [...list].sort((a, b) => a.laneRaw - b.laneRaw);
    let clusterIndex = -1;
    let previousLane = null;
    sorted.forEach((meta) => {
      if (previousLane === null || Math.abs(meta.laneRaw - previousLane) > FLOW_LANE_CLUSTER_MM) {
        clusterIndex += 1;
      }
      laneKeyById.set(meta.id, `${streamKey}:${clusterIndex}`);
      previousLane = meta.laneRaw;
    });
  });

  const keyFor = (field) => {
    const angle = snapAngle(field.angle);
    const pos = field.pos || { x: 0, y: 0 };
    const originX = dims.offsetX + (pos.x || 0);
    const originY = dims.offsetY + (pos.y || 0);
    const centerX = (dims.offsetX + dims.offsetX + dims.width) / 2;
    const centerY = (dims.offsetY + dims.offsetY + dims.height) / 2;
    const half = angle === 0 || angle === 180 ? (originX < centerX ? 'A' : 'B') : originY < centerY ? 'A' : 'B';
    return laneKeyById.get(field.id) || `${angle}:${half}:fallback`;
  };

  fields.forEach((field) => {
    if (field?.style?.visible === false) return;
    const key = keyFor(field);
    const group = groups.get(key) || [];
    group.push(field);
    groups.set(key, group);
  });

  const shifts = new Map();
  const getAxis = (field) => {
    const pos = field.pos || { x: 0, y: 0 };
    const angle = snapAngle(field.angle);
    return angle === 0 || angle === 180 ? (pos.y || 0) : (pos.x || 0);
  };
  const setShiftAlongAxis = (field, delta) => {
    if (!delta) return;
    const angle = snapAngle(field.angle);
    const current = shifts.get(field.id) || { dx: 0, dy: 0 };
    if (angle === 0 || angle === 180) shifts.set(field.id, { ...current, dy: (current.dy || 0) + delta });
    else shifts.set(field.id, { ...current, dx: (current.dx || 0) + delta });
  };
  const dirSign = (angle) => {
    if (angle === 0) return 1;
    if (angle === 180) return -1;
    if (angle === 270) return 1;
    if (angle === 90) return -1;
    return 1;
  };

  for (const list of groups.values()) {
    if (!list || list.length < 2) continue;
    const angle = snapAngle(list[0]?.angle);
    const sign = dirSign(angle);
    const sorted = [...list].sort((a, b) => (sign >= 0 ? getAxis(a) - getAxis(b) : getAxis(b) - getAxis(a)));
    let cursor = null;

    sorted.forEach((field) => {
      const baseAxis = getAxis(field);
      const currentShift = shifts.get(field.id);
      const axis = baseAxis + (angle === 0 || angle === 180 ? currentShift?.dy || 0 : currentShift?.dx || 0);
      if (cursor !== null) {
        if (sign >= 0 && axis < cursor) setShiftAlongAxis(field, cursor - axis);
        if (sign < 0 && axis > cursor) setShiftAlongAxis(field, cursor - axis);
      }

      const style = field.style || {};
      const fieldScale = getFontScale(style.size || dims.fontSize);
      const charHeightMm = 3 * fieldScale;
      const stepMm = charHeightMm * 1.05;
      const raw = field._computedValue ?? field.value ?? '';
      const effectiveLines = field.type === 'text' ? getWrappedTextLines(field, dims, raw, options) : [raw];
      const lineCount = Math.max(1, effectiveLines.length);
      const extraGap = field.type === 'text' && style.wrapAtCenter === true && lineCount > 1 ? AFTER_WRAP_GAP_LINES : 0;
      const advanceLines = field.type === 'text' ? lineCount + extraGap : 1;

      const newShift = shifts.get(field.id);
      const axisAfterShift = baseAxis + (angle === 0 || angle === 180 ? newShift?.dy || 0 : newShift?.dx || 0);
      cursor = axisAfterShift + sign * stepMm * advanceLines;
    });
  }

  return fields.map((field) => {
    const delta = shifts.get(field.id);
    if (!delta) return field;
    return {
      ...field,
      pos: {
        ...(field.pos || {}),
        x: (field.pos?.x || 0) + (delta.dx || 0),
        y: (field.pos?.y || 0) + (delta.dy || 0),
      },
    };
  });
};

export const normalizeBlock = (block = {}, fallbackId = 0) => {
  const baseStyle = block.style || {};
  const type = block.type || 'text';
  const defaultBarcodeStyle = {
    heightMm: baseStyle.heightMm ?? 12,
    moduleMm: baseStyle.moduleMm ?? 0.3,
    humanReadable: baseStyle.humanReadable !== false,
    profile: baseStyle.profile === 'robust' ? 'robust' : 'balanced',
    quietZoneMm: getBarcodeQuietZoneMm(baseStyle),
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
    locked: block.locked === true,
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
            fontFamily: FONT_FAMILY_OPTIONS.some((option) => option.value === baseStyle.fontFamily)
              ? baseStyle.fontFamily
              : 'courier-new',
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

// ===== Standardized Barcode Helpers =====
// Format: {PREFIX}-{SERIES/LOT}-{SEQ}[-C{CRATE}]
// Approved Prefixes: INB, ICU, RCU, IHO, RHO, ICO, RCO

const padSeq = (seq, length = 3) => {
  const num = Number(seq);
  if (!Number.isFinite(num)) return String(seq || '').padStart(length, '0');
  return String(num).padStart(length, '0');
};

// Material code deprecated but kept for backward compatibility
export const deriveMaterialCodeFromItem = (item) => 'MET';

// INBOUND: INB-{LOT}-{SEQ}
export const makeInboundBarcode = ({ lotNo, seq }) =>
  `INB-${padSeq(lotNo)}-${padSeq(seq)}`;

// CUTTER ISSUE: ICU-{LOT}-{SEQ}
export const makeIssueBarcode = ({ lotNo, seq }) =>
  `ICU-${padSeq(lotNo)}-${seq == null ? '000' : padSeq(seq)}`;

// CUTTER RECEIVE: RCU-{LOT}-{SEQ}-C{CRATE}
export const makeReceiveBarcode = ({ lotNo, seq, crateIndex = 1 }) =>
  `RCU-${padSeq(lotNo)}-${padSeq(seq)}-C${padSeq(crateIndex)}`;

// HOLO ISSUE: IHO-{SERIES}
export const makeHoloIssueBarcode = ({ series }) =>
  `IHO-${padSeq(series)}`;

// HOLO RECEIVE: RHO-{SERIES}-C{CRATE}
export const makeHoloReceiveBarcode = ({ series, crateIndex = 1 }) =>
  `RHO-${padSeq(series)}-C${padSeq(crateIndex)}`;

// CONING ISSUE: ICO-{SERIES}
export const makeConingIssueBarcode = ({ series }) =>
  `ICO-${padSeq(series)}`;

// CONING RECEIVE: RCO-{SERIES}-C{CRATE}
export const makeConingReceiveBarcode = ({ series, crateIndex = 1 }) =>
  `RCO-${padSeq(series)}-C${padSeq(crateIndex)}`;

// Parse crate index from receive barcodes
export const parseReceiveCrateIndex = (barcode) => {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/-C(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
};

export const normalizeCopies = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.max(1, Math.round(num));
};

export const getTsplPreambleLines = (dimensions) => {
  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const baseDensity = clampInt(dims.density ?? 8, 0, 15);
  const totalWidth = Math.max(dims.pageWidth, dims.width * dims.columns + dims.horizontalGap * (dims.columns - 1));
  const lines = [
    'CLS',
    `SIZE ${totalWidth.toFixed(2)} mm,${dims.height.toFixed(2)} mm`,
    `GAP ${dims.verticalGap.toFixed(2)} mm,0`,
    `DENSITY ${baseDensity}`,
    'SPEED 4',
    `DIRECTION ${dims.orientation === 'landscape' ? 1 : 0}`,
    'REFERENCE 0,0',
    'CLS',
  ];

  return { dims, baseDensity, totalWidth, lines };
};

export const prepareTemplateFields = (dimensions, content, data = {}, options = {}) => {
  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const mergedContent = migrateContent(content);
  const fontName = options.fontName || '3';
  const baseFields = (mergedContent.texts || []).map((text, idx) => ({
    ...normalizeBlock(text, idx),
    font: fontName,
  }));
  const fields = applyFlowLayout(
    baseFields.map((field) => {
      if (field?.style?.visible === false) return field;
      const substituted = substitutePlaceholders(field.value ?? '', data);
      const finalValue = field.type === 'barcode' ? substituted || data.barcode || '' : substituted;
      return { ...field, _computedValue: finalValue };
    }),
    dims,
    options,
  );

  return {
    dims,
    mergedContent,
    fields,
  };
};

export const buildTspl = (dimensions, content, data = {}, options = {}) => {
  const copiesOverride = options.copies || null;
  const splitCopies = options.splitCopies !== false;
  const { dims, baseDensity, lines } = getTsplPreambleLines(dimensions);
  const {
    width,
    height,
    horizontalGap,
    columns,
    marginLeft,
    marginTop,
    offsetX,
    offsetY,
  } = dims;
  const { mergedContent, fields: baseFields } = prepareTemplateFields(dimensions, content, data, options);

  for (let col = 0; col < columns; col += 1) {
    const columnOffset = marginLeft + (width + horizontalGap) * col + offsetX;
    const baseY = marginTop + offsetY;

    baseFields.forEach((field) => {
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
      const valueLines = getWrappedTextLines(field, dims, finalValue, options);

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

  const finalCopies = normalizeCopies(copiesOverride || mergedContent.copies || 1);
  if (splitCopies && finalCopies > 1) {
    lines.push('PRINT 1');
    const single = `${lines.join('\r\n')}\r\n`;
    return single.repeat(finalCopies);
  }
  lines.push(`PRINT ${finalCopies}`);
  return `${lines.join('\r\n')}\r\n`;
};

export const buildTsplFromTemplate = (template = {}, data = {}, options = {}) => {
  const dimensions = { ...DEFAULT_DIMENSIONS, ...(template.dimensions || {}) };
  const content = migrateContent(template.content || template);
  return buildTspl(dimensions, content, data, options);
};

export const loadTemplate = async (stageKey, options = {}) => {
  const apiBase = options.apiBase || API_BASE_DEFAULT;
  if (!stageKey) return null;
  try {
    const response = await fetch(`${apiBase}/sticker_templates/${encodeURIComponent(stageKey)}`, {
      credentials: 'include',
    });
    notifyUnauthorized(response);
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
      credentials: 'include',
      body: JSON.stringify({ dimensions: payload.dimensions, content: payload.content }),
    });
    notifyUnauthorized(response);
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

const DEFAULT_PRINT_SERVICE_BASES = ['http://localhost:9090', 'http://127.0.0.1:9090'];

const normalizeServiceBase = (value) => String(value || '').trim().replace(/\/+$/, '');

export const getPrintServiceCandidates = () => {
  const candidates = [];
  const fromEnv = normalizeServiceBase(import.meta?.env?.VITE_PRINT_SERVICE_URL);
  if (fromEnv) candidates.push(fromEnv);
  if (typeof window !== 'undefined') {
    try {
      const fromStorage = normalizeServiceBase(window.localStorage.getItem('printServiceBase'));
      if (fromStorage) candidates.push(fromStorage);
    } catch (e) {
      // ignore
    }
  }
  DEFAULT_PRINT_SERVICE_BASES.forEach((base) => candidates.push(base));
  return [...new Set(candidates)].filter(Boolean);
};

export const resolvePrintServiceBase = async ({ timeoutMs = 1500, candidates } = {}) => {
  const list = candidates && candidates.length ? candidates : getPrintServiceCandidates();
  const tryFetch = async (url) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  };

  let lastError = null;
  for (const base of list) {
    try {
      const health = await tryFetch(`${base}/health`);
      if (health.ok) {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem('printServiceBase', base);
          } catch (e) {
            // ignore
          }
        }
        return { success: true, serviceBase: base };
      }
    } catch (e) {
      lastError = e;
    }

    try {
      const printersProbe = await tryFetch(`${base}/printers`);
      if (printersProbe.ok) {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem('printServiceBase', base);
          } catch (e) {
            // ignore
          }
        }
        return { success: true, serviceBase: base };
      }
    } catch (e) {
      lastError = e;
    }
  }

  return { success: false, error: lastError?.message || 'Failed to reach local print service', serviceBase: list[0] };
};

export const setPreferredPrinter = (printerName) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('stickerPrinter', printerName || '');
  } catch (e) {
    // ignore
  }
};

// Print queue to prevent rapid consecutive prints from causing buffer conflicts
// This addresses the ghosting issue where fast consecutive jobs overlap in printer memory
const PRINT_JOB_MIN_INTERVAL_MS = 800; // Minimum delay between print jobs
let lastPrintJobTime = 0;
let printQueuePromise = Promise.resolve();

const waitForPrintQueue = () => {
  const now = Date.now();
  const elapsed = now - lastPrintJobTime;
  const waitTime = Math.max(0, PRINT_JOB_MIN_INTERVAL_MS - elapsed);

  if (waitTime > 0) {
    return new Promise(resolve => setTimeout(resolve, waitTime));
  }
  return Promise.resolve();
};

export const shouldUseBitmapPrint = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('useBitmapPrint') !== 'false';
  } catch (e) {
    return true;
  }
};

export const uint8ArrayToBase64 = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return '';
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const concatUint8Arrays = (chunks = []) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    if (!(chunk instanceof Uint8Array) || chunk.length === 0) return;
    out.set(chunk, offset);
    offset += chunk.length;
  });

  return out;
};

export const sendToLocalPrinter = async ({
  printer,
  content,
  type = 'raw',
  serviceBase,
  encoding = 'text',
}) => {
  if (!content) {
    return { success: false, error: 'Missing print content' };
  }
  const requestMeta = {
    printer,
    type,
    encoding,
    contentLength: typeof content === 'string' ? content.length : 0,
  };

  // Queue this print job to ensure sequential execution with delay
  // This prevents printer buffer conflicts when users create multiple issues rapidly
  const executeJob = async () => {
    await waitForPrintQueue();

    try {
      const resolved = serviceBase
        ? { success: true, serviceBase: normalizeServiceBase(serviceBase) }
        : await resolvePrintServiceBase();
      if (!resolved.success) return { success: false, error: resolved.error || 'Local print service not reachable' };
      const base = resolved.serviceBase;

      console.info('Sending local print job', { ...requestMeta, serviceBase: base });
      const response = await fetch(`${base}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer, content, type, encoding }),
      });

      lastPrintJobTime = Date.now(); // Record time after job is sent

      const result = await response.json();
      if (result.success) {
        return { success: true, result, requestMeta: { ...requestMeta, serviceBase: base } };
      }
      return { success: false, error: result.error || 'Failed to send print job', result, requestMeta: { ...requestMeta, serviceBase: base } };
    } catch (err) {
      return { success: false, error: err.message || 'Failed to send print job', requestMeta };
    }
  };

  // Chain this job to the queue to ensure sequential execution
  printQueuePromise = printQueuePromise.then(executeJob).catch(() => executeJob());
  return printQueuePromise;
};

export const fetchLocalPrinters = async ({ serviceBase, timeoutMs = 2000 } = {}) => {
  const resolved = serviceBase
    ? { success: true, serviceBase: normalizeServiceBase(serviceBase) }
    : await resolvePrintServiceBase({ timeoutMs: Math.min(1500, timeoutMs) });
  if (!resolved.success) return { success: false, error: resolved.error || 'Local print service not reachable' };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${resolved.serviceBase}/printers`, { signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, error: text || 'Failed to fetch printers' };
    }
    const data = await response.json().catch(() => ({}));
    return { success: true, printers: data.printers || [], serviceBase: resolved.serviceBase };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to fetch printers' };
  } finally {
    clearTimeout(t);
  }
};

export const printStageTemplatesBatch = async (stageKey, dataArray = [], options = {}) => {
  if (!stageKey || !Array.isArray(dataArray) || dataArray.length === 0) {
    return { success: false, skipped: true, reason: 'Missing stageKey or empty dataArray' };
  }

  const template = options.template || (await loadTemplate(stageKey, { apiBase: options.apiBase }));
  if (!template) {
    return { success: false, skipped: true, reason: 'Template not found' };
  }

  const copies = options.copies || template.content?.copies || 1;
  let combinedTspl = '';
  for (const data of dataArray) {
    combinedTspl += buildTsplFromTemplate(template, data, { stageKey, copies });
  }

  const printer = options.printer || getPreferredPrinter();
  let printPayload = combinedTspl;
  let encoding = 'text';

  if (shouldUseBitmapPrint()) {
    const jobs = await Promise.all(
      dataArray.map((data) => buildBitmapTsplFromTemplate(template, data, { stageKey, copies })),
    );
    const combinedBytes = concatUint8Arrays(jobs);
    printPayload = uint8ArrayToBase64(combinedBytes);
    encoding = 'base64';
  }

  const result = await sendToLocalPrinter({
    printer,
    content: printPayload,
    type: 'raw',
    serviceBase: options.serviceBase,
    encoding,
  });

  return { ...result, tspl: combinedTspl };
};

export const printStageTemplate = async (stageKey, data = {}, options = {}) => {
  return printStageTemplatesBatch(stageKey, [data], options);
};

export default {
  LABEL_STAGE_KEYS,
  STAGE_VARIABLES,
  DEFAULT_DIMENSIONS,
  DEFAULT_CONTENT,
  FONT_FAMILY_OPTIONS,
  substitutePlaceholders,
  normalizeBlock,
  migrateContent,
  getBarcodeQuietZoneMm,
  getFontFamilyCss,
  prepareTemplateFields,
  buildTspl,
  buildTsplFromTemplate,
  loadTemplate,
  saveTemplate,
  printStageTemplate,
  sendToLocalPrinter,
  shouldUseBitmapPrint,
  uint8ArrayToBase64,
  getPreferredPrinter,
  setPreferredPrinter,
  makeReceiveBarcode,
  parseReceiveCrateIndex,
  deriveMaterialCodeFromItem,
  getStageVariables,
  printStageTemplatesBatch,
};
