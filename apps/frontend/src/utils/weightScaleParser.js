/**
 * Weight scale parsing helpers.
 *
 * Goal: Extract a weight (in kg) from arbitrary serial text output.
 * We intentionally avoid hard-coding a specific scale protocol; instead we
 * use heuristics based on what the device actually sends.
 */

const DEFAULT_MIN_KG = 0;
const DEFAULT_MAX_KG = 5000;

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSample(sample) {
  if (typeof sample !== 'string') return '';
  return sample
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumberLike(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  // Remove common non-number adornments
  s = s.replace(/[^\d,.\-+]/g, '');

  // If we have both separators, assume the last one is the decimal separator.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandSep).join('');
    if (decimalSep === ',') s = s.replace(',', '.');
  } else if (lastComma !== -1 && lastDot === -1) {
    // Only comma: treat as decimal separator (common in some locales)
    s = s.replace(',', '.');
  } else {
    // Only dot or none: as-is
  }

  const num = Number.parseFloat(s);
  if (!Number.isFinite(num)) return null;
  return num;
}

function unitToKg(value, unitRaw) {
  const unit = String(unitRaw || '').toLowerCase();
  if (unit === 'kg') return value;
  if (unit === 'g') return value / 1000;
  if (unit === 'lb' || unit === 'lbs') return value * 0.45359237;
  if (unit === 'oz') return value * 0.028349523125;
  return value; // unknown unit: assume kg
}

function detectStableFlag(text) {
  const s = String(text || '');
  return /\bST\b/i.test(s) || /\bstable\b/i.test(s) || /\bSTABLE\b/i.test(s);
}

function buildCandidate({
  weightKg,
  unit = 'kg',
  raw,
  parser,
  stable = false,
  confidence = 0.5,
  pos = 0,
}) {
  if (!isFiniteNumber(weightKg)) return null;
  return {
    weightKg,
    unit,
    raw: raw ?? '',
    parser: parser ?? 'unknown',
    stable: Boolean(stable),
    confidence: clamp(Number(confidence) || 0, 0, 1),
    pos: Number.isFinite(Number(pos)) ? Number(pos) : 0,
  };
}

function scoreRange(weightKg, minKg, maxKg) {
  if (!isFiniteNumber(weightKg)) return -1;
  if (weightKg < minKg || weightKg > maxKg) return -1;
  // Prefer positive, non-zero readings
  if (weightKg <= 0) return -0.5;
  return 0.5;
}

