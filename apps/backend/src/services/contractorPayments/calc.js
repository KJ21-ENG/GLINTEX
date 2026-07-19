// Pure, database-free calculation logic for contractor KG payments.
// Everything here is unit-testable with node:test (no Prisma, no I/O).

export const PROCESSES = ['cutter', 'holo', 'coning'];

export const SIDE_TYPES = ['SINGLE', 'BOTH', 'UNKNOWN'];

export const ADJUSTMENT_TYPES = ['bonus', 'advance_recovery', 'deduction', 'other'];

// Adjustment sign: additions increase the payable, recoveries reduce it.
const ADJUSTMENT_SIGN = {
  bonus: 1,
  other: 1,
  advance_recovery: -1,
  deduction: -1,
};

export const PAYMENT_MODES = ['Cash', 'Bank', 'UPI', 'Other'];

// ---------------------------------------------------------------------------
// Numbers & rounding
// ---------------------------------------------------------------------------

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

// Round to a fixed number of decimals using round-half-up on the absolute
// value (so -2.5 -> -3, 2.5 -> 3). Avoids binary-float artefacts by scaling
// with a small epsilon nudge before rounding.
export function roundTo(value, decimals) {
  const num = toFiniteNumber(value);
  if (num === null) return 0;
  const factor = 10 ** decimals;
  const scaled = num * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-9);
  return rounded / factor;
}

export function roundCurrency(value) {
  return roundTo(value, 2);
}

export function roundKg(value) {
  return roundTo(value, 3);
}

// amount = round(netKg × ratePerKg, 2)
export function computeAmount(netKg, ratePerKg) {
  const kg = toFiniteNumber(netKg);
  const rate = toFiniteNumber(ratePerKg);
  if (kg === null || rate === null) return 0;
  return roundCurrency(kg * rate);
}

// ---------------------------------------------------------------------------
// Net KG resolution (process-specific fallbacks)
// ---------------------------------------------------------------------------

// Resolve the received net KG for a production row. Returns a number rounded to
// three decimals, or null when no positive weight can be derived.
export function resolveNetKg(process, row) {
  if (!row || typeof row !== 'object') return null;
  let raw = null;
  if (process === 'cutter') {
    raw = firstPositive(row.netWt, row.totalKg);
  } else if (process === 'holo') {
    raw = firstPositive(row.rollWeight, subtract(row.grossWeight, row.tareWeight));
  } else if (process === 'coning') {
    raw = firstPositive(
      row.netWeight,
      row.coneWeight,
      subtract(row.grossWeight, row.tareWeight),
    );
  } else {
    return null;
  }
  if (raw === null) return null;
  const rounded = roundKg(raw);
  return rounded > 0 ? rounded : null;
}

function subtract(a, b) {
  const x = toFiniteNumber(a);
  const y = toFiniteNumber(b);
  if (x === null) return null;
  return x - (y === null ? 0 : y);
}

