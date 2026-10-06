export const DEFAULT_SCALE_SETTINGS = Object.freeze({
  profileId: 'bracket-integer', baudRate: 2400, dataBits: 8, parity: 'none',
  stopBits: 1, flowControl: 'none', unit: 'kg', decimalPlaces: 2,
  minKg: 0, maxKg: 5000, stabilitySamples: 3, toleranceKg: 0.001, staleMs: 1500,
});

export const SCALE_PROFILES = [
  { id: 'bracket-integer', label: 'Bracket integer' },
  { id: 'st-us-line', label: 'ST / US explicit-unit line' },
  { id: 'explicit-unit-line', label: 'Explicit unit line' },
  { id: 'unknown', label: 'Unknown / diagnostics only' },
];
const factors = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };

export function validateScaleSettings(input = {}) {
  const settings = { ...DEFAULT_SCALE_SETTINGS, ...input };
  if (Object.keys(settings).some(key => !Object.hasOwn(DEFAULT_SCALE_SETTINGS, key))
    || !SCALE_PROFILES.some(profile => profile.id === settings.profileId)
    || ![1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(settings.baudRate)
    || ![7, 8].includes(settings.dataBits) || ![1, 2].includes(settings.stopBits)
    || !['none', 'even', 'odd'].includes(settings.parity)
    || !['none', 'rtscts'].includes(settings.flowControl)
    || !Object.hasOwn(factors, settings.unit) || !Number.isInteger(settings.decimalPlaces)
    || settings.decimalPlaces < 0 || settings.decimalPlaces > 6
    || !Number.isInteger(settings.stabilitySamples) || settings.stabilitySamples < 2 || settings.stabilitySamples > 20
    || !Number.isFinite(settings.toleranceKg) || settings.toleranceKg < 0 || settings.toleranceKg > 1
    || !Number.isInteger(settings.staleMs) || settings.staleMs < 100 || settings.staleMs > 10000
    || !Number.isFinite(settings.minKg) || !Number.isFinite(settings.maxKg)
    || settings.minKg < -5000 || settings.maxKg > 100000 || settings.minKg >= settings.maxKg) {
    throw new Error('Invalid scale settings');
  }
  return settings;
}

// Only complete frames in the selected profile are measurements. Never infer a decimal factor.
export function parseWeightReading(sample, options = {}) {
  if (typeof sample !== 'string') return null;
  const text = sample.trim();
  const profile = options.profileId || 'legacy-unit-line';
  let match, value, unit, stable = false;
  if (profile === 'bracket-integer') {
    match = /^\[([+-]?\d{1,12})\]$/.exec(text);
    if (!match || !Object.hasOwn(factors, options.unit) || !Number.isInteger(options.decimalPlaces)
      || options.decimalPlaces < 0 || options.decimalPlaces > 6) return null;
    value = Number(match[1]) / 10 ** options.decimalPlaces;
    unit = options.unit;
  } else if (['st-us-line', 'explicit-unit-line', 'legacy-unit-line'].includes(profile)) {
    match = /^(?:(ST|US)[ ,]+)?([+-]?\d+(?:\.\d+)?)\s*(kg|g|lb|oz)$/i.exec(text);
    if (!match || match[1]?.toUpperCase() === 'US' || (profile === 'st-us-line' && !match[1])
      || (profile === 'explicit-unit-line' && match[1])) return null;
    value = Number(match[2]); unit = match[3].toLowerCase();
    stable = match[1]?.toUpperCase() === 'ST';
  } else return null;
  const weightKg = value * factors[unit];
  if (!Number.isFinite(weightKg) || weightKg < (options.minKg ?? 0) || weightKg > (options.maxKg ?? 5000)) return null;
  return { weightKg, unit, raw: text, parser: stable ? 'st-us-line' : (profile === 'legacy-unit-line' ? 'explicit-unit-line' : profile), stable, confidence: 1, pos: 0 };
}

export class ScaleFrameBuffer {
  constructor(profileId, limit = 512) { this.profileId = profileId; this.limit = limit; this.reset(); }
  reset() { this.buffer = ''; this.discarding = false; }
  discardPartial() { this.discarding = this.discarding || this.buffer.length > 0; this.buffer = ''; }
  push(chunk) {
    const frames = [];
    for (const char of String(chunk)) {
      const end = this.profileId === 'bracket-integer' ? char === ']' : char === '\r' || char === '\n';
      if (end) {
        if (!this.discarding) {
          if (this.profileId === 'bracket-integer') this.buffer += char;
          if (this.buffer.trim()) frames.push(this.buffer);
        }
        this.reset();
      } else if (!this.discarding) {
        this.buffer += char;
        if (this.buffer.length > this.limit) { this.buffer = ''; this.discarding = true; frames.push(null); }
      }
    }
    return frames;
  }
}
export function roundKg3(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : null;
}
