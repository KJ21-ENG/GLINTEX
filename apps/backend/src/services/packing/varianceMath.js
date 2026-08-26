const DECIMAL_SCALE = 1_000_000n;

function decimalToScaled(value) {
  const text = String(value ?? '0').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return 0n;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const scaledFraction = `${fraction}000000`.slice(0, 6);
  const scaled = BigInt(whole || '0') * DECIMAL_SCALE + BigInt(scaledFraction || '0');
  return negative ? -scaled : scaled;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function decimalUnitWeightKg(nominalGram, baseCount) {
  const scaledGrams = decimalToScaled(nominalGram);
  const count = BigInt(Number.isFinite(Number(baseCount)) ? Math.max(0, Math.trunc(Number(baseCount))) : 0);
  return Number(scaledGrams * count) / Number(DECIMAL_SCALE) / 1000;
}

export function calculatePackingUnitVariance({ nominalGram, baseCount, netWeightKg, warningVariancePercent = 2, approvalVariancePercent = 5 }) {
  const expectedNetWeightKg = round(decimalUnitWeightKg(nominalGram, baseCount));
  const actualNetWeightKg = round(netWeightKg);
  const varianceNetWeightKg = round(actualNetWeightKg - expectedNetWeightKg);
  const variancePercent = expectedNetWeightKg > 0
    ? round(Math.abs(varianceNetWeightKg) / expectedNetWeightKg * 100)
    : 0;
  const warning = Number(warningVariancePercent) || 0;
  const approval = Number(approvalVariancePercent) || 0;
  const varianceSeverity = variancePercent <= warning ? 'NORMAL' : variancePercent <= approval ? 'WARNING' : 'APPROVAL_REQUIRED';
  return {
    expectedBaseCount: Number(baseCount),
    expectedNetWeightKg,
    actualBaseCount: Number(baseCount),
    actualNetWeightKg,
    varianceNetWeightKg,
    variancePercent,
    varianceSeverity,
  };
}
