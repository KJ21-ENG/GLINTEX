// Coning sticker run: which batch barcodes to print, how many copies, and in what order they
// fill the sheets. Pure functions so the dialog and the tests share one rule.

export const DEFAULT_SPARE = 2;
export const PENDING_STATUSES = ['not_printed', 'changed'];
const SHIFT_ORDER = { Day: 0, Night: 1, '': 2 };

export const isPending = (row) => PENDING_STATUSES.includes(row.status);

// New barcode: one per issued crate plus spares. Batch that grew after printing: only the new
// crates. Already printed: one, for a lost or torn sticker.
export const suggestedCopies = (row, spare = DEFAULT_SPARE) => {
  if (row.status === 'not_printed') return Math.max(1, Number(row.crates || 0) + Number(spare || 0));
  if (row.status === 'changed') return Math.max(1, Number(row.crates || 0) - Number(row.printedCrates || 0));
  return 1;
};

// Chronological shifts (12th Night before 13th Day), then worker, so each worker's stickers sit together.
export const compareRunRows = (a, b) => (
  String(a.date).localeCompare(String(b.date))
  || (SHIFT_ORDER[a.shift] ?? 2) - (SHIFT_ORDER[b.shift] ?? 2)
  || String(a.operatorName).localeCompare(String(b.operatorName))
  || String(a.machineName).localeCompare(String(b.machineName))
  || String(a.barcode).localeCompare(String(b.barcode))
);

export const shiftGroupKey = (row) => `${row.date}|${row.shift || ''}`;

export const stickerData = (row) => ({
  barcode: row.barcode,
  lotNo: row.lotNo,
  date: row.date,
  shift: row.shift || 'No shift',
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

// Sticker slots in print order. `null` is a blank slot: the used part of the first sheet,
// and the rest of a sheet before the next shift starts when shifts go on separate sheets.
export const buildStickerSlots = (rows, { copiesOf, startAt = 1, perPage = 21, newSheetPerShift = true } = {}) => {
  const slots = [];
  const skip = Math.max(0, Math.min(perPage - 1, Math.round(Number(startAt) || 1) - 1));
  for (let i = 0; i < skip; i += 1) slots.push(null);
  let lastGroup = null;
  for (const row of [...rows].sort(compareRunRows)) {
    const group = shiftGroupKey(row);
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
