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

async function request(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
    }
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
export async function getLotSequenceNext() { return await request('/api/sequence/next'); }
export async function getOpeningLotSequenceNext() { return await request('/api/opening_stock/sequence/next'); }

// Auth
export async function authStatus() { return await request('/api/auth/status'); }
export async function authMe() { return await request('/api/auth/me'); }
export async function authLogin(username, password) { return await request('/api/auth/login', { method: 'POST', body: { username, password } }); }
export async function authBootstrap({ bootstrapToken, username, password, displayName }) {
  return await request('/api/auth/bootstrap', { method: 'POST', body: { bootstrapToken, username, password, displayName } });
}
export async function authLogout() { return await request('/api/auth/logout', { method: 'POST' }); }

// Admin (roles/users)
export async function listAdminRoles() { return await request('/api/admin/roles'); }
export async function createAdminRole({ key, name, description }) {
  return await request('/api/admin/roles', { method: 'POST', body: { key, name, description } });
}
export async function updateAdminRole(id, { name, description }) {
  return await request(`/api/admin/roles/${id}`, { method: 'PUT', body: { name, description } });
}
export async function listAdminUsers() { return await request('/api/admin/users'); }
export async function createAdminUser({ username, displayName, password, roleId, isActive }) {
  return await request('/api/admin/users', { method: 'POST', body: { username, displayName, password, roleId, isActive } });
}
export async function updateAdminUser(id, { displayName, roleId, isActive }) {
  return await request(`/api/admin/users/${id}`, { method: 'PUT', body: { displayName, roleId, isActive } });
}
export async function resetAdminUserPassword(id, password) {
  return await request(`/api/admin/users/${id}/password`, { method: 'PUT', body: { password } });
}
export async function createLot(payload) { return await request('/api/lots', { method: 'POST', body: payload }); }
export async function createIssueToCutterMachine(payload) { return await request('/api/issue_to_cutter_machine', { method: 'POST', body: payload }); }
export async function createIssueToMachine(payload) { return await createIssueToCutterMachine(payload); }
export async function importReceiveFromCutterMachine(payload) { return await request('/api/receive_from_cutter_machine/import', { method: 'POST', body: payload }); }
export async function previewReceiveFromCutterMachine(payload) { return await request('/api/receive_from_cutter_machine/preview', { method: 'POST', body: payload }); }
export async function manualReceiveFromCutterMachine(payload) { return await request('/api/receive_from_cutter_machine/manual', { method: 'POST', body: payload }); }
export async function createCutterReceiveChallan(payload) { return await request('/api/receive_from_cutter_machine/bulk', { method: 'POST', body: payload }); }
export async function getCutterReceiveChallan(id) { return await request(`/api/receive_from_cutter_machine/challans/${encodeURIComponent(id)}`); }
export async function updateCutterReceiveChallan(id, payload) { return await request(`/api/receive_from_cutter_machine/challans/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }); }
export async function deleteCutterReceiveChallan(id, payload = {}) { return await request(`/api/receive_from_cutter_machine/challans/${encodeURIComponent(id)}`, { method: 'DELETE', body: payload }); }
export async function getReceiveCrateStats(pieceId) {
  if (!pieceId) throw new Error('pieceId is required');
  return await request(`/api/receive_from_cutter_machine/piece/${encodeURIComponent(pieceId)}/crate_stats`);
}
export async function createIssueToHoloMachine(payload) { return await request('/api/issue_to_holo_machine', { method: 'POST', body: payload }); }
export async function createIssueToConingMachine(payload) { return await request('/api/issue_to_coning_machine', { method: 'POST', body: payload }); }
export async function createOpeningInbound(payload) { return await request('/api/opening_stock/inbound', { method: 'POST', body: payload }); }
export async function createOpeningCutterReceive(payload) { return await request('/api/opening_stock/cutter_receive', { method: 'POST', body: payload }); }
export async function uploadOpeningStock(stage, payload) { return await request(`/api/opening_stock/upload/${stage}`, { method: 'POST', body: payload }); }
export async function previewOpeningStock(stage, payload) { return await request(`/api/opening_stock/preview/${stage}`, { method: 'POST', body: payload }); }
export async function createOpeningHoloReceive(payload) { return await request('/api/opening_stock/holo_receive', { method: 'POST', body: payload }); }
export async function createOpeningConingReceive(payload) { return await request('/api/opening_stock/coning_receive', { method: 'POST', body: payload }); }
export async function deleteOpeningCutterReceiveRow(id) { return await request(`/api/opening_stock/cutter_receive_rows/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function deleteOpeningHoloReceiveRow(id) { return await request(`/api/opening_stock/holo_receive_rows/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function deleteOpeningConingReceiveRow(id) { return await request(`/api/opening_stock/coning_receive_rows/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
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
export async function createFirm(name, address, mobile) { return await request('/api/firms', { method: 'POST', body: { name, address, mobile } }); }
export async function deleteFirm(id) { return await request(`/api/firms/${id}`, { method: 'DELETE' }); }
export async function updateFirm(id, name, address, mobile) { return await request(`/api/firms/${id}`, { method: 'PUT', body: { name, address, mobile } }); }
export async function listSuppliers() { return await request('/api/suppliers'); }
export async function createSupplier(name) { return await request('/api/suppliers', { method: 'POST', body: { name } }); }
export async function deleteSupplier(id) { return await request(`/api/suppliers/${id}`, { method: 'DELETE' }); }
export async function updateSupplier(id, name) { return await request(`/api/suppliers/${id}`, { method: 'PUT', body: { name } }); }
export async function listMachines() { return await request('/api/machines'); }
export async function createMachine(name, processType = 'all') { return await request('/api/machines', { method: 'POST', body: { name, processType } }); }
export async function deleteMachine(id) { return await request(`/api/machines/${id}`, { method: 'DELETE' }); }
export async function updateMachine(id, name, processType) { return await request(`/api/machines/${id}`, { method: 'PUT', body: { name, processType } }); }
export async function listOperators() { return await request('/api/operators'); }
export async function createOperator(name, role = 'operator', processType = 'all') { return await request('/api/operators', { method: 'POST', body: { name, role, processType } }); }
export async function deleteOperator(id) { return await request(`/api/operators/${id}`, { method: 'DELETE' }); }
export async function updateOperator(id, name, role, processType) { return await request(`/api/operators/${id}`, { method: 'PUT', body: { name, role, processType } }); }
export async function listBobbins() { return await request('/api/bobbins'); }
export async function createBobbin(name, weight) { return await request('/api/bobbins', { method: 'POST', body: { name, weight } }); }
export async function deleteBobbin(id) { return await request(`/api/bobbins/${id}`, { method: 'DELETE' }); }
export async function updateBobbin(id, name, weight) { return await request(`/api/bobbins/${id}`, { method: 'PUT', body: { name, weight } }); }
export async function listRollTypes() { return await request('/api/roll_types'); }
export async function createRollType(name, weight) { return await request('/api/roll_types', { method: 'POST', body: { name, weight } }); }
export async function deleteRollType(id) { return await request(`/api/roll_types/${id}`, { method: 'DELETE' }); }
export async function updateRollType(id, name, weight) { return await request(`/api/roll_types/${id}`, { method: 'PUT', body: { name, weight } }); }
export async function listConeTypes() { return await request('/api/cone_types'); }
export async function createConeType(name, weight) { return await request('/api/cone_types', { method: 'POST', body: { name, weight } }); }
export async function deleteConeType(id) { return await request(`/api/cone_types/${id}`, { method: 'DELETE' }); }
export async function updateConeType(id, name, weight) { return await request(`/api/cone_types/${id}`, { method: 'PUT', body: { name, weight } }); }
export async function listWrappers() { return await request('/api/wrappers'); }
export async function createWrapper(name) { return await request('/api/wrappers', { method: 'POST', body: { name } }); }
export async function deleteWrapper(id) { return await request(`/api/wrappers/${id}`, { method: 'DELETE' }); }
export async function updateWrapper(id, name) { return await request(`/api/wrappers/${id}`, { method: 'PUT', body: { name } }); }
export async function listBoxes() { return await request('/api/boxes'); }
export async function createBox(name, weight, processType = 'all') { return await request('/api/boxes', { method: 'POST', body: { name, weight, processType } }); }
export async function deleteBox(id) { return await request(`/api/boxes/${id}`, { method: 'DELETE' }); }
export async function updateBox(id, name, weight, processType) { return await request(`/api/boxes/${id}`, { method: 'PUT', body: { name, weight, processType } }); }
export async function updateSettings(payload) { return await request('/api/settings', { method: 'PUT', body: payload }); }
export async function deleteLot(lotNo) { return await request(`/api/lots/${lotNo}`, { method: 'DELETE' }); }
export async function deleteIssueToCutterMachine(id) { return await request(`/api/issue_to_cutter_machine/${id}`, { method: 'DELETE' }); }
export async function deleteIssueToHoloMachine(id) { return await request(`/api/issue_to_holo_machine/${id}`, { method: 'DELETE' }); }
export async function deleteIssueToConingMachine(id) { return await request(`/api/issue_to_coning_machine/${id}`, { method: 'DELETE' }); }
export async function deleteIssueToMachine(id, process = 'cutter') {
  if (process === 'holo') return await deleteIssueToHoloMachine(id);
  if (process === 'coning') return await deleteIssueToConingMachine(id);
  return await deleteIssueToCutterMachine(id);
}
export async function deleteInboundItem(id) { return await request(`/api/inbound_items/${id}`, { method: 'DELETE' }); }
export async function getInboundByBarcode(code) { return await request(`/api/inbound_items/barcode/${encodeURIComponent(code)}`); }
export async function getIssueByCutterBarcode(code) { return await request(`/api/issue_to_cutter_machine/lookup?barcode=${encodeURIComponent(code)}`); }
export async function getIssueByBarcode(code) { return await getIssueByCutterBarcode(code); }
export async function getIssueByHoloBarcode(code) { return await request(`/api/issue_to_holo_machine/lookup?barcode=${encodeURIComponent(code)}`); }

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

// Backups
export async function listBackups() { return await request('/api/backups'); }
export async function createBackup() { return await request('/api/backups', { method: 'POST' }); }
export function downloadBackupUrl(filename) { return `${BASE}/api/backups/${encodeURIComponent(filename)}/download`; }

// Google Drive
export async function googleDriveStatus() { return await request('/api/google-drive/status'); }
export async function googleDriveConnect() { return await request('/api/google-drive/connect', { method: 'POST' }); }
export async function googleDriveDisconnect() { return await request('/api/google-drive/disconnect', { method: 'POST' }); }
export async function googleDriveFiles() { return await request('/api/google-drive/files'); }

// Disk Usage
export async function getDiskUsage() { return await request('/api/disk-usage'); }

// Customers
export async function listCustomers() { return await request('/api/customers'); }
export async function createCustomer(data) { return await request('/api/customers', { method: 'POST', body: data }); }
export async function updateCustomer(id, data) { return await request(`/api/customers/${id}`, { method: 'PUT', body: data }); }
export async function deleteCustomer(id) { return await request(`/api/customers/${id}`, { method: 'DELETE' }); }

// Dispatch
export async function listDispatches(params = {}) {
  const query = new URLSearchParams(params).toString();
  return await request(`/api/dispatch${query ? '?' + query : ''}`);
}
export async function getDispatch(id) { return await request(`/api/dispatch/${id}`); }
export async function createDispatch(data) { return await request('/api/dispatch', { method: 'POST', body: data }); }
export async function deleteDispatch(id) { return await request(`/api/dispatch/${id}`, { method: 'DELETE' }); }
export async function getDispatchAvailable(stage) { return await request(`/api/dispatch/available/${stage}`); }

// Reports
export async function getBarcodeHistory(barcode) { return await request(`/api/reports/barcode-history/${encodeURIComponent(barcode)}`); }
export async function getProductionReport(params = {}) {
  const query = new URLSearchParams(params).toString();
  return await request(`/api/reports/production${query ? '?' + query : ''}`);
}

export default {
  health,
  getDB,
  getLotSequenceNext,
  getOpeningLotSequenceNext,
  authStatus,
  authMe,
  authLogin,
  authBootstrap,
  authLogout,
  listAdminRoles,
  createAdminRole,
  updateAdminRole,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  resetAdminUserPassword,
  createLot,
  createIssueToMachine,
  createIssueToCutterMachine,
  createIssueToHoloMachine,
  createIssueToConingMachine,
  createOpeningInbound,
  createOpeningCutterReceive,
  createOpeningHoloReceive,
  createOpeningConingReceive,
  importReceiveFromMachine,
  previewReceiveFromMachine,
  manualReceiveFromMachine,
  manualReceiveFromHoloMachine,
  manualReceiveFromConingMachine,
  createCutterReceiveChallan,
  getCutterReceiveChallan,
  updateCutterReceiveChallan,
  deleteCutterReceiveChallan,
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
  listRollTypes,
  createRollType,
  deleteRollType,
  updateRollType,
  listBoxes,
  createBox,
  deleteBox,
  updateBox,
  listConeTypes,
  createConeType,
  deleteConeType,
  updateConeType,
  listWrappers,
  createWrapper,
  deleteWrapper,
  updateWrapper,
  updateSettings,
  getInboundByBarcode,
  getIssueByBarcode,
  getIssueByCutterBarcode,
  getIssueByHoloBarcode,
  barcodeImageUrl,
};
