import { actorCreateFields, actorUpdateFields } from '../packing/common.js';
import { serialize } from '../packing/serialization.js';
import { badRequest, conflict } from '../packing/errors.js';

export const DISPATCH_SOURCE_TYPES = Object.freeze({
  INBOUND: 'INBOUND',
  CUTTER: 'CUTTER',
  HOLO: 'HOLO',
  PACKED: 'PACKED',
});

export const DISPATCH_EVENT_TYPES = Object.freeze({
  CHALLAN_CREATED: 'CHALLAN_CREATED',
  CHALLAN_VOIDED: 'CHALLAN_VOIDED',
  LINE_CORRECTED: 'LINE_CORRECTED',
  LINE_RETURNED: 'LINE_RETURNED',
  RETURN_REVERSED: 'RETURN_REVERSED',
  DISPATCH_EVENT_REVERSED: 'DISPATCH_EVENT_REVERSED',
});

export const DISPATCH_CHALLAN_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  VOIDED: 'VOIDED',
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED',
  RETURNED: 'RETURNED',
});

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const WEIGHT_EPSILON = 0.001;

export { actorCreateFields, actorUpdateFields, serialize };

export function normalizeSourceType(value, { allowLegacy = false } = {}) {
  const sourceType = String(value || '').trim().toUpperCase();
  if (Object.values(DISPATCH_SOURCE_TYPES).includes(sourceType)) return sourceType;
  if (allowLegacy && sourceType === 'CONING') return sourceType;
  throw badRequest('invalid_source_type', 'Dispatch source type is invalid.', {
    sourceType,
    allowed: Object.values(DISPATCH_SOURCE_TYPES),
  });
}

export function requiredId(value, field = 'id', max = 200) {
  const id = String(value || '').trim();
  if (!id) throw badRequest(`${field}_required`, `${field} is required.`);
  if (id.length > max) throw badRequest(`${field}_too_long`, `${field} is too long.`);
  return id;
}

export function optionalString(value, max = 1000) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw badRequest('text_too_long', 'A text field is too long.');
  return text;
}

export function requireReason(value, field = 'reason') {
  const reason = requiredId(value, field, 2000);
  return reason;
}

export function parsePositiveNumber(value, field, { allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') {
    throw badRequest(`${field}_required`, `${field} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw badRequest(`invalid_${field}`, `${field} must be ${allowZero ? 'a non-negative' : 'a positive'} number.`);
  }
  return number;
}

export function parseOptionalPositiveInt(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw badRequest(`invalid_${field}`, `${field} must be a positive integer.`);
  return number;
}

export function parseOptionalNonNegativeInt(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw badRequest(`invalid_${field}`, `${field} must be a non-negative integer.`);
  return number;
}

export function parseDateOnly(value, field = 'businessDate') {
  const raw = String(value || '').trim();
  if (!raw) throw badRequest(`${field}_required`, `${field} is required.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest(`invalid_${field}`, `${field} must use YYYY-MM-DD.`);
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw badRequest(`invalid_${field}`, `${field} is not a valid calendar date.`);
  }
  return date;
}

export function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function fiscalYearLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('invalid_business_date', 'The business date is invalid.');
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

export async function allocateDispatchChallanNumber(tx, businessDate) {
  const fiscalYear = fiscalYearLabel(businessDate);
  const id = `dispatch_seq_${fiscalYear.replace('-', '_')}`;
  const sequence = await tx.dispatchSequence.upsert({
    where: { id },
    update: { nextValue: { increment: 1 } },
    create: { id, nextValue: 2 },
  });
  const value = Number(sequence.nextValue) - 1;
  if (!Number.isInteger(value) || value < 1) throw conflict('dispatch_sequence_invalid', 'The Dispatch challan sequence is invalid.');
  return `DC/${fiscalYear}/${String(value).padStart(3, '0')}`;
}

export function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!decoded?.createdAt || !decoded?.id) return null;
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: String(decoded.id) };
  } catch {
    return null;
  }
}

export function cursorWhere(raw, order = 'desc') {
  const cursor = typeof raw === 'string' ? decodeCursor(raw) : raw;
  if (!cursor) return null;
  const comparison = order === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { createdAt: { [comparison]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [comparison]: cursor.id } },
    ],
  };
}

export function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(number)));
}

export function customerSnapshot(customer) {
  return {
    id: customer?.id || null,
    name: customer?.name || null,
    phone: customer?.phone || null,
    address: customer?.address || null,
    isActive: customer?.isActive !== false,
  };
}

export async function companySnapshot(tx) {
  const settings = await tx.settings.findUnique({
    where: { id: 1 },
    select: { brandPrimary: true, brandGold: true, logoDataUrl: true, faviconDataUrl: true, challanFromName: true, challanFromAddress: true, challanFromMobile: true },
  });
  return {
    name: settings?.challanFromName || 'GLINTEX',
    address: settings?.challanFromAddress || null,
    phone: settings?.challanFromMobile || null,
    brandPrimary: settings?.brandPrimary || null,
    brandGold: settings?.brandGold || null,
    logoDataUrl: settings?.logoDataUrl || null,
    faviconDataUrl: settings?.faviconDataUrl || null,
  };
}

export function safeSnapshot(value) {
  return serialize(value || {});
}

export function assertWeightConservation(actual, expected, field = 'netWeightKg') {
  if (Math.abs(Number(actual) - Number(expected)) > WEIGHT_EPSILON) {
    throw badRequest('weight_conservation_failed', `${field} does not match the authoritative source weight.`, {
      expected: Number(expected),
      actual: Number(actual),
    });
  }
}

export function transactionClient(tx) {
  if (typeof tx?.$transaction === 'function') return tx;
  return new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction') return (work) => work(target);
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function lockKey(sourceType, sourceId) {
  return `${String(sourceType)}:${String(sourceId)}`;
}

export function sortByLockKey(rows) {
  return [...rows].sort((a, b) => lockKey(a.sourceType, a.sourceId).localeCompare(lockKey(b.sourceType, b.sourceId)));
}
