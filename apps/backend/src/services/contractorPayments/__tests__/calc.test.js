import test from 'node:test';
import assert from 'node:assert/strict';

import {
  roundCurrency,
  roundKg,
  computeAmount,
  resolveNetKg,
  normalizeSide,
  isOpeningStockRow,
  isPurchasedRow,
  isWithinRange,
  isValidDateStr,
  rangesOverlap,
  rateApplies,
  matchRate,
  ratesConflict,
  adjustmentSignedAmount,
  computeTotals,
  summarizeLines,
} from '../calc.js';

test('roundCurrency rounds half up to 2 decimals', () => {
  assert.equal(roundCurrency(2.345), 2.35);
  assert.equal(roundCurrency(2.344), 2.34);
  assert.equal(roundCurrency(2.005), 2.01); // classic float trap
  assert.equal(roundCurrency(-2.005), -2.01);
  assert.equal(roundCurrency(0), 0);
});

test('roundKg keeps three decimals', () => {
  assert.equal(roundKg(1.23456), 1.235);
  assert.equal(roundKg(1.2344), 1.234);
});

test('computeAmount = round(netKg * ratePerKg, 2)', () => {
  assert.equal(computeAmount(10.5, 4.25), 44.63); // 44.625 -> 44.63
  assert.equal(computeAmount(3.333, 3), 10); // 9.999 -> 10.00
  assert.equal(computeAmount(0, 5), 0);
  assert.equal(computeAmount(null, 5), 0);
  assert.equal(computeAmount(5, undefined), 0);
});

test('resolveNetKg cutter: netWt then totalKg', () => {
  assert.equal(resolveNetKg('cutter', { netWt: 12.345, totalKg: 99 }), 12.345);
  assert.equal(resolveNetKg('cutter', { netWt: 0, totalKg: 8.5 }), 8.5);
  assert.equal(resolveNetKg('cutter', { netWt: null, totalKg: null }), null);
  assert.equal(resolveNetKg('cutter', { netWt: -3, totalKg: -1 }), null);
});

test('resolveNetKg holo: rollWeight then gross-tare', () => {
  assert.equal(resolveNetKg('holo', { rollWeight: 5.5 }), 5.5);
  assert.equal(resolveNetKg('holo', { rollWeight: null, grossWeight: 10, tareWeight: 2.5 }), 7.5);
  assert.equal(resolveNetKg('holo', { grossWeight: 2, tareWeight: 2 }), null); // zero
  assert.equal(resolveNetKg('holo', { grossWeight: 4 }), 4); // tare missing => treated as 0
});

test('resolveNetKg coning: netWeight then coneWeight then gross-tare', () => {
  assert.equal(resolveNetKg('coning', { netWeight: 3.21 }), 3.21);
  assert.equal(resolveNetKg('coning', { netWeight: null, coneWeight: 2.2 }), 2.2);
  assert.equal(resolveNetKg('coning', { coneWeight: 0, grossWeight: 9, tareWeight: 1 }), 8);
  assert.equal(resolveNetKg('coning', {}), null);
});

test('normalizeSide validates', () => {
  assert.equal(normalizeSide('single'), 'SINGLE');
  assert.equal(normalizeSide('BOTH'), 'BOTH');
  assert.equal(normalizeSide('nope'), null);
});

test('isOpeningStockRow detects markers', () => {
  assert.equal(isOpeningStockRow({ createdBy: 'opening' }), true);
  assert.equal(isOpeningStockRow({ createdBy: 'opening_bulk' }), true);
  assert.equal(isOpeningStockRow({ lotNo: 'OP-001' }), true);
  assert.equal(isOpeningStockRow({ createdBy: 'user', lotNo: 'L-1' }), false);
});

test('isValidDateStr rejects malformed and impossible calendar dates', () => {
  assert.equal(isValidDateStr('2026-07-11'), true);
  assert.equal(isValidDateStr('2026-02-29'), false); // not a leap year
  assert.equal(isValidDateStr('2024-02-29'), true); // leap year
  assert.equal(isValidDateStr('2026-13-01'), false);
  assert.equal(isValidDateStr('2026-07-45'), false);
  assert.equal(isValidDateStr('2026-7-1'), false); // must be zero-padded
  assert.equal(isValidDateStr('bad'), false);
  assert.equal(isValidDateStr(null), false);
});

test('isPurchasedRow detects cutter-purchase (non-production) rows', () => {
  assert.equal(isPurchasedRow({ createdBy: 'cutter_purchase' }), true);
  assert.equal(isPurchasedRow({ lotNo: 'CP-001' }), true);
  assert.equal(isPurchasedRow({ createdBy: 'user', lotNo: 'L-1' }), false);
  assert.equal(isPurchasedRow({ createdBy: 'opening' }), false); // opening handled separately
});

