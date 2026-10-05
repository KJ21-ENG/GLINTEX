/** Strict complete-frame parsing. No arbitrary-number or guessed decimal fallback. */
export function parseWeightReading(sample, options = {}) {
  if (typeof sample !== 'string') return null;
  const text = sample.trim();
  const match = /^(?:(ST|US)[ ,]+)?([+-]?\d+(?:\.\d+)?)\s*(kg|g|lb|oz)$/i.exec(text);
  if (!match || match[1]?.toUpperCase() === 'US') return null;
  const unit = match[3].toLowerCase();
  const factors = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };
  const weightKg = Number(match[2]) * factors[unit];
  if (!Number.isFinite(weightKg) || weightKg < (options.minKg ?? 0) || weightKg > (options.maxKg ?? 5000)) return null;
  return { weightKg, unit, raw: text, parser: match[1] ? 'st-us-line' : 'explicit-unit-line', stable: match[1]?.toUpperCase() === 'ST', confidence: 1, pos: 0 };
}
export function roundKg3(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : null;
}
