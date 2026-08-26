function responseBody(response) {
  if (response?.data && typeof response.data === 'object' && !Array.isArray(response.data)) return response.data;
  return response && typeof response === 'object' ? response : {};
}

export const PACKING_LABELABLE_UNIT_STATUSES = ['QUALITY_HOLD', 'AVAILABLE', 'RESERVED', 'RETURNED_PENDING_INSPECTION'];

export function canUsePackingUnitLabelActions(unit, { canWrite = false, saving = false, forceLabelPending = false } = {}) {
  return Boolean(
    canWrite
      && !saving
      && !forceLabelPending
      && unit?.barcode
      && PACKING_LABELABLE_UNIT_STATUSES.includes(String(unit.status || '')),
  );
}

export function unwrapPackingLabel(label) {
  if (!label || typeof label !== 'object' || Array.isArray(label)) return null;
  const dto = label.label && typeof label.label === 'object' && !Array.isArray(label.label)
    ? label.label
    : label;
  const barcode = String(dto.barcode || '').trim();
  const itemName = String(dto.itemName || '').trim();
  const baseCount = Number(dto.baseCount);
  if (!barcode || !itemName || !Number.isInteger(baseCount) || baseCount <= 0) return null;
  return { barcode, itemName, baseCount };
}

export function normalizePackingLabelResponse(response) {
  const body = responseBody(response);
  const unit = body.unit
    || body.item
    || body.replacementUnit
    || body.data?.unit
    || (body.data && typeof body.data === 'object' ? body.data : null)
    || (body.id || body.barcode ? body : null)
    || null;
  const label = unwrapPackingLabel(body.label);
  return {
    ...body,
    unit,
    label,
    labelPending: body.labelPending === true
      || unit?.status === 'LABEL_PENDING'
      || (body.label != null && !label),
  };
}

export function isAuthoritativePackingLabelPending(response) {
  return normalizePackingLabelResponse(response).labelPending === true;
}