test('isWithinRange inclusive with open-ended to', () => {
  assert.equal(isWithinRange('2026-07-05', '2026-07-01', '2026-07-31'), true);
  assert.equal(isWithinRange('2026-07-01', '2026-07-01', '2026-07-31'), true);
  assert.equal(isWithinRange('2026-06-30', '2026-07-01', '2026-07-31'), false);
  assert.equal(isWithinRange('2026-09-01', '2026-07-01', null), true);
  assert.equal(isWithinRange('bad', '2026-07-01', null), false);
});

test('rangesOverlap handles open-ended bounds', () => {
  assert.equal(rangesOverlap('2026-01-01', '2026-06-30', '2026-06-01', '2026-12-31'), true);
  assert.equal(rangesOverlap('2026-01-01', '2026-05-31', '2026-06-01', '2026-12-31'), false);
  assert.equal(rangesOverlap('2026-01-01', null, '2030-01-01', null), true);
});

// ---- Rate matching ----

const HOLO_RATES = [
  { id: 'base', process: 'holo', yarnId: 'Y1', cutId: 'C1', twistId: null, ratePerKg: 10, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'twist', process: 'holo', yarnId: 'Y1', cutId: 'C1', twistId: 'T1', ratePerKg: 12, effectiveFrom: '2026-01-01', effectiveTo: null },
];

test('rateApplies requires all required keys to match', () => {
  assert.equal(rateApplies('holo', HOLO_RATES[0], { yarnId: 'Y1', cutId: 'C1' }, '2026-05-01'), true);
  assert.equal(rateApplies('holo', HOLO_RATES[0], { yarnId: 'Y2', cutId: 'C1' }, '2026-05-01'), false);
  assert.equal(rateApplies('holo', HOLO_RATES[0], { cutId: 'C1' }, '2026-05-01'), false); // missing yarn
});

test('matchRate picks most specific optional override', () => {
  const withTwist = matchRate('holo', HOLO_RATES, { yarnId: 'Y1', cutId: 'C1', twistId: 'T1' }, '2026-05-01');
  assert.equal(withTwist.rate.id, 'twist');
  const withoutTwist = matchRate('holo', HOLO_RATES, { yarnId: 'Y1', cutId: 'C1', twistId: 'T9' }, '2026-05-01');
  assert.equal(withoutTwist.rate.id, 'base'); // twist-specific does not match, falls back to wildcard
});

test('holo/coning Cut is an optional override: cut-less rates match any cut', () => {
  const yarnOnly = { id: 'yo', process: 'holo', yarnId: 'Y1', cutId: null, twistId: null, ratePerKg: 5, effectiveFrom: '2026-01-01', effectiveTo: null };
  assert.equal(rateApplies('holo', yarnOnly, { yarnId: 'Y1', cutId: 'C9' }, '2026-05-01'), true);
  assert.equal(rateApplies('holo', yarnOnly, { yarnId: 'Y1', cutId: null }, '2026-05-01'), true);
  const pinned = { ...yarnOnly, id: 'pin', cutId: 'C1' };
  // A pinned Cut outranks the wildcard for its cut, loses everywhere else.
  assert.equal(matchRate('holo', [yarnOnly, pinned], { yarnId: 'Y1', cutId: 'C1' }, '2026-05-01').rate.id, 'pin');
  assert.equal(matchRate('holo', [yarnOnly, pinned], { yarnId: 'Y1', cutId: 'C2' }, '2026-05-01').rate.id, 'yo');
  // A pinned Cut never matches a row with no cut.
  assert.equal(matchRate('holo', [pinned], { yarnId: 'Y1', cutId: null }, '2026-05-01').reason, 'no_rate');
});

test('matchRate returns no_rate when nothing applies', () => {
  const res = matchRate('holo', HOLO_RATES, { yarnId: 'Y9', cutId: 'C1' }, '2026-05-01');
  assert.equal(res.rate, null);
  assert.equal(res.reason, 'no_rate');
});

test('matchRate rejects equally-specific ambiguity', () => {
  const dupes = [
    { id: 'a', process: 'holo', yarnId: 'Y1', cutId: 'C1', twistId: null, ratePerKg: 10, effectiveFrom: '2026-01-01', effectiveTo: null },
    { id: 'b', process: 'holo', yarnId: 'Y1', cutId: 'C1', twistId: null, ratePerKg: 11, effectiveFrom: '2026-03-01', effectiveTo: null },
  ];
  const res = matchRate('holo', dupes, { yarnId: 'Y1', cutId: 'C1' }, '2026-05-01');
  assert.equal(res.rate, null);
  assert.equal(res.reason, 'ambiguous_rate');
});

