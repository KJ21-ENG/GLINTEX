const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
};

const API_BASE = getApiBase();
const PACKED_STOCK_BASE = '/api/packed-stock';

function escapeTsplText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

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

function getIdempotencyKey(prefix = 'packed-stock') {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
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

async function mutate(path, body, idempotencyKey) {
  const key = idempotencyKey || getIdempotencyKey();
  return request(path, {
    method: 'POST',
    body: body || {},
    headers: { 'Idempotency-Key': key },
  });
}

export async function listPackedStock(params = {}, options = {}) {
  return request(`${PACKED_STOCK_BASE}${buildQuery(params)}`, { signal: options.signal });
}

export async function getPackedStockUnit(id, options = {}) {
  if (!id) throw new Error('Packed Stock unit id is required');
  return request(`${PACKED_STOCK_BASE}/${encodeURIComponent(id)}`, { signal: options.signal });
}

export async function getPackedStockByBarcode(barcode, options = {}) {
  const normalized = String(barcode || '').trim();
  if (!normalized) throw new Error('Barcode is required');
  return request(`${PACKED_STOCK_BASE}/barcode/${encodeURIComponent(normalized)}`, { signal: options.signal });
}

export async function getPackedStockUnitHistory(id, params = {}, options = {}) {
  if (!id) throw new Error('Packed Stock unit id is required');
  return request(
    `${PACKED_STOCK_BASE}/${encodeURIComponent(id)}/history${buildQuery({ limit: params.limit ?? 25, cursor: params.cursor })}`,
    { signal: options.signal }
  );
}

export async function reservePackedStockUnit(id, { customerId, reason, idempotencyKey } = {}) {
  return mutate(`${PACKED_STOCK_BASE}/${encodeURIComponent(id)}/reserve`, { customerId, reason }, idempotencyKey);
}

export async function releasePackedStockReservation(id, { reason, idempotencyKey } = {}) {
  return mutate(`${PACKED_STOCK_BASE}/${encodeURIComponent(id)}/release-reservation`, { reason }, idempotencyKey);
}

export async function reassignPackedStockReservation(id, { customerId, reason, idempotencyKey } = {}) {
  return mutate(
    `${PACKED_STOCK_BASE}/${encodeURIComponent(id)}/reassign-reservation`,
    { customerId, reason },
    idempotencyKey
  );
}

export async function reprintPackedStockLabel(id, { reason, idempotencyKey } = {}) {
  return mutate(
    `/api/packing/units/${encodeURIComponent(id)}/reprint-label`,
    { reason },
    idempotencyKey
  );
}

export async function replacePackedStockBarcode(id, { reason, idempotencyKey } = {}) {
  const replacementKey = idempotencyKey || getIdempotencyKey('packed-stock-barcode');
  const replacement = await mutate(
    `/api/packing/units/${encodeURIComponent(id)}/replace-barcode`,
    { generate: true, reason },
    replacementKey
  );
  const replacementUnit = replacement?.replacementUnit || replacement?.unit || null;
  if (!replacementUnit?.id) return replacement;

  // The barcode-replacement mutation creates the new identity but does not
  // itself return a label DTO. Ask the authoritative server label path for the
  // replacement identity before the browser attempts physical printing.
  const labelResult = await mutate(
    `/api/packing/units/${encodeURIComponent(replacementUnit.id)}/reprint-label`,
    { reason: `Physical label after barcode replacement: ${reason}` },
    `${replacementKey}:label`
  );
  return {
    ...replacement,
    unit: labelResult?.unit || replacementUnit,
    replacementUnit: labelResult?.unit || replacementUnit,
    label: labelResult?.label || null,
    labelPending: labelResult?.labelPending === true || labelResult?.unit?.status === 'LABEL_PENDING',
    labelResponse: labelResult,
  };
}

export function buildPackedStockLabelTspl(label) {
  const barcodeValue = String(label?.barcode || '').trim();
  const itemName = String(label?.itemName || '').trim();
  const baseCount = Number(label?.baseCount);
  if (!barcodeValue || !itemName || !Number.isInteger(baseCount) || baseCount <= 0) return '';
  const safeBarcode = escapeTsplText(barcodeValue);
  const safeItemName = escapeTsplText(itemName);
  return [
    'SIZE 60 mm,40 mm',
    'GAP 2 mm,0',
    'DIRECTION 1',
    'CLS',
    `BARCODE 32,24,"128",72,1,0,2,2,"${safeBarcode}"`,
    `TEXT 32,112,"0",0,1,1,"${safeItemName}"`,
    `TEXT 32,140,"0",0,1,1,"${baseCount}"`,
    'PRINT 1,1',
    '',
  ].join('\r\n');
}

export async function printPackedStockLabel(label, options = {}) {
  const content = buildPackedStockLabelTspl(label);
  if (!content) {
    return { success: false, labelPending: true, error: 'LABEL_PENDING: the authoritative label DTO is incomplete.' };
  }
  const { getPreferredPrinter, sendToLocalPrinter } = await import('../utils/labelPrint');
  return sendToLocalPrinter({
    printer: options.printer || getPreferredPrinter(),
    content,
    type: 'raw',
    serviceBase: options.serviceBase,
    encoding: 'text',
  });
}

export { getIdempotencyKey };
