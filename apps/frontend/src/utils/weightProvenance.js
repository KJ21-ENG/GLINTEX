// Provenance is informational: the backend still validates all transaction weights.
export function captureProvenance(result) {
  return {
    source: 'scale',
    controllerSource: result.source || 'browser-scale',
    captureId: result.captureId || globalThis.crypto?.randomUUID?.() || null,
    weightKg: result.weightKg,
    timestamp: result.timestamp || new Date().toISOString(),
    device: result.device || result.portInfo || null,
    portInfo: result.portInfo || null,
    baudRate: result.baudRate || null,
    profile: result.profile || null,
    profileId: result.profileId || result.meta?.parser || null,
    unit: result.unit || result.meta?.unit || 'kg',
    rawFrame: result.rawFrame || result.meta?.raw || null,
    raw: result.rawFrame || result.meta?.raw || null,
    stableFlag: Boolean(result.meta?.stable ?? true),
  };
}

export function transactionWeightProvenance(weight, capture) {
  const weightKg = Number(weight);
  // Editing a captured value invalidates its scale attribution.
  if (capture && Number(capture.weightKg) === weightKg) return capture;
  return { source: 'manual', weightKg, timestamp: new Date().toISOString(), reason: 'Entered or edited in transaction form' };
}