test('matchRate respects effective dating (versioning)', () => {
  const versions = [
    { id: 'v1', process: 'holo', yarnId: 'Y1', cutId: 'C1', twistId: null, ratePerKg: 10, effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' },
    { id: 'v2', process: 'holo', yarnId: 'Y1', cutId: 'C1', twistId: null, ratePerKg: 15, effectiveFrom: '2026-04-01', effectiveTo: null },
  ];
  assert.equal(matchRate('holo', versions, { yarnId: 'Y1', cutId: 'C1' }, '2026-02-15').rate.id, 'v1');
  assert.equal(matchRate('holo', versions, { yarnId: 'Y1', cutId: 'C1' }, '2026-05-15').rate.id, 'v2');
});

test('coning rate matching keys on side', () => {
  const rates = [
    { id: 'single', process: 'coning', yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', ratePerKg: 8, effectiveFrom: '2026-01-01', effectiveTo: null },
    { id: 'both', process: 'coning', yarnId: 'Y1', cutId: 'C1', side: 'BOTH', ratePerKg: 12, effectiveFrom: '2026-01-01', effectiveTo: null },
  ];
  assert.equal(matchRate('coning', rates, { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE' }, '2026-05-01').rate.id, 'single');
  assert.equal(matchRate('coning', rates, { yarnId: 'Y1', cutId: 'C1', side: 'BOTH' }, '2026-05-01').rate.id, 'both');
  assert.equal(matchRate('coning', rates, { yarnId: 'Y1', cutId: 'C1', side: 'UNKNOWN' }, '2026-05-01').reason, 'no_rate');
});

test('cutter rate matching keys on item + cut', () => {
  const rates = [
    { id: 'r', process: 'cutter', itemId: 'I1', cutId: 'C1', ratePerKg: 5, effectiveFrom: '2026-01-01', effectiveTo: null },
  ];
  assert.equal(matchRate('cutter', rates, { itemId: 'I1', cutId: 'C1' }, '2026-05-01').rate.id, 'r');
  assert.equal(matchRate('cutter', rates, { itemId: 'I2', cutId: 'C1' }, '2026-05-01').reason, 'no_rate');
});

// ---- Rate conflict detection (overlap validation) ----

test('ratesConflict flags identical coning tuples', () => {
  const a = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: null, coneTypeId: null };
  const b = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: null, coneTypeId: null };
  assert.equal(ratesConflict('coning', a, b), true);
});

test('ratesConflict flags cross-override equal-specificity coning conflict', () => {
  // twist-only (spec 1) vs cone-only (spec 1): a row with that twist AND cone
  // matches both at specificity 1 → ambiguous → must be rejected at config time.
  const twistOnly = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: 'T1', coneTypeId: null };
  const coneOnly = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: null, coneTypeId: 'CT1' };
  assert.equal(ratesConflict('coning', twistOnly, coneOnly), true);
});

test('ratesConflict does NOT flag disjoint or different-specificity rates', () => {
  const twT1 = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: 'T1', coneTypeId: null };
  const twT2 = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: 'T2', coneTypeId: null };
  assert.equal(ratesConflict('coning', twT1, twT2), false); // same key, different value → disjoint
  const base = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: null, coneTypeId: null };
  const twistCone = { yarnId: 'Y1', cutId: 'C1', side: 'SINGLE', twistId: 'T1', coneTypeId: 'CT1' };
  assert.equal(ratesConflict('coning', base, twistCone), false); // spec 0 vs spec 2 → precedence resolves
  const otherSide = { yarnId: 'Y1', cutId: 'C1', side: 'BOTH', twistId: null, coneTypeId: null };
  assert.equal(ratesConflict('coning', base, otherSide), false); // different required key
});

// ---- Adjustments & totals ----

test('adjustmentSignedAmount signs by type', () => {
  assert.equal(adjustmentSignedAmount('bonus', 100), 100);
  assert.equal(adjustmentSignedAmount('other', 50), 50);
  assert.equal(adjustmentSignedAmount('advance_recovery', 30), -30);
  assert.equal(adjustmentSignedAmount('deduction', 20), -20);
  assert.equal(adjustmentSignedAmount('deduction', -20), -20); // always uses magnitude
});

test('computeTotals combines production and adjustments', () => {
  const res = computeTotals(1000, [
    { type: 'bonus', amount: 100 },
    { type: 'advance_recovery', amount: 250 },
    { type: 'deduction', amount: 50 },
  ]);
  assert.equal(res.productionAmount, 1000);
  assert.equal(res.adjustmentsTotal, -200);
  assert.equal(res.finalPayable, 800);
});

test('summarizeLines aggregates kg and amount', () => {
  const res = summarizeLines([
    { netKg: 1.111, amount: 10.5 },
    { netKg: 2.222, amount: 20.25 },
  ]);
  assert.equal(res.productionKg, 3.333);
  assert.equal(res.productionAmount, 30.75);
});
