// Coning sticker run: which batch barcodes to print, how many copies, and in what order they
// fill the sheets. Pure functions so the dialog and the tests share one rule.

export const DEFAULT_SPARE = 2;
export const PENDING_STATUSES = ['not_printed', 'changed', 'carry_over'];
const SHIFT_ORDER = { Day: 0, Night: 1, '': 2 };

export const isPending = (row) => PENDING_STATUSES.includes(row.status);

// New barcode: one per issued crate plus spares. Batch that grew after printing: only the new
// crates. Carried over: the containers its remaining material should fill, plus one spare.
// Already printed: one, for a lost or torn sticker.
export const suggestedCopies = (row, spare = DEFAULT_SPARE) => {
  if (row.status === 'carry_over') return row.estimatedContainers ? row.estimatedContainers + 1 : Math.max(1, Number(row.crates || 0) + Number(spare || 0));
  if (row.status === 'not_printed') return Math.max(1, Number(row.crates || 0) + Number(spare || 0));
  if (row.status === 'changed') return Math.max(1, Number(row.crates || 0) - Number(row.printedCrates || 0));
  return 1;
};

// Order of the list on screen: carried-over batches first (their own section), then
// chronological shifts (12th Night before 13th Day), then worker. Within one worker of a
// printed shift group it also puts the carried-over batches first, oldest first.
export const compareRunRows = (a, b) => (
  Number(Boolean(b.carryOver)) - Number(Boolean(a.carryOver))
  || String(a.date).localeCompare(String(b.date))
  || (SHIFT_ORDER[a.shift] ?? 2) - (SHIFT_ORDER[b.shift] ?? 2)
  || String(a.operatorName).localeCompare(String(b.operatorName))
  || String(a.machineName).localeCompare(String(b.machineName))
  || String(a.barcode).localeCompare(String(b.barcode))
);

export const shiftGroupKey = (row) => (row.carryOver ? 'carry' : `${row.date}|${row.shift || ''}`);

// Printed groups are shifts only. A carried-over batch is printed in a shift group of the run,
// under its worker, next to that worker's other stickers, so the sticker manager hands out one
// bunch per worker per shift. Its sticker still says C/O and keeps its own date.
const SHIFTS = ['Day', 'Night'];
const groupOf = (date, shift) => ({ date, shift: shift || '' });
const groupKey = (group) => `${group.date}|${group.shift}`;
const compareGroups = (a, b) => (
  String(a.date).localeCompare(String(b.date)) || (SHIFT_ORDER[a.shift] ?? 2) - (SHIFT_ORDER[b.shift] ?? 2)
);
const latestOf = (groups) => groups.reduce((best, group) => (best === null || compareGroups(group, best) > 0 ? group : best), null);
const shiftsOf = (list) => SHIFTS.filter((shift) => (list || []).some((entry) => String(entry).toLowerCase() === shift.toLowerCase()));
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

// The latest shift of the run that is this shift: on the to date, the day before it, or the
// from date. Nothing when the run does not hold that shift.
const rangeShiftGroup = (range, shift) => {
  if (!range?.dateFrom || !range?.dateTo || !SHIFTS.includes(shift)) return null;
  const from = shiftsOf(range.fromShifts);
  const to = shiftsOf(range.toShifts);
  if (range.dateFrom === range.dateTo) return from.includes(shift) || to.includes(shift) ? groupOf(range.dateTo, shift) : null;
  if (to.includes(shift)) return groupOf(range.dateTo, shift);
  const before = dayBefore(range.dateTo);
  if (before > range.dateFrom) return groupOf(before, shift);
  return from.includes(shift) ? groupOf(range.dateFrom, shift) : null;
};

// The last shift of the run: the latest shift of its to date.
// A carried-over batch belongs to the run when the run covers its own shift: a night batch's
// leftover goods are finished on the next night, so its C/O stickers go out with the morning
// set (yesterday Night + today Day), not in a Day-only print.
export const carryShiftInRun = (row, range) => !range || !SHIFTS.includes(row.shift) || rangeShiftGroup(range, row.shift) !== null;

// Ticked by default: everything still needing a sticker, carried-over batches included, 'Check'
// ones too (older than 2 days), as long as the run covers the batch's own shift.
export const selectedByDefault = (row, range) => isPending(row) && (!row.carryOver || carryShiftInRun(row, range));

