const REPORT_FILTER_KEYS = ['dateFrom', 'dateTo', 'status', 'kind'];

export function mergePackingReportFilters(filters = {}, values = {}) {
  return REPORT_FILTER_KEYS.reduce((next, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      next[key] = values[key] === null || values[key] === undefined ? '' : String(values[key]);
    }
    return next;
  }, { ...filters });
}

export function buildPackingReportQuery(filters = {}, tab = 'production') {
  const query = { limit: 100 };
  if (filters.dateFrom) query.dateFrom = filters.dateFrom;
  if (filters.dateTo) query.dateTo = filters.dateTo;
  if (filters.status && tab !== 'production') query.status = filters.status;
  if (filters.kind && tab === 'reconciliation') query.kind = filters.kind;
  return query;
}
