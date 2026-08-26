export function normalizePackedStockFilters(filters = {}) {
  return {
    status: Array.isArray(filters.status) ? filters.status.join(',') : (filters.status || ''),
    customerId: filters.customerId || '',
    search: filters.search || '',
    batchKind: filters.batchKind || '',
  };
}

export function packedStockFilterKey(filters = {}) {
  const normalized = normalizePackedStockFilters(filters);
  return JSON.stringify([normalized.status, normalized.customerId, normalized.search, normalized.batchKind]);
}

export function buildPackedStockQuery(filters = {}, pageSize = 50, cursor = null) {
  const normalized = normalizePackedStockFilters(filters);
  return {
    ...normalized,
    limit: pageSize,
    ...(cursor ? { cursor } : {}),
  };
}
