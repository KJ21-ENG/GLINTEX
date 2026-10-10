// Placeholder substitution: {{key}} and @key, aliases, date and weight formatting.
import { formatDateDDMMYYYY } from '../formatting.js';

const PLACEHOLDER_ALIASES = {
  barcodeNumber: 'barcode',
  receiveBarcode: 'barcode',
  issueBarcodeNumber: 'issueBarcode',
};

const DATE_KEYS = new Set(['date', 'inboundDate']);
const WEIGHT_KEYS = new Set([
  'weight', 'totalWeight', 'netWeight', 'grossWeight', 'tareWeight',
  'rollWeight', 'coneWeight', 'yarnKg', 'metallicBobbinsWeight',
  'perConeTargetG', 'issuedBobbinWeight',
]);

export const PLACEHOLDER_PATTERN = /(\{\{\s*([\w.]+)\s*\}\})|(@([\w.]+))/g;

const resolvePlaceholderValue = (data, key) => {
  if (!key || !data) return { found: false, value: undefined };
  if (Object.prototype.hasOwnProperty.call(data, key)) return { found: true, value: data[key] };
  const aliasKey = PLACEHOLDER_ALIASES[key];
  if (aliasKey && Object.prototype.hasOwnProperty.call(data, aliasKey)) return { found: true, value: data[aliasKey] };
  return { found: false, value: undefined };
};

export const formatPlaceholderValue = (key, val) => {
  if (val === null || val === undefined) return '';
  if (DATE_KEYS.has(key) && val) return formatDateDDMMYYYY(val) || String(val);
  if (WEIGHT_KEYS.has(key)) {
    const num = Number(val);
    return Number.isFinite(num) ? num.toFixed(3) : String(val);
  }
  return String(val);
};

// Unknown placeholders are left as written so a designer sees a typo on the label.
export const substitutePlaceholders = (value = '', data = {}) => {
  if (!value || typeof value !== 'string') return value;
  return value.replace(PLACEHOLDER_PATTERN, (match, p1, p2, p3, p4) => {
    const key = p2 || p4;
    const resolved = resolvePlaceholderValue(data, key);
    return resolved.found ? formatPlaceholderValue(key, resolved.value) : match;
  });
};

export const listPlaceholders = (value = '') => {
  const keys = [];
  if (typeof value !== 'string') return keys;
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) keys.push(match[2] || match[4]);
  return keys;
};
