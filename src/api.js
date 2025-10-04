const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.error || parsed.message || message;
    } catch (_) {
      // not json, fall back to raw text
    }
    if (!message) message = `API ${method} ${path} failed with ${res.status}`;
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return await res.json();
}

export async function health() { return await request('/api/health'); }
export async function getDB() { return await request('/api/db'); }
export async function createLot(payload) { return await request('/api/lots', { method: 'POST', body: payload }); }
export async function issuePieces(payload) { return await request('/api/consumptions', { method: 'POST', body: payload }); }
export async function updateInboundItem(id, payload) { return await request(`/api/inbound_items/${id}`, { method: 'PUT', body: payload }); }
export async function listItems() { return await request('/api/items'); }
export async function createItem(name) { return await request('/api/items', { method: 'POST', body: { name } }); }
export async function deleteItem(id) { return await request(`/api/items/${id}`, { method: 'DELETE' }); }
export async function listFirms() { return await request('/api/firms'); }
export async function createFirm(name) { return await request('/api/firms', { method: 'POST', body: { name } }); }
export async function deleteFirm(id) { return await request(`/api/firms/${id}`, { method: 'DELETE' }); }
export async function listSuppliers() { return await request('/api/suppliers'); }
export async function createSupplier(name) { return await request('/api/suppliers', { method: 'POST', body: { name } }); }
export async function deleteSupplier(id) { return await request(`/api/suppliers/${id}`, { method: 'DELETE' }); }
export async function updateSettings(payload) { return await request('/api/settings', { method: 'PUT', body: payload }); }

export default {
  health,
  getDB,
  createLot,
  issuePieces,
  updateInboundItem,
  listItems,
  createItem,
  deleteItem,
  listFirms,
  createFirm,
  deleteFirm,
  listSuppliers,
  createSupplier,
  deleteSupplier,
  updateSettings,
};
