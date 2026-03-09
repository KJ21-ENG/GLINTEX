export const MAX_PRODUCTION_DAILY_EXPORT_DAYS = 7;

export function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [yearRaw, monthRaw, dayRaw] = raw.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatDateOnly(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getInclusiveDayCount(fromDate, toDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
}

export function enumerateDatesInclusive(fromDate, toDate) {
  const dates = [];
  const current = new Date(fromDate.getTime());
  while (current.getTime() <= toDate.getTime()) {
    dates.push(formatDateOnly(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function validateProductionDailyExportRequest({ process, from, to }) {
  const normalizedProcess = String(process || '').trim().toLowerCase();
  const validProcesses = ['cutter', 'holo', 'coning'];

  if (!normalizedProcess || !from || !to) {
    return { ok: false, error: 'process, from, and to are required' };
  }

  if (normalizedProcess === 'all' || !validProcesses.includes(normalizedProcess)) {
    return { ok: false, error: `Invalid process. Must be one of: ${validProcesses.join(', ')}` };
  }

  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate) {
    return { ok: false, error: 'from and to must be valid YYYY-MM-DD dates' };
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: 'from date cannot be later than to date' };
  }

  const totalDays = getInclusiveDayCount(fromDate, toDate);
  if (totalDays > MAX_PRODUCTION_DAILY_EXPORT_DAYS) {
    return {
      ok: false,
      error: `Daily production export is limited to ${MAX_PRODUCTION_DAILY_EXPORT_DAYS} days at a time`,
    };
  }

  return {
    ok: true,
    process: normalizedProcess,
    fromDate,
    toDate,
    totalDays,
  };
}

export async function mapWithConcurrency(items, limit, worker) {
  const normalizedLimit = Math.max(1, Math.floor(limit || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({
    length: Math.min(normalizedLimit, items.length),
  }, () => runWorker());

  await Promise.all(workers);
  return results;
}
