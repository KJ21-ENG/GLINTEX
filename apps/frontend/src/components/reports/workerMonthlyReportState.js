export function calendarMonths(now = new Date()) {
  const current = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const date = new Date(`${current}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return { current, previous: date.toISOString().slice(0, 7) };
}
export function readMonthlyFilters(search, now) {
  const params = new URLSearchParams(search);
  return {
    month: params.get("wmMonth") ?? calendarMonths(now).previous,
    process: params.get("wmProcess") ?? "coning",
    workerId: params.get("wmWorker") ?? "all",
  };
}
export function filterError(filters, now) {
  if (filters.process !== "coning")
    return "This process is not supported. Cutter and Holo are coming soon.";
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month) ||
    filters.month < "0001-01"
  )
    return "Select a valid month and year.";
  if (filters.month > calendarMonths(now).current)
    return "Future months are not supported.";
  if (!filters.workerId.trim() || filters.workerId.length > 200)
    return "Select a valid worker.";
  return null;
}
export const filterKey = (filters) =>
  JSON.stringify([filters.month, filters.process, filters.workerId]);
export function monthlySearch(search, filters) {
  const params = new URLSearchParams(search);
  params.set("reportTab", "worker-monthly");
  params.set("wmMonth", filters.month);
  params.set("wmProcess", filters.process);
  params.set("wmWorker", filters.workerId);
  return `?${params}`;
}
// Invalidate synchronously, including during downloads; a late response cannot
// restore a preview or save a file belonging to a previous selection.
export function createRequestGate() {
  let generation = 0;
  return {
    invalidate: () => ++generation,
    start: () => ++generation,
    current: (token) => token === generation,
  };
}
export function kgLabel(totals) {
  const value = Number(totals.netKg).toFixed(3);
  return totals.weightComplete
    ? `${value} kg`
    : `${value} kg known subtotal (incomplete; ${totals.unknownWeightRows} unknown)`;
}
