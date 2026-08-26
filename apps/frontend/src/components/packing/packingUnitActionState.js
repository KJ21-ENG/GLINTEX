const DAMAGEABLE_STATUSES = new Set(['AVAILABLE', 'RESERVED', 'RETURNED_PENDING_INSPECTION']);
const WRITABLE_OFF_STATUSES = new Set(['AVAILABLE', 'RESERVED', 'RETURNED_PENDING_INSPECTION', 'DAMAGED']);

function canMutateUnit({ canWrite = false, saving = false, forceLabelPending = false } = {}) {
  return Boolean(canWrite && !saving && !forceLabelPending);
}

export function canDamagePackedUnit(unit, options = {}) {
  return canMutateUnit(options) && DAMAGEABLE_STATUSES.has(String(unit?.status || ''));
}

export function canWriteOffPackedUnit(unit, options = {}) {
  return canMutateUnit(options) && WRITABLE_OFF_STATUSES.has(String(unit?.status || ''));
}