// Returns the first argument that resolves to a finite, positive number.
function firstPositive(...values) {
  for (const value of values) {
    const num = toFiniteNumber(value);
    if (num !== null && num > 0) return num;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Side validation
// ---------------------------------------------------------------------------
// (The S/S->SINGLE / B/S->BOTH name backfill is done once in the migration's
// raw SQL — see 20260711090000_add_contractor_payments — and is covered by the
// migration Side-backfill integration test, so no JS derivation helper ships.)

export function normalizeSide(value) {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return SIDE_TYPES.includes(upper) ? upper : null;
}

// ---------------------------------------------------------------------------
// Opening-stock detection
// ---------------------------------------------------------------------------

const OPENING_CREATED_BY = new Set(['opening', 'opening_bulk']);

// A production row is opening stock when its createdBy marker is an opening
// marker. The OP- lot prefix is only authoritative at the cutter stage: Holo
// and Coning issues can legitimately carry OP-prefixed upstream references
// while still representing contractor-produced output at their own stage.
export function isOpeningStockRow(row) {
  if (!row || typeof row !== 'object') return false;
  const createdBy = typeof row.createdBy === 'string' ? row.createdBy.trim().toLowerCase() : '';
  if (OPENING_CREATED_BY.has(createdBy)) return true;
  const process = typeof row.process === 'string' ? row.process.trim().toLowerCase() : '';
  if (process && process !== 'cutter') return false;
  const lotNo = typeof row.lotNo === 'string' ? row.lotNo.trim().toUpperCase() : '';
  if (lotNo.startsWith('OP-')) return true;
  return false;
}

// Externally-purchased pre-cut goods enter the cutter receive table via the
// inbound cutter-purchase flow (createdBy 'cutter_purchase', lot prefix CP-).
// They are not the cutter contractor's production. As with OP-, the CP- prefix
// alone must not exclude downstream Holo/Coning work performed on that input.
export function isPurchasedRow(row) {
  if (!row || typeof row !== 'object') return false;
  const createdBy = typeof row.createdBy === 'string' ? row.createdBy.trim().toLowerCase() : '';
  if (createdBy === 'cutter_purchase') return true;
  const process = typeof row.process === 'string' ? row.process.trim().toLowerCase() : '';
  if (process && process !== 'cutter') return false;
  const lotNo = typeof row.lotNo === 'string' ? row.lotNo.trim().toUpperCase() : '';
  if (lotNo.startsWith('CP-')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Date helpers (YYYY-MM-DD lexical comparison)
// ---------------------------------------------------------------------------

// Validate an ISO date string AND that it is a real calendar date, so a
// malformed value (e.g. 2026-13-45) is rejected rather than silently sorting
// as a boundary in lexical range comparisons.
export function isValidDateStr(value) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Rate key definitions & matching
// ---------------------------------------------------------------------------

// Required and optional-override keys per process. For holo and coning the
// Cut is an OPTIONAL override: a cut-less rate is a wildcard for any cut, and
// a rate pinning a Cut outranks it (same mechanics as Twist/Cone Type).
export const RATE_KEY_SPEC = {
  cutter: { required: ['itemId', 'cutId'], optional: [] },
  holo: { required: ['yarnId'], optional: ['cutId', 'twistId'] },
  coning: { required: ['yarnId', 'side'], optional: ['cutId', 'twistId', 'coneTypeId'] },
};

function keyValue(obj, key) {
  const value = obj ? obj[key] : null;
  if (value === undefined || value === '') return null;
  return value;
}

// A current rate is applicable to a row when every required key matches
// exactly, and every optional key is either a wildcard (null on the rate) or
// matches the row exactly.
export function rateApplies(process, rate, rowKeys) {
  const spec = RATE_KEY_SPEC[process];
  if (!spec) return false;
  if (!rate) return false;
  if (rate.process && rate.process !== process) return false;

  for (const key of spec.required) {
    const rateVal = keyValue(rate, key);
    const rowVal = keyValue(rowKeys, key);
    if (rateVal === null) return false; // required key must be specified on the rate
    if (rowVal === null) return false; // row lacks the quality data
    if (rateVal !== rowVal) return false;
  }
  for (const key of spec.optional) {
    const rateVal = keyValue(rate, key);
    if (rateVal === null) continue; // wildcard override — always matches
    const rowVal = keyValue(rowKeys, key);
    if (rateVal !== rowVal) return false;
  }
  return true;
}

// Number of optional keys the rate pins down (its specificity).
function rateSpecificity(process, rate) {
  const spec = RATE_KEY_SPEC[process];
  if (!spec) return 0;
  return spec.optional.reduce((acc, key) => acc + (keyValue(rate, key) === null ? 0 : 1), 0);
}

// Two rates CONFLICT when some production row could match both at the SAME
// specificity (making matchRate reject it as ambiguous). This catches not just
// identical key tuples but cross-override overlaps — e.g. a coning twist-only
// rate and a cone-only rate: a row with that twist AND cone matches both at
// specificity 1. Reject such pairs at rate-config time instead of surfacing an
// ambiguous_rate blocker later. Conflict iff: same required keys, same
// specificity, and every optional key is compatible (not both pinned to
// different values).
export function ratesConflict(process, a, b) {
  const spec = RATE_KEY_SPEC[process];
  if (!spec) return false;
  for (const key of spec.required) {
    if (keyValue(a, key) !== keyValue(b, key)) return false;
  }
  if (rateSpecificity(process, a) !== rateSpecificity(process, b)) return false;
  for (const key of spec.optional) {
    const av = keyValue(a, key);
    const bv = keyValue(b, key);
    if (av !== null && bv !== null && av !== bv) return false; // disjoint on this key
  }
  return true;
}

// Select the single most-specific applicable rate for a row.
// Returns { rate } on success, or { rate: null, reason } when none apply
// ('no_rate') or when multiple equally-specific rates tie ('ambiguous_rate').
export function matchRate(process, rates, rowKeys) {
  const applicable = (Array.isArray(rates) ? rates : []).filter(
    (rate) => rateApplies(process, rate, rowKeys),
  );
  if (applicable.length === 0) return { rate: null, reason: 'no_rate' };

  let best = -1;
  applicable.forEach((rate) => {
    const spec = rateSpecificity(process, rate);
    if (spec > best) best = spec;
  });
  const top = applicable.filter((rate) => rateSpecificity(process, rate) === best);
  if (top.length > 1) return { rate: null, reason: 'ambiguous_rate', candidates: top };
  return { rate: top[0], reason: null };
}

// ---------------------------------------------------------------------------
// Adjustments & totals
// ---------------------------------------------------------------------------

export function adjustmentSignedAmount(type, amount) {
  const sign = ADJUSTMENT_SIGN[type] ?? 1;
  const value = toFiniteNumber(amount);
  if (value === null) return 0;
  return sign * Math.abs(value);
}

// Given the production amount and a list of adjustments, compute the net
// adjustments total and final payable, all rounded to currency precision.
export function computeTotals(productionAmount, adjustments) {
  const production = roundCurrency(productionAmount);
  let adjustmentsTotal = 0;
  for (const adj of Array.isArray(adjustments) ? adjustments : []) {
    adjustmentsTotal += adjustmentSignedAmount(adj?.type, adj?.amount);
  }
  adjustmentsTotal = roundCurrency(adjustmentsTotal);
  const finalPayable = roundCurrency(production + adjustmentsTotal);
  return { productionAmount: production, adjustmentsTotal, finalPayable };
}

// Aggregate settlement lines into production totals.
export function summarizeLines(lines) {
  let productionKg = 0;
  let productionAmount = 0;
  for (const line of Array.isArray(lines) ? lines : []) {
    productionKg += toFiniteNumber(line?.netKg) ?? 0;
    productionAmount += toFiniteNumber(line?.amount) ?? 0;
  }
  return { productionKg: roundKg(productionKg), productionAmount: roundCurrency(productionAmount) };
}

// ---------------------------------------------------------------------------
// Quality-wise grouping (for preview totals)
// ---------------------------------------------------------------------------

// Build a stable grouping key describing the quality combination of a line.
export function qualityGroupKey(process, keys) {
  const spec = RATE_KEY_SPEC[process];
  if (!spec) return 'unknown';
  const parts = [...spec.required, ...spec.optional].map((k) => `${k}=${keyValue(keys, k) ?? ''}`);
  return parts.join('|');
}