const rangeLastGroup = (range) => {
  if (!range?.dateTo) return null;
  const shifts = shiftsOf(range.dateFrom === range.dateTo ? [...(range.fromShifts || []), ...(range.toShifts || [])] : range.toShifts);
  return shifts.length ? groupOf(range.dateTo, shifts[shifts.length - 1]) : null;
};

// The shift group each row prints in. A carried-over batch joins the group where its worker
// has new stickers in this print (the latest when several); without any, the run's group of
// the batch's own shift; otherwise the run's last shift.
export const printGroupOf = (rows, range) => {
  const fresh = rows.filter((row) => !row.carryOver);
  const byWorker = new Map();
  for (const row of fresh) {
    const worker = row.operatorName || '';
    byWorker.set(worker, [...(byWorker.get(worker) || []), groupOf(row.date, row.shift)]);
  }
  const lastFresh = latestOf(fresh.map((row) => groupOf(row.date, row.shift)));
  return (row) => {
    if (!row.carryOver) return groupOf(row.date, row.shift);
    return latestOf(byWorker.get(row.operatorName || '') || [])
      || rangeShiftGroup(range, row.shift)
      || rangeLastGroup(range)
      || lastFresh
      || groupOf(row.date, row.shift);
  };
};

// Rows in print order with their shift group: shifts in time order, then worker, then within a
// worker the carried-over batches first.
export const printOrder = (rows, range) => {
  const groupFor = printGroupOf(rows, range);
  return rows.map((row) => ({ row, group: groupFor(row) })).sort((a, b) => (
    compareGroups(a.group, b.group)
    || String(a.row.operatorName).localeCompare(String(b.row.operatorName))
    || compareRunRows(a.row, b.row)
  ));
};

export const stickerData = (row) => ({
  barcode: row.barcode,
  lotNo: row.lotNo,
  date: row.date,
  // C/O rides on the shift, which every coning issue design prints in its top band, so it
  // shows on saved designs and older apps without a new variable.
  shift: row.carryOver ? `${row.shift || 'No shift'} C/O` : (row.shift || 'No shift'),
  operatorName: row.operatorName,
  machineName: row.machineName,
  itemName: row.itemName,
  cut: row.cut,
  yarnName: row.yarnName,
  twist: row.twist,
  twistName: row.twist,
  coneType: row.coneType,
  wrapperName: row.wrapperName,
  rollType: row.rollType,
  crates: row.crates,
  rollCount: row.rollCount,
  totalRolls: row.rollCount,
  netWeight: row.netWeight,
  totalWeight: row.netWeight,
  grossWeight: null,
  tareWeight: null,
  expectedCones: row.expectedCones,
  perConeTargetG: row.perConeTargetG,
});

// Sticker slots in print order (`printOrder`; `range` is the run's dates and shifts). `null`
// is a blank slot: the used part of the first sheet, and the rest of a sheet before the next
// shift starts when shifts go on separate sheets.
export const buildStickerSlots = (rows, { copiesOf, startAt = 1, perPage = 21, newSheetPerShift = true, range = null } = {}) => {
  const slots = [];
  const skip = Math.max(0, Math.min(perPage - 1, Math.round(Number(startAt) || 1) - 1));
  for (let i = 0; i < skip; i += 1) slots.push(null);
  let lastGroup = null;
  for (const { row, group: place } of printOrder(rows, range)) {
    const group = groupKey(place);
    if (newSheetPerShift && lastGroup !== null && group !== lastGroup) {
      while (slots.length % perPage !== 0) slots.push(null);
    }
    lastGroup = group;
    const data = stickerData(row);
    const copies = Math.max(1, Math.round(Number(copiesOf(row)) || 1));
    for (let i = 0; i < copies; i += 1) slots.push(data);
  }
  return slots;
};

export const sheetCount = (slots, perPage = 21) => (slots.some(Boolean) ? Math.ceil(slots.length / perPage) : 0);

const pad = (n) => String(n).padStart(2, '0');
export const localISODate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Day-shift supervisor's stack: last night's batches plus this morning's.
export const morningRange = (now = new Date()) => {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return { dateFrom: localISODate(yesterday), dateTo: localISODate(now), fromShifts: ['Night'], toShifts: ['Day'] };
};
