const AGENT_RECORD_DATE_TIME_ZONE = 'Asia/Kolkata';
const AGENT_RECORD_DATE_OFFSET = '+05:30';

function normalizeIsoDate(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function nextIsoDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function normalizeAgentDateBasis(value) {
  const normalized = String(value || 'business').trim().toLowerCase();
  return ['business', 'record'].includes(normalized) ? normalized : null;
}

export function buildRecordDateWhere({ dateFrom, dateTo } = {}) {
  const from = normalizeIsoDate(dateFrom);
  const to = normalizeIsoDate(dateTo);
  if (!from && !to) return null;

  const where = {};
  if (from) where.gte = new Date(`${from}T00:00:00${AGENT_RECORD_DATE_OFFSET}`);
  if (to) where.lt = new Date(`${nextIsoDate(to)}T00:00:00${AGENT_RECORD_DATE_OFFSET}`);
  return { createdAt: where };
}

export function formatAgentRecordDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AGENT_RECORD_DATE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis } = {}) {
  const basis = normalizeAgentDateBasis(dateBasis) || 'business';
  return {
    basis,
    field: basis === 'record' ? 'createdAt' : 'date',
    timeZone: basis === 'record' ? AGENT_RECORD_DATE_TIME_ZONE : null,
    dateFrom: normalizeIsoDate(dateFrom),
    dateTo: normalizeIsoDate(dateTo),
  };
}
