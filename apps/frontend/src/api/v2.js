// Local request helper (mirrors src/api/client.js behavior, but scoped for v2 endpoints).
const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
};

const BASE = getApiBase();

async function request(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    qs.set(k, String(v));
  });
  const url = `${BASE}${path}${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { method: 'GET', credentials: 'include' });
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
    throw error;
  }
  if (res.status === 204) return null;
  return await res.json();
}

export const getV2IssueTracking = (process, params = {}) =>
  request(`/api/v2/issue/${process}/tracking`, params);

export const getV2IssueTrackingFacets = (process, params = {}) =>
  request(`/api/v2/issue/${process}/tracking/facets`, params);

export const exportV2IssueTrackingJson = (process, params = {}) =>
  request(`/api/v2/issue/${process}/tracking/export.json`, params);

export const getV2ReceiveHistory = (process, params = {}) =>
  request(`/api/v2/receive/${process}/history`, params);

export const getV2ReceiveHistoryFacets = (process, params = {}) =>
  request(`/api/v2/receive/${process}/history/facets`, params);

export const exportV2ReceiveHistoryJson = (process, params = {}) =>
  request(`/api/v2/receive/${process}/history/export.json`, params);

export const getV2OpeningStockHistory = (stage, params = {}) =>
  request(`/api/v2/opening-stock/${stage}/history`, params);

export const exportV2OpeningStockHistoryJson = (stage, params = {}) =>
  request(`/api/v2/opening-stock/${stage}/history/export.json`, params);

export const getV2OnMachine = (process, params = {}) =>
  request(`/api/v2/on-machine/${process}`, params);
