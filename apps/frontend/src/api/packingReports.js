const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:4000`;
  return 'http://localhost:4000';
};

const API_BASE = getApiBase();
const REPORT_BASE = '/api/packing-reports';

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) query.set(key, value.join(','));
      return;
    }
    query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

async function request(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(error?.message || `Unable to reach ${path}`);
  }

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
    }
    const error = new Error(parsed?.message || parsed?.error || raw || `API GET ${path} failed with ${response.status}`);
    error.status = response.status;
    error.code = parsed?.error || null;
    error.details = parsed?.details || null;
    throw error;
  }
  return parsed ?? {};
}

export function getPackingProductionReport(params = {}, options = {}) {
  return request(`${REPORT_BASE}/production${buildQuery(params)}`, options);
}

export function getPackingStockReport(params = {}, options = {}) {
  return request(`${REPORT_BASE}/stock${buildQuery(params)}`, options);
}

export function getPackingVarianceReport(params = {}, options = {}) {
  return request(`${REPORT_BASE}/variance${buildQuery(params)}`, options);
}

export function getPackingExceptionsReport(params = {}, options = {}) {
  return request(`${REPORT_BASE}/exceptions${buildQuery(params)}`, options);
}

export function getPackingReconciliationReport(params = {}, options = {}) {
  return request(`${REPORT_BASE}/reconciliation${buildQuery(params)}`, options);
}

export function getPackingBarcodeHistory(barcode, params = {}, options = {}) {
  const normalized = String(barcode || '').trim();
  if (!normalized) throw new Error('Barcode is required');
  return request(`/api/reports/barcode-history/${encodeURIComponent(normalized)}${buildQuery(params)}`, options);
}

export function getPackingLineage(barcode, params = {}, options = {}) {
  return getPackingBarcodeHistory(barcode, params, options);
}
