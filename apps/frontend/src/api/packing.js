import { createIdempotencyKey } from './packingRequest';

const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
};

const BASE = getApiBase();

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
      return;
    }
    query.set(key, value);
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

async function request(path, { method = 'GET', body, headers = {}, idempotencyKey } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    requestHeaders['Idempotency-Key'] = idempotencyKey || createIdempotencyKey();
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
    }

    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (_) {
      // Keep the raw response as a fallback for non-JSON server failures.
    }

    const error = new Error(
      parsed?.message || parsed?.error || raw || `API ${method} ${path} failed with ${response.status}`,
    );
    error.status = response.status;
    error.code = parsed?.error || null;
    error.details = parsed?.details || null;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

function mutate(path, method = 'POST', body, options = {}) {
  return request(path, {
    method,
    body,
    idempotencyKey: options.idempotencyKey,
    headers: options.headers,
  });
}

const encode = (value) => encodeURIComponent(String(value));

// Packing masters
export async function listPackingColors(params = {}) {
  return request(`/api/packing/colors${queryString(params)}`);
}

export async function createPackingColor(payload, options = {}) {
  return mutate('/api/packing/colors', 'POST', payload, options);
}

export async function updatePackingColor(id, payload, options = {}) {
  return mutate(`/api/packing/colors/${encode(id)}`, 'PUT', payload, options);
}

export async function listPackingPackageTypes(params = {}) {
  return request(`/api/packing/package-types${queryString(params)}`);
}

export async function createPackingPackageType(payload, options = {}) {
  return mutate('/api/packing/package-types', 'POST', payload, options);
}

export async function updatePackingPackageType(id, payload, options = {}) {
  return mutate(`/api/packing/package-types/${encode(id)}`, 'PUT', payload, options);
}

// Recipes
export async function listPackingRecipes(params = {}) {
  return request(`/api/packing/recipes${queryString(params)}`);
}

export async function createPackingRecipe(payload, options = {}) {
  return mutate('/api/packing/recipes', 'POST', payload, options);
}

export async function getPackingRecipe(id) {
  return request(`/api/packing/recipes/${encode(id)}`);
}

export async function updatePackingRecipe(id, payload, options = {}) {
  return mutate(`/api/packing/recipes/${encode(id)}`, 'PUT', payload, options);
}

export async function activatePackingRecipe(id, payload = {}, options = {}) {
  return mutate(`/api/packing/recipes/${encode(id)}/activate`, 'POST', payload, options);
}

export async function retirePackingRecipe(id, payload = {}, options = {}) {
  return mutate(`/api/packing/recipes/${encode(id)}/retire`, 'POST', payload, options);
}

// Batches and sources
export async function listPackingBatches(params = {}) {
  return request(`/api/packing/batches${queryString(params)}`);
}

export async function createPackingBatch(payload, options = {}) {
  return mutate('/api/packing/batches', 'POST', payload, options);
}

export async function getPackingBatch(id) {
  return request(`/api/packing/batches/${encode(id)}`);
}

export async function getPackingBatchHistory(id, params = {}) {
  return request(`/api/packing/batches/${encode(id)}/history${queryString({ limit: params.limit ?? 25, cursor: params.cursor })}`);
}

export async function updatePackingBatch(id, payload, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}`, 'PUT', payload, options);
}

export async function confirmPackingBatch(id, payload = {}, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}/confirm`, 'POST', payload, options);
}

export async function startPackingBatch(id, payload = {}, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}/start`, 'POST', payload, options);
}

export async function amendPackingBatchTarget(id, payload, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}/amend-target`, 'POST', payload, options);
}

export async function shortClosePackingBatch(id, payload, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}/short-close`, 'POST', payload, options);
}

export async function voidPackingBatch(id, payload, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}/void`, 'POST', payload, options);
}

export async function reservePackingBatchSources(id, payload, options = {}) {
  return mutate(`/api/packing/batches/${encode(id)}/sources/reserve`, 'POST', payload, options);
}

export async function createPackingUnit(batchId, payload, options = {}) {
  return mutate(`/api/packing/batches/${encode(batchId)}/units`, 'POST', payload, options);
}

// Packed-unit lifecycle
export async function sealPackingUnit(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/seal`, 'POST', payload, options);
}

export async function reprintPackingUnitLabel(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/reprint-label`, 'POST', payload, options);
}

export async function replacePackingUnitBarcode(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/replace-barcode`, 'POST', payload, options);
}

export async function releasePackingUnitQuality(id, payload = {}, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/release-quality`, 'POST', payload, options);
}

export async function returnPackingUnit(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/return`, 'POST', payload, options);
}

export async function inspectPackingUnitReturn(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/inspect-return`, 'POST', payload, options);
}

export async function damagePackingUnit(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/damage`, 'POST', payload, options);
}

export async function writeOffPackingUnit(id, payload, options = {}) {
  return mutate(`/api/packing/units/${encode(id)}/write-off`, 'POST', payload, options);
}

export async function createPackingRepackingBatch(payload, options = {}) {
  return mutate('/api/packing/repacking-batches', 'POST', payload, options);
}

export async function getPackingLaunchState() {
  return request('/api/packing-launch-state');
}

export { createIdempotencyKey };
