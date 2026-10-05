const text = (value, max = 100) => typeof value === 'string' ? value.slice(0, max) : null;
export function validateWeightProvenance(value, expectedWeight) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid weight provenance');
  if (!['scale', 'manual'].includes(value.source)) throw new Error('Invalid weight provenance source');
  const weightKg = Number(value.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 1e9) throw new Error('Invalid captured weight');
  if (expectedWeight != null && Number(expectedWeight) !== weightKg) throw new Error('Capture does not match transaction weight');
  const timestamp = value.timestamp == null ? null : text(value.timestamp, 40);
  if (timestamp && !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid capture timestamp');
  const device = value.device && typeof value.device === 'object' ? {
    path: text(value.device.path), serialNumber: text(value.device.serialNumber),
    manufacturer: text(value.device.manufacturer), vendorId: text(value.device.vendorId), productId: text(value.device.productId), pnpId: text(value.device.pnpId, 256), identityWarning: text(value.device.identityWarning, 200),
  } : null;
  return { trust: 'client-reported', source: value.source, weightKg, timestamp, captureId: text(value.captureId),
    controllerSource: text(value.controllerSource), device, profileId: text(value.profileId),
    profile: value.profile && typeof value.profile === 'object' ? { id: text(value.profile.id), unit: text(value.profile.unit, 12), decimalPlaces: Number.isInteger(value.profile.decimalPlaces) ? value.profile.decimalPlaces : null, stabilitySamples: Number.isInteger(value.profile.stabilitySamples) ? value.profile.stabilitySamples : null, toleranceKg: Number.isFinite(value.profile.toleranceKg) ? value.profile.toleranceKg : null, staleMs: Number.isFinite(value.profile.staleMs) ? value.profile.staleMs : null } : null,
    unit: text(value.unit, 12), rawFrame: text(value.rawFrame ?? value.raw, 512),
    reason: value.source === 'manual' ? text(value.reason, 300) : null,
    baudRate: Number.isInteger(value.baudRate) ? value.baudRate : null, stableFlag: value.stableFlag === true };
}

export function collectWeightProvenance(body = {}) {
  const records = [];
  if (body.weightProvenance != null) records.push({ field: 'grossWeight', capture: validateWeightProvenance(body.weightProvenance, body.grossWeight ?? body.weight) });
  for (const field of ['entries', 'crates', 'pieces']) {
    if (!Array.isArray(body[field])) continue;
    body[field].forEach((entry, index) => {
      if (entry?.weightProvenance != null) records.push({ field: `${field}[${index}]`, capture: validateWeightProvenance(entry.weightProvenance, entry.grossWeight ?? entry.weight) });
    });
  }
  if (records.length > 1000) throw new Error('Too many capture provenance records');
  return records;
}

export function validateTransactionWeightProvenance(req, res, next) {
  try { req.weightProvenance = collectWeightProvenance(req.body); next(); }
  catch (error) { res.status(400).json({ error: error.message }); }
}
