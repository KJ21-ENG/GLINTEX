const REVERSIBLE_EVENT_TYPES = new Set(['CHALLAN_VOIDED', 'LINE_CORRECTED', 'LINE_RETURNED']);
const REVERSAL_EVENT_TYPES = new Set(['RETURN_REVERSED', 'DISPATCH_EVENT_REVERSED']);

export function hasDispatchEventReversal(event, events = []) {
  const eventId = event?.id;
  if (!eventId) return false;
  if (event.reversalOfEventId) return true;
  return events.some((candidate) => candidate?.reversalOfEventId === eventId);
}

export function canReverseDispatchEvent(event, lines = [], events = []) {
  if (!event?.id || hasDispatchEventReversal(event, events)) return false;
  const eventType = String(event.type || '').toUpperCase();
  if (!REVERSIBLE_EVENT_TYPES.has(eventType) || REVERSAL_EVENT_TYPES.has(eventType)) return false;

  if (eventType === 'CHALLAN_VOIDED') {
    return lines.every((line) => String(line?.sourceType || '').toUpperCase() !== 'PACKED');
  }

  const line = lines.find((candidate) => candidate?.id === event.lineId);
  return Boolean(line && String(line.sourceType || '').toUpperCase() !== 'PACKED');
}

export function isReversalEvent(event) {
  return REVERSAL_EVENT_TYPES.has(String(event?.type || '').toUpperCase());
}

function isReturnedDispatchLine(line) {
  const events = Array.isArray(line?.events) ? [...line.events].sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0)) : [];
  let returned = false;
  for (const event of events) {
    const type = String(event?.type || '').toUpperCase();
    if (type === 'LINE_RETURNED') returned = true;
    if (type === 'RETURN_REVERSED') returned = false;
  }
  return returned || line?.returned === true;
}

export function canShowChallanMutationActions(challan, { canWrite = false, line = null } = {}) {
  if (!canWrite || challan?.isLegacyReconstruction || challan?.status === 'VOIDED') return false;
  const status = String(challan?.status || '').toUpperCase();
  if (!['ACTIVE', 'PARTIALLY_RETURNED', 'RETURNED'].includes(status)) return false;
  if (!line) return true;
  if (status === 'RETURNED') return true;
  return !isReturnedDispatchLine(line);
}
