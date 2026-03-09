/**
 * Formatting utilities for GLINTEX Inventory
 */

export function formatKg(n) {
  if (n == null || Number.isNaN(n)) return "0.000";
  return Number(n).toFixed(3);
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function yyyymmdd(dateISO) {
  return dateISO.replaceAll("-", "");
}

export function parseDateOnlyUTC(value) {
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

export function getInclusiveUtcDayRange(from, to) {
  const fromDate = parseDateOnlyUTC(from);
  const toDate = parseDateOnlyUTC(to);
  if (!fromDate || !toDate || toDate.getTime() < fromDate.getTime()) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
}

// Parse a date string in common formats and return ISO (YYYY-MM-DD) or empty string
export function parseDateToISO(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const s = dateStr.trim();
  // Already ISO-like: 2025-10-15 or 2025/10/15
  const isoMatch = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2];
    const dd = isoMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{2})[-\/]?(\d{2})[-\/]?(\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1];
    const mm = dmyMatch[2];
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // Fallback: try Date parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

// Format a date string (any supported input) to DD/MM/YYYY for display; returns original if cannot parse
export function formatDateDDMMYYYY(dateStr) {
  const iso = parseDateToISO(dateStr);
  if (!iso) return dateStr || '';
  const [yyyy, mm, dd] = iso.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

// Format a datetime value to "HH:MM DD/MM/YYYY" for display
export function formatDateTimeDDMMYYYY(dateTimeValue) {
  if (!dateTimeValue) return '—';
  const date = new Date(dateTimeValue);
  if (Number.isNaN(date.getTime())) return dateTimeValue;
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${hh}:${min} ${dd}/${mm}/${yyyy}`;
}
