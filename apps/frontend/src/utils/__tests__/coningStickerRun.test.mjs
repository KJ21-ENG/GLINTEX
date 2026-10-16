import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStickerSlots, compareRunRows, morningRange, sheetCount, suggestedCopies } from '../coningStickerRun.js';

const row = (o) => ({ id: o.barcode, crates: 5, printedCrates: 0, status: 'not_printed', date: '2026-10-13', shift: 'Day', operatorName: 'A', machineName: 'CN-1', ...o });

test('copies are crates plus spare for a new barcode, only new crates after growth, one for a reprint', () => {
  assert.equal(suggestedCopies(row({ barcode: 'ICO-1' }), 2), 7);
  assert.equal(suggestedCopies(row({ barcode: 'ICO-1', status: 'changed', crates: 6, printedCrates: 4 }), 2), 2);
  assert.equal(suggestedCopies(row({ barcode: 'ICO-1', status: 'changed', crates: 4, printedCrates: 4 }), 2), 1);
  assert.equal(suggestedCopies(row({ barcode: 'ICO-1', status: 'printed' }), 2), 1);
});

test('last night prints before this morning, worker by worker, each shift on a fresh sheet', () => {
  const rows = [
    row({ barcode: 'ICO-3', operatorName: 'ZED', shift: 'Day' }),
    row({ barcode: 'ICO-1', operatorName: 'MOHAN', date: '2026-10-12', shift: 'Night', crates: 1 }),
    row({ barcode: 'ICO-2', operatorName: 'ANIL', shift: 'Day', crates: 1 }),
  ];
  assert.deepEqual([...rows].sort(compareRunRows).map((r) => r.barcode), ['ICO-1', 'ICO-2', 'ICO-3']);
  const slots = buildStickerSlots(rows, { copiesOf: (r) => r.crates, startAt: 3, perPage: 21 });
  assert.equal(slots[0], null);
  assert.equal(slots[2].barcode, 'ICO-1');
  assert.ok(slots.slice(3, 21).every((s) => s === null), 'night sheet is padded out');
  assert.equal(slots[21].barcode, 'ICO-2');
  assert.equal(slots.filter((s) => s?.barcode === 'ICO-3').length, 5);
  assert.equal(sheetCount(slots, 21), 2);
  const packed = buildStickerSlots(rows, { copiesOf: (r) => r.crates, perPage: 21, newSheetPerShift: false });
  assert.equal(packed.length, 7);
  assert.equal(sheetCount([null, null], 21), 0);
});

test('morning range is yesterday Night to today Day in local time', () => {
  assert.deepEqual(morningRange(new Date(2026, 9, 13, 0, 30)), { dateFrom: '2026-10-12', dateTo: '2026-10-13', fromShifts: ['Night'], toShifts: ['Day'] });
});

test('carried-over batches print first on their own sheet, marked C/O, with copies from what is left', async () => {
  const { selectedByDefault, stickerData } = await import('../coningStickerRun.js');
  const carry = row({ barcode: 'ICO-9', date: '2026-10-11', shift: 'Night', carryOver: true, status: 'carry_over', estimatedContainers: 2, crates: 6 });
  const stale = { ...carry, barcode: 'ICO-8', stale: true };
  const today = row({ barcode: 'ICO-10', crates: 1 });
  assert.deepEqual([today, carry].sort(compareRunRows).map((r) => r.barcode), ['ICO-9', 'ICO-10']);
  assert.equal(suggestedCopies(carry), 3, 'two containers left plus one spare');
  assert.equal(suggestedCopies({ ...carry, estimatedContainers: null }, 2), 8, 'nothing received yet: as a new barcode');
  assert.equal(selectedByDefault(carry), true);
  assert.equal(selectedByDefault(stale), false, 'stale carry-overs wait for a check');
  assert.equal(selectedByDefault({ ...carry, status: 'carry_printed' }), false);
  assert.equal(stickerData(carry).shift, 'Night C/O');
  assert.equal(stickerData(today).shift, 'Day');
});

