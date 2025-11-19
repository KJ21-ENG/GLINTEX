// Auto-detect API base URL based on current host
const getApiBase = () => {
  // If explicitly set in env, use that
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  
  // Auto-detect from current window location
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  
  // Fallback for SSR or when window is not available
  return 'http://localhost:4000';
};

const BASE = getApiBase();

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
      message = parsed.error || parsed.message || message;
    } catch (_) {
      // not json, fall back to raw text
    }
    if (!message) message = `API ${method} ${path} failed with ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    if (parsed && typeof parsed === 'object') {
      error.details = parsed;
    }
    throw error;
  }
  if (res.status === 204) return null;
  return await res.json();
}

export async function health() { return await request('/api/health'); }
export async function getDB() { return await request('/api/db'); }
export async function createLot(payload) { return await request('/api/lots', { method: 'POST', body: payload }); }
export async function createIssueToCutterMachine(payload) { return await request('/api/issue_to_cutter_machine', { method: 'POST', body: payload }); }
export async function createIssueToMachine(payload) { return await createIssueToCutterMachine(payload); }
export async function importReceiveFromCutterMachine(payload) { return await request('/api/receive_from_cutter_machine/import', { method: 'POST', body: payload }); }
export async function previewReceiveFromCutterMachine(payload) { return await request('/api/receive_from_cutter_machine/preview', { method: 'POST', body: payload }); }
export async function manualReceiveFromCutterMachine(payload) { return await request('/api/receive_from_cutter_machine/manual', { method: 'POST', body: payload }); }
export async function getReceiveCrateStats(pieceId) {
  if (!pieceId) throw new Error('pieceId is required');
  return await request(`/api/receive_from_cutter_machine/piece/${encodeURIComponent(pieceId)}/crate_stats`);
}
export async function createIssueToHoloMachine(payload) { return await request('/api/issue_to_holo_machine', { method: 'POST', body: payload }); }
export async function createIssueToConingMachine(payload) { return await request('/api/issue_to_coning_machine', { method: 'POST', body: payload }); }
export async function manualReceiveFromHoloMachine(payload) { return await request('/api/receive_from_holo_machine/manual', { method: 'POST', body: payload }); }
export async function manualReceiveFromConingMachine(payload) { return await request('/api/receive_from_coning_machine/manual', { method: 'POST', body: payload }); }
export async function markPieceWastage(payload) { return await request('/api/receive_from_cutter_machine/mark_wastage', { method: 'POST', body: payload }); }
export async function importReceiveFromMachine(payload) { return await importReceiveFromCutterMachine(payload); }
export async function previewReceiveFromMachine(payload) { return await previewReceiveFromCutterMachine(payload); }
export async function manualReceiveFromMachine(payload) { return await manualReceiveFromCutterMachine(payload); }
export async function updateInboundItem(id, payload) { return await request(`/api/inbound_items/${id}`, { method: 'PUT', body: payload }); }
export async function listItems() { return await request('/api/items'); }
export async function createItem(name) { return await request('/api/items', { method: 'POST', body: { name } }); }
export async function deleteItem(id) { return await request(`/api/items/${id}`, { method: 'DELETE' }); }
export async function updateItem(id, name) { return await request(`/api/items/${id}`, { method: 'PUT', body: { name } }); }
export async function listYarns() { return await request('/api/yarns'); }
export async function createYarn(name) { return await request('/api/yarns', { method: 'POST', body: { name } }); }
export async function deleteYarn(id) { return await request(`/api/yarns/${id}`, { method: 'DELETE' }); }
export async function updateYarn(id, name) { return await request(`/api/yarns/${id}`, { method: 'PUT', body: { name } }); }
export async function listCuts() { return await request('/api/cuts'); }
export async function createCut(name) { return await request('/api/cuts', { method: 'POST', body: { name } }); }
export async function deleteCut(id) { return await request(`/api/cuts/${id}`, { method: 'DELETE' }); }
export async function updateCut(id, name) { return await request(`/api/cuts/${id}`, { method: 'PUT', body: { name } }); }
export async function listTwists() { return await request('/api/twists'); }
export async function createTwist(name) { return await request('/api/twists', { method: 'POST', body: { name } }); }
export async function deleteTwist(id) { return await request(`/api/twists/${id}`, { method: 'DELETE' }); }
export async function updateTwist(id, name) { return await request(`/api/twists/${id}`, { method: 'PUT', body: { name } }); }
export async function listFirms() { return await request('/api/firms'); }
export async function createFirm(name) { return await request('/api/firms', { method: 'POST', body: { name } }); }
export async function deleteFirm(id) { return await request(`/api/firms/${id}`, { method: 'DELETE' }); }
export async function updateFirm(id, name) { return await request(`/api/firms/${id}`, { method: 'PUT', body: { name } }); }
export async function listSuppliers() { return await request('/api/suppliers'); }
export async function createSupplier(name) { return await request('/api/suppliers', { method: 'POST', body: { name } }); }
export async function deleteSupplier(id) { return await request(`/api/suppliers/${id}`, { method: 'DELETE' }); }
export async function updateSupplier(id, name) { return await request(`/api/suppliers/${id}`, { method: 'PUT', body: { name } }); }
export async function listMachines() { return await request('/api/machines'); }
export async function createMachine(name) { return await request('/api/machines', { method: 'POST', body: { name } }); }
export async function deleteMachine(id) { return await request(`/api/machines/${id}`, { method: 'DELETE' }); }
export async function updateMachine(id, name) { return await request(`/api/machines/${id}`, { method: 'PUT', body: { name } }); }
export async function listOperators() { return await request('/api/operators'); }
export async function createOperator(name, role = 'operator') { return await request('/api/operators', { method: 'POST', body: { name, role } }); }
export async function deleteOperator(id) { return await request(`/api/operators/${id}`, { method: 'DELETE' }); }
export async function updateOperator(id, name, role) { return await request(`/api/operators/${id}`, { method: 'PUT', body: { name, role } }); }
export async function listBobbins() { return await request('/api/bobbins'); }
export async function createBobbin(name, weight) { return await request('/api/bobbins', { method: 'POST', body: { name, weight } }); }
export async function deleteBobbin(id) { return await request(`/api/bobbins/${id}`, { method: 'DELETE' }); }
export async function updateBobbin(id, name, weight) { return await request(`/api/bobbins/${id}`, { method: 'PUT', body: { name, weight } }); }
export async function listBoxes() { return await request('/api/boxes'); }
export async function createBox(name, weight) { return await request('/api/boxes', { method: 'POST', body: { name, weight } }); }
export async function deleteBox(id) { return await request(`/api/boxes/${id}`, { method: 'DELETE' }); }
export async function updateBox(id, name, weight) { return await request(`/api/boxes/${id}`, { method: 'PUT', body: { name, weight } }); }
export async function updateSettings(payload) { return await request('/api/settings', { method: 'PUT', body: payload }); }
export async function deleteLot(lotNo) { return await request(`/api/lots/${lotNo}`, { method: 'DELETE' }); }
export async function deleteIssueToCutterMachine(id) { return await request(`/api/issue_to_cutter_machine/${id}`, { method: 'DELETE' }); }
export async function deleteIssueToMachine(id) { return await deleteIssueToCutterMachine(id); }
export async function deleteInboundItem(id) { return await request(`/api/inbound_items/${id}`, { method: 'DELETE' }); }
export async function getInboundByBarcode(code) { return await request(`/api/inbound_items/barcode/${encodeURIComponent(code)}`); }
export async function getIssueByCutterBarcode(code) { return await request(`/api/issue_to_cutter_machine/lookup?barcode=${encodeURIComponent(code)}`); }
export async function getIssueByBarcode(code) { return await getIssueByCutterBarcode(code); }

export function barcodeImageUrl(code, options = {}) {
  if (!code) return '';
  const params = new URLSearchParams({ code });
  if (options.scale) params.set('scale', String(options.scale));
  if (options.height) params.set('height', String(options.height));
  return `${BASE}/api/barcodes/render?${params.toString()}`;
}
export async function whatsappStatus() { return await request('/api/whatsapp/status'); }
export async function whatsappStart() { return await request('/api/whatsapp/start', { method: 'POST' }); }
export async function whatsappQr() { return await request('/api/whatsapp/qrcode'); }
export async function whatsappLogout() { return await request('/api/whatsapp/logout', { method: 'POST' }); }
export async function whatsappSendTest(number) { return await request('/api/whatsapp/send-test', { method: 'POST', body: { number } }); }
export async function listWhatsappTemplates() { return await request('/api/whatsapp/templates'); }
export async function updateWhatsappTemplate(event, body) { return await request(`/api/whatsapp/templates/${event}`, { method: 'PUT', body }); }
export async function sendWhatsappEvent(event, payload) { return await request('/api/whatsapp/send-event', { method: 'POST', body: { event, payload } }); }
export async function whatsappGroups() { return await request('/api/whatsapp/groups'); }

export default {
  health,
  getDB,
  createLot,
  createIssueToMachine,
  createIssueToCutterMachine,
  createIssueToHoloMachine,
  createIssueToConingMachine,
  importReceiveFromMachine,
  previewReceiveFromMachine,
  manualReceiveFromMachine,
  manualReceiveFromHoloMachine,
  manualReceiveFromConingMachine,
  getReceiveCrateStats,
  markPieceWastage,
  updateInboundItem,
  deleteLot,
  deleteIssueToMachine,
  deleteIssueToCutterMachine,
  listItems,
  createItem,
  deleteItem,
  updateItem,
  listYarns,
  createYarn,
  deleteYarn,
  updateYarn,
  listCuts,
  createCut,
  deleteCut,
  updateCut,
  listTwists,
  createTwist,
  deleteTwist,
  updateTwist,
  listFirms,
  createFirm,
  deleteFirm,
  updateFirm,
  listSuppliers,
  createSupplier,
  deleteSupplier,
  updateSupplier,
  listMachines,
  createMachine,
  deleteMachine,
  updateMachine,
  listOperators,
  createOperator,
  deleteOperator,
  updateOperator,
  listBoxes,
  createBox,
  deleteBox,
  updateBox,
  updateSettings,
  getInboundByBarcode,
  getIssueByBarcode,
  getIssueByCutterBarcode,
  barcodeImageUrl,
};
