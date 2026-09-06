import { totals } from './quantities.js';

// The worker view groups production by yarn, across machines and quality variants.
// Detailed quality/lineage remains available in office references.
export function workerCalendar(statement, month) {
  const yarns = new Map();
  const days = new Map();
  for (const row of statement.rows) {
    const yarn = row.quality.yarn;
    const key = JSON.stringify([yarn.state, yarn.values.map(value => value.id).sort(), yarn.label]);
    if (!yarns.has(key)) yarns.set(key, { key, label: yarn.label, rows: [] });
    yarns.get(key).rows.push(row);
    if (!days.has(row.date)) days.set(row.date, new Map());
    const day = days.get(row.date);
    if (!day.has(key)) day.set(key, []);
    day.get(key).push(row);
  }
  const columns = [...yarns.values()].sort((a, b) => a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key));
  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = monthNumber === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(monthNumber) ? 30 : 31;
  return {
    columns: columns.map(({ key, label, rows }) => ({ key, label, totals: totals(rows) })),
    days: Array.from({ length: dayCount }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      const day = days.get(date);
      return { date, cells: columns.map(column => day?.has(column.key) ? totals(day.get(column.key)) : null),
        totals: day ? totals([...day.values()].flat()) : null };
    }),
    workedDays: days.size,
    totals: totals(statement.rows),
  };
}

export function calendarWeight(total) {
  if (!total) return '-';
  if (total.unknownWeightRows === total.rowCount) return '?';
  return `${total.netKg.toFixed(3)}${total.weightComplete ? '' : '*'}`;
}
export function calendarCones(total) {
  if (!total) return '-';
  if (total.unknownConeRows === total.rowCount) return '?';
  return `${total.cones}${total.conesComplete ? '' : '*'}`;
}

export const calendarDate = date => date.split('-').reverse().join('/');