// The morning run: last night (12th) and this morning (13th).
const MORNING = { dateFrom: '2026-10-12', dateTo: '2026-10-13', fromShifts: ['Night'], toShifts: ['Day'] };
const carried = (o) => row({ date: '2026-10-10', carryOver: true, status: 'carry_over', estimatedContainers: 1, ...o });
const order = (rows, range = MORNING) => buildStickerSlots(rows, { copiesOf: () => 1, perPage: 21, newSheetPerShift: false, range })
  .map((s) => s.barcode);

test('a carried-over batch prints in its worker\'s shift group, before his new stickers, still marked C/O', async () => {
  const { stickerData } = await import('../coningStickerRun.js');
  const rows = [
    row({ barcode: 'ICO-21', operatorName: 'DEVCHAND', shift: 'Day' }),
    row({ barcode: 'ICO-20', operatorName: 'ANIL', shift: 'Day' }),
    carried({ barcode: 'ICO-5', operatorName: 'DEVCHAND', shift: 'Day' }),
  ];
  assert.deepEqual(order(rows), ['ICO-20', 'ICO-5', 'ICO-21']);
  const slots = buildStickerSlots(rows, { copiesOf: () => 1, perPage: 21, range: MORNING });
  assert.equal(slots.length, 3, 'one shift, one sheet: no carried-over sheet');
  assert.equal(stickerData(rows[2]).shift, 'Day C/O');
  assert.equal(stickerData(rows[2]).date, '2026-10-10', 'it keeps its own date');
});

test('a night worker\'s carried-over batch joins his night stickers, not the morning group', () => {
  const rows = [
    row({ barcode: 'ICO-30', operatorName: 'RAMESH', date: '2026-10-12', shift: 'Night' }),
    row({ barcode: 'ICO-31', operatorName: 'ANIL', shift: 'Day' }),
    carried({ barcode: 'ICO-6', operatorName: 'RAMESH', shift: 'Night' }),
  ];
  const slots = buildStickerSlots(rows, { copiesOf: () => 1, perPage: 21, range: MORNING });
  assert.deepEqual(slots.slice(0, 2).map((s) => s.barcode), ['ICO-6', 'ICO-30']);
  assert.equal(slots[21].barcode, 'ICO-31', 'the day shift starts its own sheet');
});

test('a worker who changed shifts gets his carried-over batch where his new stickers are', () => {
  const rows = [
    row({ barcode: 'ICO-40', operatorName: 'DEVCHAND', shift: 'Day' }),
    row({ barcode: 'ICO-41', operatorName: 'MOHAN', date: '2026-10-12', shift: 'Night' }),
    carried({ barcode: 'ICO-7', operatorName: 'DEVCHAND', shift: 'Night' }),
  ];
  assert.deepEqual(order(rows), ['ICO-41', 'ICO-7', 'ICO-40']);
});

test('with nothing new, a carried-over batch goes to its own shift in the run, else the last shift', () => {
  const night = carried({ barcode: 'ICO-8', operatorName: 'RAMESH', shift: 'Night' });
  const day = carried({ barcode: 'ICO-9', operatorName: 'ZED', shift: 'Day' });
  const blank = carried({ barcode: 'ICO-10', operatorName: 'YASH', shift: '' });
  const fresh = row({ barcode: 'ICO-50', operatorName: 'ANIL', shift: 'Day' });
  const slots = buildStickerSlots([fresh, night, day, blank], { copiesOf: () => 1, perPage: 21, range: MORNING });
  assert.equal(slots[0].barcode, 'ICO-8', 'Ramesh alone in the night group');
  assert.deepEqual(slots.slice(21).map((s) => s.barcode), ['ICO-50', 'ICO-10', 'ICO-9'],
    'the day group: own shift for ZED, the last shift for a batch without one');
  const dayOnly = { dateFrom: '2026-10-13', dateTo: '2026-10-13', fromShifts: ['Day'], toShifts: ['Day'] };
  assert.deepEqual(order([night, fresh], dayOnly), ['ICO-50', 'ICO-8'], 'a night batch in a day-only run: the last shift');
  const days = { dateFrom: '2026-10-10', dateTo: '2026-10-13', fromShifts: ['Day'], toShifts: ['Day'] };
  const placed = buildStickerSlots([night], { copiesOf: () => 1, perPage: 21, range: days });
  assert.deepEqual(placed.map((s) => s.barcode), ['ICO-8']);
});
