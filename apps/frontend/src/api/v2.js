import { brokeredV2Get } from './v2RequestBroker';

async function request(path, params = {}, options = {}) {
  let res;
  try {
    res = await brokeredV2Get(path, params, options);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err?.name === 'TimeoutError') {
      throw new Error('Request timed out — check connection');
    }
    throw err;
  }
  if (!res.ok) {
    // Keep auth/session expiry behavior consistent with src/api/client.js
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
    }
    const raw = await res.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.error || parsed.message || message;
    } catch (_) { }
    if (!message) message = `API GET ${path} failed with ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    try {
      error.payload = JSON.parse(raw);
    } catch (_) { }
    throw error;
  }
  if (res.status === 204) return null;
  return await res.json();
}

export const getV2IssueTracking = (process, params = {}, options = {}) =>
  request(`/api/v2/issue/${process}/tracking`, params, options);

export const getV2TakeBackHistory = (process, params = {}, options = {}) =>
  request(`/api/v2/issue/${process}/take-back-history`, params, options);

export const getV2IssueTrackingFacets = (process, params = {}) =>
  request(`/api/v2/issue/${process}/tracking/facets`, params);

export const exportV2IssueTrackingJson = (process, params = {}) =>
  request(`/api/v2/issue/${process}/tracking/export.json`, params);

export const getV2IssueSourceRow = (process, barcode, options = {}) =>
  request(`/api/v2/issue/${process}/source-row`, { barcode }, options);

export const getV2CutterSourceCandidates = (params = {}) =>
  request('/api/v2/issue/cutter/source-candidates', params);

export const getV2IssueActionDetail = (process, id) =>
  request(`/api/v2/issue/${process}/${encodeURIComponent(id)}/action-detail`);

export const getV2ReceiveHistory = (process, params = {}, options = {}) =>
  request(`/api/v2/receive/${process}/history`, params, options);

export const getV2ReceiveHistoryFacets = (process, params = {}) =>
  request(`/api/v2/receive/${process}/history/facets`, params);

export const exportV2ReceiveHistoryJson = (process, params = {}) =>
  request(`/api/v2/receive/${process}/history/export.json`, params);

export const getV2ReceiveActionDetail = (process, id) =>
  request(`/api/v2/receive/${process}/${encodeURIComponent(id)}/action-detail`);

export const getV2CutterChallans = (params = {}, options = {}) =>
  request('/api/v2/receive/cutter/challans', params, options);

export async function getAllV2CutterChallans(params = {}) {
  const items = [];
  let page = 1;
  let hasMore = false;
  do {
    const result = await getV2CutterChallans({ ...params, page, limit: 200 });
    items.push(...(Array.isArray(result?.items) ? result.items : []));
    hasMore = Boolean(result?.hasMore);
    page += 1;
  } while (hasMore);
  return items;
}

export const getV2CutterCsvDashboard = () =>
  request('/api/v2/receive/cutter/csv-dashboard');

export const getV2OpeningStockHistory = (stage, params = {}, options = {}) =>
  request(`/api/v2/opening-stock/${stage}/history`, params, options);

export const exportV2OpeningStockHistoryJson = (stage, params = {}) =>
  request(`/api/v2/opening-stock/${stage}/history/export.json`, params);

export const getV2OnMachine = (process, params = {}, options = {}) =>
  request(`/api/v2/on-machine/${process}`, params, options);

export const getV2OnMachineSummary = (process, params = {}, options = {}) =>
  request(`/api/v2/on-machine/${process}/summary`, params, options);

export const getV2OnMachineFacets = (process, params = {}) =>
  request(`/api/v2/on-machine/${process}/facets`, params);

export const exportV2OnMachineJson = (process, params = {}) =>
  request(`/api/v2/on-machine/${process}/export.json`, params);

export const getV2StockLots = (process, params = {}, options = {}) =>
  request(`/api/v2/stock/${process}/lot-groups`, params, options);

export const getV2StockSummary = (process, params = {}, options = {}) =>
  request(`/api/v2/stock/${process}/summary`, params, options);

export async function getAllV2StockLots(process, params = {}) {
  const items = [];
  let cursor = null;
  let summary = null;
  do {
    const page = await getV2StockLots(process, { ...params, limit: 200, cursor });
    items.push(...(Array.isArray(page?.items) ? page.items : []));
    summary ||= page?.summary || null;
    cursor = page?.hasMore ? page?.nextCursor : null;
  } while (cursor);
  return { items, summary };
}

export const getV2StockLotRows = (process, params = {}, options = {}) =>
  request(`/api/v2/stock/${process}/lot-rows`, params, options);

export async function getAllV2StockLotRows(process, params = {}) {
  const items = [];
  let cursor = null;
  do {
    const page = await getV2StockLotRows(process, { ...params, limit: 200, cursor });
    items.push(...(Array.isArray(page?.items) ? page.items : []));
    cursor = page?.hasMore ? page?.nextCursor : null;
  } while (cursor);
  return items;
}

export const getV2StockBarcodeLotKeys = (process, params = {}, options = {}) =>
  request(`/api/v2/stock/${process}/barcode-lot-keys`, params, options);