function guessBracketScaling(rawValue, digits, minKg, maxKg) {
  // Try common scalings and choose the best candidate within plausible bounds.
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;

  const scales = [1000, 100, 10, 1];
  const scored = scales
    .map((scale) => {
      const weightKg = value / scale;
      const inRangeScore = scoreRange(weightKg, minKg, maxKg);
      if (inRangeScore < 0) return null;
      // Prefer scales that yield 2-3 decimal places in common use.
      const decimalBias = scale === 1000 ? 0.25 : scale === 100 ? 0.15 : 0;
      // Prefer weights that aren’t implausibly huge for typical operations.
      const typicalBias = weightKg <= 300 ? 0.15 : weightKg <= 1000 ? 0.05 : 0;
      const lengthBias = String(digits || '').length === 5 && scale === 1000 ? 0.1 : 0;
      return { scale, weightKg, score: inRangeScore + decimalBias + typicalBias + lengthBias };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0] : null;
}

/**
 * Parse a weight reading from a text sample.
 *
 * Returns `null` when no plausible weight is found.
 *
 * @param {string} sample
 * @param {object} options
 * @param {number} options.minKg
 * @param {number} options.maxKg
 */
export function parseWeightReading(sample, options = {}) {
  const minKg = isFiniteNumber(options.minKg) ? options.minKg : DEFAULT_MIN_KG;
  const maxKg = isFiniteNumber(options.maxKg) ? options.maxKg : DEFAULT_MAX_KG;

  const text = normalizeSample(sample);
  if (!text) return null;

  const stable = detectStableFlag(text);
  const candidates = [];

  // 1) Explicit units (most reliable)
  // Examples: "12.345 kg", "GS  12710 g", "lb 12.3"
  {
    const re = /(-?\d+(?:[.,]\d+)?)\s*(kg|g|lbs?|oz)\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const numRaw = m[1];
      const unitRaw = m[2];
      const parsed = parseNumberLike(numRaw);
      if (!isFiniteNumber(parsed)) continue;
      const weightKg = unitToKg(parsed, unitRaw);
      const inRangeScore = scoreRange(weightKg, minKg, maxKg);
      if (inRangeScore < 0) continue;
      const confidence = 0.9 + (stable ? 0.08 : 0);
      const c = buildCandidate({
        weightKg,
        unit: String(unitRaw || 'kg').toLowerCase(),
        raw: m[0],
        parser: 'unit',
        stable,
        confidence,
        pos: m.index,
      });
      if (c) candidates.push(c);
    }
  }
  {
    const re = /\b(kg|g|lbs?|oz)\s*(-?\d+(?:[.,]\d+)?)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const unitRaw = m[1];
      const numRaw = m[2];
      const parsed = parseNumberLike(numRaw);
      if (!isFiniteNumber(parsed)) continue;
      const weightKg = unitToKg(parsed, unitRaw);
      const inRangeScore = scoreRange(weightKg, minKg, maxKg);
      if (inRangeScore < 0) continue;
      const confidence = 0.9 + (stable ? 0.08 : 0);
      const c = buildCandidate({
        weightKg,
        unit: String(unitRaw || 'kg').toLowerCase(),
        raw: m[0],
        parser: 'unit',
        stable,
        confidence,
        pos: m.index,
      });
      if (c) candidates.push(c);
    }
  }

  // 2) Bracketed digit protocol (common in some scales)
  // Example: "[12710]" => could mean 12.710 kg or 127.10 kg; we infer scaling.
  {
    const bracketRe = /\[(\d{3,8})\]/g;
    let m;
    while ((m = bracketRe.exec(text)) !== null) {
      const digits = m[1];
      const rawValue = Number.parseInt(digits, 10);
      if (!Number.isFinite(rawValue)) continue;
      const guess = guessBracketScaling(rawValue, digits, minKg, maxKg);
      if (!guess) continue;
      const confidence = 0.75 + (stable ? 0.08 : 0);
      const c = buildCandidate({
        weightKg: guess.weightKg,
        unit: 'kg',
        raw: m[0],
        parser: `bracket_digits/${guess.scale}`,
        stable,
        confidence,
        pos: m.index,
      });
      if (c) candidates.push(c);
    }
  }

  // 3) Fallback: pick the most plausible number in the string
  if (candidates.length === 0) {
    const numberRe = /-?\d+(?:[.,]\d+)?/g;
    let m;
    const fallbackCandidates = [];
    while ((m = numberRe.exec(text)) !== null) {
      const parsed = parseNumberLike(m[0]);
      if (!isFiniteNumber(parsed)) continue;
      const inRangeScore = scoreRange(parsed, minKg, maxKg);
      if (inRangeScore < 0) continue;
      // Prefer decimal readings to avoid selecting counts/ids.
      const hasDecimal = /[.,]\d+/.test(m[0]);
      const confidence = (hasDecimal ? 0.55 : 0.45) + (stable ? 0.05 : 0);
      const c = buildCandidate({
        weightKg: parsed,
        unit: 'kg',
        raw: m[0],
        parser: 'number_fallback',
        stable,
        confidence,
        pos: m.index,
      });
      if (c) fallbackCandidates.push(c);
    }
    // Prefer the last number in the line (often the live reading), with highest confidence.
    fallbackCandidates.sort((a, b) => (b.confidence - a.confidence) || (b.pos - a.pos));
    if (fallbackCandidates.length) candidates.push(fallbackCandidates[0]);
  }

  if (candidates.length === 0) return null;

  // Choose best candidate by confidence, breaking ties by latest in text.
  candidates.sort((a, b) => (b.confidence - a.confidence) || (b.pos - a.pos));
  return candidates[0];
}

export function roundKg3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 1000) / 1000;
}
