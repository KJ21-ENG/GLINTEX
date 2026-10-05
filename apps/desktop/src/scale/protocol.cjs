"use strict";
const PROFILES = Object.freeze([
  { id: "unknown", label: "Unknown — diagnostics only, capture disabled" },
  {
    id: "st-us-line",
    label: "ST / US signed decimal and unit, CR/LF terminated",
  },
  {
    id: "explicit-unit-line",
    label: "Decimal and explicit unit, CR/LF terminated (sample stability)",
  },
  {
    id: "bracket-integer",
    label: "[integer], configured unit and decimal places (sample stability)",
  },
]);
const factors = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };
function parseFrame(raw, config = {}) {
  const text = String(raw).trim();
  const profileId = config.profileId || "unknown";
  if (profileId === "unknown")
    return { valid: false, reason: "unknown-protocol" };
  if (/\b(ERR(?:OR)?|OL|OVERLOAD|UNDERLOAD)\b/i.test(text))
    return { valid: false, reason: "device-error" };
  let match,
    value,
    unit,
    stable = null;
  if (profileId === "st-us-line") {
    match = /^(ST|US)[ ,]+([+-]?\d+(?:\.\d+)?)[ ]*(kg|g|lb|oz)$/i.exec(text);
    if (!match) return { valid: false, reason: "invalid-frame-or-unit" };
    stable = match[1].toUpperCase() === "ST";
    value = Number(match[2]);
    unit = match[3].toLowerCase();
  } else if (profileId === "explicit-unit-line") {
    match = /^([+-]?\d+(?:\.\d+)?)[ ]*(kg|g|lb|oz)$/i.exec(text);
    if (!match) return { valid: false, reason: "invalid-frame-or-unit" };
    value = Number(match[1]);
    unit = match[2].toLowerCase();
  } else if (profileId === "bracket-integer") {
    match = /^\[([+-]?\d{1,12})\]$/.exec(text);
    if (
      !match ||
      !(config.unit in factors) ||
      !Number.isInteger(config.decimalPlaces)
    )
      return { valid: false, reason: "invalid-profile-or-frame" };
    value = Number(match[1]) / 10 ** config.decimalPlaces;
    unit = config.unit;
  } else return { valid: false, reason: "unknown-protocol" };
  const weightKg = value * factors[unit];
  if (
    !Number.isFinite(weightKg) ||
    weightKg < (config.minKg ?? 0) ||
    weightKg > (config.maxKg ?? 5000)
  )
    return { valid: false, reason: "out-of-range" };
  return {
    valid: true,
    weightKg,
    value,
    unit,
    stable,
    rawFrame: text,
    profileId,
  };
}
// Overflow discards the WHOLE frame until a delimiter: never parse a truncated tail.
class FrameBuffer {
  constructor(profileId, limit = 512) {
    this.profileId = profileId;
    this.limit = limit;
    this.buffer = "";
    this.discarding = false;
  }
  reset() {
    this.buffer = "";
    this.discarding = false;
  }
  push(chunk) {
    const frames = [];
    for (const ch of String(chunk)) {
      const end =
        this.profileId === "bracket-integer"
          ? ch === "]"
          : ch === "\r" || ch === "\n";
      if (end) {
        if (!this.discarding) {
          if (this.profileId === "bracket-integer") this.buffer += ch;
          if (this.buffer.trim()) frames.push(this.buffer);
        }
        this.reset();
      } else if (!this.discarding) {
        this.buffer += ch;
        if (this.buffer.length > this.limit) {
          this.buffer = "";
          this.discarding = true;
        }
      }
    }
    return frames;
  }
}
module.exports = { PROFILES, parseFrame, FrameBuffer };
