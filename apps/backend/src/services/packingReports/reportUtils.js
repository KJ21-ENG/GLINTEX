export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function clampLimit(value, fallback = DEFAULT_LIMIT) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw reportInputError('limit must be a positive integer');
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

export function normalizeString(value, maxLength = 200) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

export function parseCsv(value) {
  if (Array.isArray(value)) return value.flatMap(parseCsv);
  return normalizeString(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseDateOnly(value, fieldName = 'date') {
  const raw = normalizeString(value, 40);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(date.getTime())) {
    throw reportInputError(`${fieldName} must use YYYY-MM-DD`);
  }
  return date;
}

export function buildDateWhere(params = {}, field = 'createdAt') {
  const from = parseDateOnly(params.dateFrom || params.from || params.start, 'dateFrom');
  const to = parseDateOnly(params.dateTo || params.to || params.end, 'dateTo');
  if (from && to && from > to) throw reportInputError('dateFrom cannot be after dateTo');
  if (!from && !to) return {};
  const range = {};
  if (from) range.gte = from;
  if (to) {
    const end = new Date(to);
    end.setUTCDate(end.getUTCDate() + 1);
    range.lt = end;
  }
  return { [field]: range };
}

export function encodeCursor(row) {
  if (!row?.createdAt || !row?.id) return null;
  return Buffer.from(JSON.stringify({
    createdAt: new Date(row.createdAt).toISOString(),
    id: String(row.id),
  }), 'utf8').toString('base64url');
}

export function decodeCursor(value) {
  const raw = normalizeString(value, 500);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!parsed?.createdAt || !parsed?.id) throw new Error('invalid cursor');
    const date = new Date(parsed.createdAt);
    if (Number.isNaN(date.getTime())) throw new Error('invalid cursor date');
    return { createdAt: date, id: String(parsed.id) };
  } catch {
    throw reportInputError('cursor is invalid');
  }
}

export function buildCursorWhere(cursor, order = 'desc') {
  if (!cursor) return {};
  const comparator = order === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { createdAt: { [comparator]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [comparator]: cursor.id } },
    ],
  };
}

export function andWhere(...clauses) {
  const filtered = clauses.filter((clause) => clause && Object.keys(clause).length);
  if (!filtered.length) return {};
  if (filtered.length === 1) return filtered[0];
  return { AND: filtered };
}

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

export function sumBy(rows, selector) {
  return round((rows || []).reduce((sum, row) => sum + toNumber(selector(row)), 0));
}

export function countBy(rows, selector) {
  const counts = {};
  for (const row of rows || []) {
    const key = String(selector(row) || 'UNKNOWN');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function jsonValue(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function reportInputError(message, details = null) {
  const error = new Error(message);
  error.code = 'invalid_report_request';
  error.details = details;
  return error;
}

export function serializePage(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}

export function isEnumValue(value, values, fieldName) {
  const normalized = normalizeString(value).toUpperCase();
  if (!normalized) return null;
  if (!values.includes(normalized)) throw reportInputError(`${fieldName} contains an unsupported value`);
  return normalized;
}

export function pickEnumValues(value, values, fieldName) {
  const requested = parseCsv(value).map((entry) => entry.toUpperCase());
  if (!requested.length) return null;
  const invalid = requested.find((entry) => !values.includes(entry));
  if (invalid) throw reportInputError(`${fieldName} contains an unsupported value: ${invalid}`);
  return Array.from(new Set(requested));
}
