const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:4000`;
  return 'http://localhost:4000';
};

const API_BASE = getApiBase();

function createIdempotencyKey() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `reconciliation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request(path, { method = 'GET', body, idempotencyKey, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    headers['Idempotency-Key'] = idempotencyKey || createIdempotencyKey();
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
    const error = new Error(parsed?.message || parsed?.error || raw || `API ${method} ${path} failed with ${response.status}`);
    error.status = response.status;
    error.code = parsed?.error || null;
    error.details = parsed?.details || null;
    throw error;
  }
  return parsed ?? {};
}

export function createReconciliationBatch(payload, options = {}) {
  return request('/api/reconciliation/batches', { method: 'POST', body: payload, ...options });
}

export function applyReconciliationBatch(id, payload = {}, options = {}) {
  return request(`/api/reconciliation/batches/${encodeURIComponent(id)}/apply`, { method: 'POST', body: payload, ...options });
}

export function reverseReconciliationBatch(id, payload, options = {}) {
  return request(`/api/reconciliation/batches/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: payload, ...options });
}

export function previewReconciliationBatch(id, payload = {}, options = {}) {
  return request(`/api/reconciliation/batches/${encodeURIComponent(id)}/preview`, { method: 'POST', body: payload, ...options });
}
