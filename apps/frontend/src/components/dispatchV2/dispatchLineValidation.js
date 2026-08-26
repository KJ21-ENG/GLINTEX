const WEIGHT_EPSILON_KG = 0.0015;

export function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function assertCustomerReservationCompatibility(sourceCustomerId, { queueCustomerIds = [], draftCustomerId = '' } = {}) {
  const sourceId = sourceCustomerId ? String(sourceCustomerId) : '';
  const existingIds = queueCustomerIds.filter(Boolean).map(String);
  if (sourceId && existingIds.some((customerId) => customerId !== sourceId)) {
    throw new Error('A scan queue cannot mix customer-reserved units');
  }
  if (sourceId && draftCustomerId && String(draftCustomerId) !== sourceId) {
    throw new Error('This barcode is reserved to a different Customer');
  }
  return true;
}

export function assertDispatchableSource(source) {
  const sourceType = String(source?.sourceType || source?.stage || '').trim().toUpperCase();
  if (sourceType === 'CONING' || source?.dispatchable === false || source?.readOnly === true) {
    throw new Error('Historical Coning sources are readable but cannot be admitted to Dispatch V2.');
  }
  return true;
}

function isIntegerCount(value) {
  return Number.isInteger(value) && value >= 0;
}

export function validateDispatchLine(item, lineIndex) {
  const lineLabel = item.barcode || item.sourceId || `line ${lineIndex + 1}`;
  const dispatchedWeight = asNumber(item.dispatchNetWeightKg);
  if (dispatchedWeight === null || dispatchedWeight <= 0) {
    throw new Error(`${lineLabel}: exact dispatched net weight is required`);
  }

  const isPacked = item.sourceType === 'PACKED';
  if (!isPacked) {
    const optionalCount = asNumber(item.dispatchBaseCount);
    if (optionalCount !== null && !isIntegerCount(optionalCount)) {
      throw new Error(`${lineLabel}: dispatched count must be a whole number`);
    }
    const availableWeight = asNumber(item.availableNetWeightKg);
    if (availableWeight !== null && dispatchedWeight > availableWeight + WEIGHT_EPSILON_KG) {
      throw new Error(`${lineLabel}: dispatched weight exceeds the authoritative available weight`);
    }
    return {
      baseCount: optionalCount,
      netWeightKg: dispatchedWeight,
      residualBaseCount: 0,
      residualNetWeightKg: 0,
      damagedLostBaseCount: 0,
      damagedLostNetWeightKg: 0,
      salvageableBaseCount: 0,
      salvageableWeightKg: 0,
      partialDispatch: false,
      partialDispatchReason: null,
    };
  }

  const availableCount = asNumber(item.availableCount);
  const availableWeight = asNumber(item.availableNetWeightKg);
  const dispatchedCount = asNumber(item.dispatchBaseCount);
  if (!isIntegerCount(availableCount) || availableCount <= 0) {
    throw new Error(`${lineLabel}: Packed Stock must provide an authoritative available base count`);
  }
  if (!isIntegerCount(dispatchedCount) || dispatchedCount <= 0) {
    throw new Error(`${lineLabel}: exact dispatched base count is required`);
  }
  if (availableWeight === null || availableWeight <= 0) {
    throw new Error(`${lineLabel}: Packed Stock must provide an authoritative available net weight`);
  }
  if (dispatchedWeight > availableWeight + WEIGHT_EPSILON_KG) {
    throw new Error(`${lineLabel}: dispatched weight exceeds the authoritative available weight`);
  }

  const residualCount = asNumber(item.residualBaseCount);
  const residualWeight = asNumber(item.residualNetWeightKg);
  const damagedLostBaseCount = asNumber(item.damagedLostBaseCount);
  const damagedLostNetWeightKg = asNumber(item.damagedLostNetWeightKg ?? 0);
  const salvageableBaseCount = asNumber(item.salvageableBaseCount ?? 0);
  const salvageableWeightKg = asNumber(item.salvageableWeightKg ?? 0);
  const countChanged = dispatchedCount !== availableCount;
  const weightChanged = dispatchedWeight < availableWeight - WEIGHT_EPSILON_KG;
  const partialDispatch = Boolean(
    item.partialDispatch
    || countChanged
    || weightChanged
    || (residualCount !== null && residualCount > 0)
    || (residualWeight !== null && residualWeight > WEIGHT_EPSILON_KG)
    || (damagedLostBaseCount !== null && damagedLostBaseCount > 0)
    || (damagedLostNetWeightKg !== null && damagedLostNetWeightKg > WEIGHT_EPSILON_KG)
    || (salvageableBaseCount !== null && salvageableBaseCount > 0)
    || (salvageableWeightKg !== null && salvageableWeightKg > WEIGHT_EPSILON_KG)
  );

  if (partialDispatch && !item.allowPartialDispatch) {
    throw new Error(`${lineLabel}: this recipe allows whole-unit Dispatch only`);
  }
  if (!partialDispatch) {
    return {
      baseCount: dispatchedCount,
      netWeightKg: dispatchedWeight,
      residualBaseCount: 0,
      residualNetWeightKg: 0,
      damagedLostBaseCount: 0,
      damagedLostNetWeightKg: 0,
      salvageableBaseCount: 0,
      salvageableWeightKg: 0,
      partialDispatch: false,
      partialDispatchReason: null,
    };
  }

  if (!isIntegerCount(residualCount)) {
    throw new Error(`${lineLabel}: exact residual base count is required for a partial Dispatch`);
  }
  if (residualWeight === null || residualWeight <= WEIGHT_EPSILON_KG) {
    throw new Error(`${lineLabel}: exact residual net weight is required for a partial Dispatch`);
  }
  if (!isIntegerCount(damagedLostBaseCount)) {
    throw new Error(`${lineLabel}: an explicit damaged/lost count is required, including zero when none was damaged or lost`);
  }
  if (damagedLostNetWeightKg === null || damagedLostNetWeightKg < 0) {
    throw new Error(`${lineLabel}: damaged/lost net weight must be zero or a non-negative exact value`);
  }
  if (!isIntegerCount(salvageableBaseCount) || salvageableWeightKg === null || salvageableWeightKg < 0) {
    throw new Error(`${lineLabel}: salvageable count and weight must both be zero or both be valid non-negative values`);
  }
  const hasSalvageCount = salvageableBaseCount > 0;
  const hasSalvageWeight = salvageableWeightKg > WEIGHT_EPSILON_KG;
  if (hasSalvageCount !== hasSalvageWeight) {
    throw new Error(`${lineLabel}: salvageable count and weight must both be provided or both be zero`);
  }
  if (salvageableBaseCount > (damagedLostBaseCount || 0)) {
    throw new Error(`${lineLabel}: salvageable base count cannot exceed damaged/lost count`);
  }
  if (salvageableWeightKg > (damagedLostNetWeightKg || 0) + WEIGHT_EPSILON_KG) {
    throw new Error(`${lineLabel}: salvageable weight cannot exceed damaged/lost weight`);
  }
  if (residualCount <= 0) {
    throw new Error(`${lineLabel}: a partial Dispatch must leave a positive residual base count`);
  }
  if (dispatchedCount + residualCount + damagedLostBaseCount !== availableCount) {
    throw new Error(`${lineLabel}: dispatched + residual + damaged/lost count must equal available count`);
  }
  const accountedWeight = dispatchedWeight + residualWeight + damagedLostNetWeightKg;
  if (accountedWeight > availableWeight + WEIGHT_EPSILON_KG) {
    throw new Error(`${lineLabel}: dispatched plus residual weight exceeds available weight`);
  }
  if (Math.abs(accountedWeight - availableWeight) > WEIGHT_EPSILON_KG) {
    throw new Error(`${lineLabel}: dispatched + residual + damaged/lost weight must equal available weight`);
  }
  const partialDispatchReason = String(item.partialDispatchReason || '').trim();
  if (!partialDispatchReason) {
    throw new Error(`${lineLabel}: a reason is required for a partial Dispatch`);
  }

  return {
    baseCount: dispatchedCount,
    netWeightKg: dispatchedWeight,
    residualBaseCount: residualCount,
    residualNetWeightKg: residualWeight,
    damagedLostBaseCount,
    damagedLostNetWeightKg,
    salvageableBaseCount,
    salvageableWeightKg,
    partialDispatch: true,
    partialDispatchReason,
  };
}

export function buildDispatchLinePayload(item, lineIndex) {
  const validated = validateDispatchLine(item, lineIndex);
  const line = {
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceBarcode: item.barcode || null,
    baseCount: validated.baseCount,
    netWeightKg: validated.netWeightKg,
    reason: validated.partialDispatchReason,
    parentPackedUnitId: item.parentPackedUnitId || (item.isParentParcel ? item.sourceId : null),
  };

  if (!validated.partialDispatch) return line;

  return {
    ...line,
    residualBaseCount: validated.residualBaseCount,
    residualNetWeightKg: validated.residualNetWeightKg,
    damagedLostBaseCount: validated.damagedLostBaseCount,
    damagedLostNetWeightKg: validated.damagedLostNetWeightKg,
    salvageableBaseCount: validated.salvageableBaseCount,
    salvageableWeightKg: validated.salvageableWeightKg,
  };
}
