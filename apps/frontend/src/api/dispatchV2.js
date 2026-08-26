const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
};

const API_BASE = getApiBase();
const DISPATCH_BASE = '/api/v2/dispatch';

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function getIdempotencyKey(prefix = 'dispatch-v2') {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function parseResponse(response, path, method) {
  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
    }
    const error = new Error(
      parsed?.message || parsed?.error || raw || `API ${method} ${path} failed with ${response.status}`
    );
    error.status = response.status;
    error.code = parsed?.error || null;
    error.details = parsed?.details || parsed || null;
    throw error;
  }
  if (response.status === 204 || !raw) return null;
  return parsed ?? raw;
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(error?.message || `Unable to reach ${path}`);
  }
  return parseResponse(response, path, method);
}

async function requestBlob(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/pdf, application/octet-stream' },
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(error?.message || `Unable to reach ${path}`);
  }
  if (!response.ok) {
    return parseResponse(response, path, 'GET');
  }
  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') || 'application/pdf',
    filename: getFilename(response.headers.get('content-disposition')),
  };
}

function getFilename(contentDisposition) {
  const value = String(contentDisposition || '');
  const match = value.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  return match?.[1] ? decodeURIComponent(match[1]) : (match?.[2] || null);
}

async function mutate(path, body, idempotencyKey) {
  return request(path, {
    method: 'POST',
    body: body || {},
    headers: { 'Idempotency-Key': idempotencyKey || getIdempotencyKey() },
  });
}

export async function getDispatchSourceSummary(options = {}) {
  return request(`${DISPATCH_BASE}/sources/summary`, { signal: options.signal });
}

export async function listDispatchSources(sourceType, params = {}, options = {}) {
  if (!sourceType) throw new Error('Dispatch source type is required');
  return request(
    `${DISPATCH_BASE}/sources/${encodeURIComponent(sourceType)}${buildQuery(params)}`,
    { signal: options.signal }
  );
}

export async function lookupDispatchBarcode(barcode, options = {}) {
  const normalized = String(barcode || '').trim();
  if (!normalized) throw new Error('Barcode is required');
  return request(`${DISPATCH_BASE}/barcode/${encodeURIComponent(normalized)}`, { signal: options.signal });
}

export async function listDispatchChallans(params = {}, options = {}) {
  return request(`${DISPATCH_BASE}/challans${buildQuery(params)}`, { signal: options.signal });
}

export async function getDispatchChallan(id, options = {}) {
  if (!id) throw new Error('Challan id is required');
  return request(`${DISPATCH_BASE}/challans/${encodeURIComponent(id)}`, { signal: options.signal });
}

export async function createDispatchChallan(payload, { idempotencyKey } = {}) {
  return request(`${DISPATCH_BASE}/challans`, {
    method: 'POST',
    body: payload,
    headers: { 'Idempotency-Key': idempotencyKey || getIdempotencyKey('dispatch-challan') },
  });
}

export async function voidDispatchChallan(id, { reason, idempotencyKey } = {}) {
  return mutate(`${DISPATCH_BASE}/challans/${encodeURIComponent(id)}/void`, { reason }, idempotencyKey);
}

export async function correctDispatchLine(id, payload = {}, { idempotencyKey } = {}) {
  return mutate(`${DISPATCH_BASE}/lines/${encodeURIComponent(id)}/correct`, payload, idempotencyKey);
}

export async function returnDispatchLine(id, payload = {}, { idempotencyKey } = {}) {
  return mutate(`${DISPATCH_BASE}/lines/${encodeURIComponent(id)}/return`, payload, idempotencyKey);
}

export async function reverseDispatchEvent(id, payload = {}, { idempotencyKey } = {}) {
  return mutate(`${DISPATCH_BASE}/events/${encodeURIComponent(id)}/reverse`, payload, idempotencyKey);
}

export async function getDispatchChallanPdf(id, options = {}) {
  if (!id) throw new Error('Challan id is required');
  return requestBlob(`${DISPATCH_BASE}/challans/${encodeURIComponent(id)}/pdf`, options);
}

export async function exportDispatchV2(params = {}, options = {}) {
  return requestBlob(`${DISPATCH_BASE}/export${buildQuery(params)}`, options);
}
