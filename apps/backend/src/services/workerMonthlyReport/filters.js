export class ReportInputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextMonth(month, offset = 1) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function validateFilters(input = {}, now = new Date()) {
  const today = businessDate(now);
  const month = input.month === undefined ? nextMonth(today.slice(0, 7), -1) : input.month;
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`) || month < '0001-01') {
    throw new ReportInputError('month must be a valid YYYY-MM');
  }
  const process = input.process === undefined ? 'coning' : input.process;
  if (process !== 'coning') throw new ReportInputError('Only coning worker monthly reports are supported');
  if (month > today.slice(0, 7)) throw new ReportInputError('Future months are not supported');
  const workerId = input.workerId === undefined ? 'all' : input.workerId;
  if (typeof workerId !== 'string' || !workerId.trim() || workerId !== workerId.trim() || workerId.length > 200) {
    throw new ReportInputError('workerId must be a worker ID or all');
  }
  const endExclusive = `${nextMonth(month)}-01`;
  const current = month === today.slice(0, 7);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    month, process, workerId,
    period: { month, startInclusive: `${month}-01`, endExclusive,
      effectiveEndExclusive: current ? tomorrow.toISOString().slice(0, 10) : endExclusive,
      cutoff: current ? today : new Date(new Date(`${endExclusive}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10),
      monthToDate: current, timeZone: 'Asia/Kolkata' },
    generatedAt: now.toISOString(),
  };
}
