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

// Send FormData (for file uploads)
async function requestFormData(path, formData) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('glintex:auth:unauthorized'));
    }
    const raw = await res.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.error || parsed.message || message;
    } catch (_) { }
    if (!message) message = `API POST ${path} failed with ${res.status}`;
    throw new Error(message);
  }
  return await res.json();
}

// Optional wrapper for future mutation flows that need a single success hook.
// Keeps endpoint signatures unchanged while standardizing post-mutation side-effects.
export async function runMutationWithSuccess(mutationFn, onSuccess) {
  if (typeof mutationFn !== 'function') throw new Error('mutationFn must be a function');
  const result = await mutationFn();
  if (typeof onSuccess === 'function') {
    await onSuccess(result);
  }
  return result;
}

export async function health() { return await request('/api/health'); }
export async function getDB() { return await request('/api/db'); }
export async function getBootstrap() { return await request('/api/bootstrap'); }
export async function getModuleInbound() { return await request('/api/module/inbound'); }
export async function getModuleProcess(process, options = {}) {
  const params = new URLSearchParams();
  if (options.full) params.set('full', 'true');
  const qs = params.toString();
  return await request(`/api/module/process/${process}${qs ? `?${qs}` : ''}`);
}
export async function getModuleOpeningStock() { return await request('/api/module/opening_stock'); }
export async function getLotSequenceNext() { return await request('/api/sequence/next'); }
export async function getOpeningLotSequenceNext() { return await request('/api/opening_stock/sequence/next'); }
export async function getCutterPurchaseSequenceNext() { return await request('/api/inbound/cutter_purchase/sequence/next'); }
export async function reserveCutterPurchaseLot() { return await request('/api/inbound/cutter_purchase/reserve', { method: 'POST' }); }
export async function logWeightCapture(payload) { return await request('/api/weight_capture', { method: 'POST', body: payload }); }
export async function getCutterPurchaseLot(lotNo) {
  if (!lotNo) throw new Error('lotNo is required');
  return await request(`/api/inbound/cutter_purchase/${encodeURIComponent(lotNo)}`);
}
export async function updateCutterPurchaseLot(lotNo, payload) {
  if (!lotNo) throw new Error('lotNo is required');
  return await request(`/api/inbound/cutter_purchase/${encodeURIComponent(lotNo)}`, { method: 'PUT', body: payload });
}
export async function deleteCutterPurchaseLot(lotNo) {
  if (!lotNo) throw new Error('lotNo is required');
  return await request(`/api/inbound/cutter_purchase/${encodeURIComponent(lotNo)}`, { method: 'DELETE' });
}
export async function reserveOpeningIssueSeries(stage) {
  return await request('/api/opening_stock/issue_series/reserve', { method: 'POST', body: { stage } });
}

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
export async function createAdminRole({ key, name, description, permissions }) {
  return await request('/api/admin/roles', { method: 'POST', body: { key, name, description, permissions } });
}
export async function updateAdminRole(id, { name, description, permissions }) {
  return await request(`/api/admin/roles/${id}`, { method: 'PUT', body: { name, description, permissions } });
}
export async function listAdminUsers() { return await request('/api/admin/users'); }
export async function createAdminUser({ username, displayName, password, roleIds, isActive }) {
  return await request('/api/admin/users', { method: 'POST', body: { username, displayName, password, roleIds, isActive } });
}
export async function updateAdminUser(id, { displayName, roleIds, isActive }) {
  return await request(`/api/admin/users/${id}`, { method: 'PUT', body: { displayName, roleIds, isActive } });
}
export async function resetAdminUserPassword(id, password) {
  return await request(`/api/admin/users/${id}/password`, { method: 'PUT', body: { password } });
}
export async function createLot(payload) { return await request('/api/lots', { method: 'POST', body: payload }); }
export async function createCutterPurchaseInbound(payload) {
  return await request('/api/inbound/cutter_purchase', { method: 'POST', body: payload });
}
export async function createIssueToCutterMachine(payload) { return await request('/api/issue_to_cutter_machine', { method: 'POST', body: payload }); }
export async function createIssueToMachine(payload) { return await createIssueToCutterMachine(payload); }
export async function createIssueTakeBack(process, issueId, payload) {
  const stage = String(process || '').toLowerCase();
  const encodedId = encodeURIComponent(issueId);
  if (stage === 'holo') return await request(`/api/issue_to_holo_machine/${encodedId}/take_back`, { method: 'POST', body: payload });
  if (stage === 'coning') return await request(`/api/issue_to_coning_machine/${encodedId}/take_back`, { method: 'POST', body: payload });
  return await request(`/api/issue_to_cutter_machine/${encodedId}/take_back`, { method: 'POST', body: payload });
}
export async function reverseIssueTakeBack(takeBackId, payload = {}) {
  return await request(`/api/issue_take_backs/${encodeURIComponent(takeBackId)}/reverse`, { method: 'POST', body: payload });
}
export async function getIssueTakeBacks(params = {}) {
  const qs = new URLSearchParams();
  if (params.stage) qs.set('stage', params.stage);
  if (params.issueId) qs.set('issueId', params.issueId);
  const suffix = qs.toString();
  return await request(`/api/issue_take_backs${suffix ? `?${suffix}` : ''}`);
}
export async function updateIssueToCutterMachine(id, payload) {
  return await request(`/api/issue_to_cutter_machine/${id}`, { method: 'PUT', body: payload });
}
export async function updateIssueToHoloMachine(id, payload) {
  return await request(`/api/issue_to_holo_machine/${id}`, { method: 'PUT', body: payload });
}
export async function updateIssueToConingMachine(id, payload) {
  return await request(`/api/issue_to_coning_machine/${id}`, { method: 'PUT', body: payload });
}
export async function updateIssueToMachine(id, process = 'cutter', payload) {
  if (process === 'holo') return await updateIssueToHoloMachine(id, payload);
  if (process === 'coning') return await updateIssueToConingMachine(id, payload);
  return await updateIssueToCutterMachine(id, payload);
}
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
export async function updateHoloReceiveRow(id, payload) {
  return await request(`/api/receive_from_holo_machine/rows/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
}
export async function deleteHoloReceiveRow(id, payload) {
  return await request(`/api/receive_from_holo_machine/rows/${encodeURIComponent(id)}`, { method: 'DELETE', body: payload });
}
export async function updateConingReceiveRow(id, payload) {
  return await request(`/api/receive_from_coning_machine/rows/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
}
export async function deleteConingReceiveRow(id, payload) {
  return await request(`/api/receive_from_coning_machine/rows/${encodeURIComponent(id)}`, { method: 'DELETE', body: payload });
}
export async function markPieceWastage(payload) { return await request('/api/receive_from_cutter_machine/mark_wastage', { method: 'POST', body: payload }); }
export async function markConingWastage(issueId) { return await request('/api/receive_from_coning_machine/mark_wastage', { method: 'POST', body: { issueId } }); }
export async function sendDocument(formData) { return await requestFormData('/api/documents/send', formData); }
export async function getDocumentHistory() { return await request('/api/documents/history'); }
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
export async function createMachine(name, processType = 'all', spindle = null) { return await request('/api/machines', { method: 'POST', body: { name, processType, spindle } }); }
export async function deleteMachine(id) { return await request(`/api/machines/${id}`, { method: 'DELETE' }); }
export async function updateMachine(id, name, processType, spindle = null) { return await request(`/api/machines/${id}`, { method: 'PUT', body: { name, processType, spindle } }); }
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
export async function listHoloProductionPerHours() { return await request('/api/holo_production_per_hours'); }
export async function createHoloProductionPerHour(payload) { return await request('/api/holo_production_per_hours', { method: 'POST', body: payload }); }
export async function updateHoloProductionPerHour(id, payload) { return await request(`/api/holo_production_per_hours/${id}`, { method: 'PUT', body: payload }); }
export async function deleteHoloProductionPerHour(id) { return await request(`/api/holo_production_per_hours/${id}`, { method: 'DELETE' }); }
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
export async function getIssueByConingBarcode(code) { return await request(`/api/issue_to_coning_machine/lookup?barcode=${encodeURIComponent(code)}`); }

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
export async function telegramStatus() { return await request('/api/telegram/status'); }
export async function telegramSendTest(chatId, text) { return await request('/api/telegram/send-test', { method: 'POST', body: { chatId, text } }); }
export async function telegramResolveChats(chatIds = []) { return await request('/api/telegram/chats/resolve', { method: 'POST', body: { chatIds } }); }
export async function listWhatsappTemplates() { return await request('/api/whatsapp/templates'); }
export async function updateWhatsappTemplate(event, body) { return await request(`/api/whatsapp/templates/${event}`, { method: 'PUT', body }); }
export async function sendNotificationEvent(event, payload) { return await request('/api/whatsapp/send-event', { method: 'POST', body: { event, payload } }); }
export async function sendWhatsappEvent(event, payload) { return await sendNotificationEvent(event, payload); }
export async function whatsappGroups() { return await request('/api/whatsapp/groups'); }
export async function getWhatsappContacts() { return await request('/api/whatsapp/contacts'); }

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
export async function createDispatchBulk(data) { return await request('/api/dispatch/bulk', { method: 'POST', body: data }); }
export async function updateDispatch(id, data) { return await request(`/api/dispatch/${encodeURIComponent(id)}`, { method: 'PUT', body: data }); }
export async function updateDispatchChallan(challanNo, data) { return await request(`/api/dispatch/challan/${encodeURIComponent(challanNo)}`, { method: 'PUT', body: data }); }
export async function deleteDispatch(id) { return await request(`/api/dispatch/${id}`, { method: 'DELETE' }); }
export async function deleteDispatchChallan(challanNo) { return await request(`/api/dispatch/challan/${encodeURIComponent(challanNo)}`, { method: 'DELETE' }); }
export async function getDispatchAvailable(stage) { return await request(`/api/dispatch/available/${stage}`); }

// Box Transfer
export async function boxTransferLookup(barcode) { return await request('/api/box-transfer/lookup', { method: 'POST', body: { barcode } }); }
export async function boxTransferExecute(data) { return await request('/api/box-transfer', { method: 'POST', body: data }); }
export async function boxTransferHistory(params = {}) {
  const query = new URLSearchParams(params).toString();
  return await request(`/api/box-transfer/history${query ? '?' + query : ''}`);
}
export async function boxTransferReverse(id) { return await request(`/api/box-transfer/${id}/reverse`, { method: 'POST' }); }

// Reports
export async function getBarcodeHistory(barcode) { return await request(`/api/reports/barcode-history/${encodeURIComponent(barcode)}`); }
export async function getProductionReport(params = {}) {
  const query = new URLSearchParams(params).toString();
  return await request(`/api/reports/production${query ? '?' + query : ''}`);
}
export async function getProductionReportDetails(params = {}) {
  const query = new URLSearchParams(params).toString();
  return await request(`/api/reports/production/details${query ? '?' + query : ''}`);
}
export async function getHoloProductionMetrics(params = {}) {
  const query = new URLSearchParams(params).toString();
  return await request(`/api/reports/production/holo-metrics${query ? '?' + query : ''}`);
}
export async function saveHoloProductionMetrics(entries = []) {
  return await request('/api/reports/production/holo-metrics', { method: 'PUT', body: { entries } });
}

// Summary
export async function getSummary(stage, type, date) {
  const params = date ? `?date=${date}` : '';
  return await request(`/api/summary/${stage}/${type}${params}`);
}
export async function sendSummaryNotification(stage, type, date) {
  return await request(`/api/summary/${stage}/${type}/send`, {
    method: 'POST',
    body: date ? { date } : {}
  });
}
export async function sendSummaryWhatsApp(stage, type, date) { return await sendSummaryNotification(stage, type, date); }
async function downloadBlobResponse(path, fallbackFilename, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: 'GET',
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const aborted = new Error('Download cancelled');
      aborted.name = 'AbortError';
      aborted.cancelled = true;
      throw aborted;
    }
    throw err;
  }

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
    } catch (_) { }
    if (!message) message = `API GET ${path} failed with ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    if (parsed && typeof parsed === 'object') {
      error.details = parsed;
    }
    throw error;
  }

  const blob = await res.blob();
  const contentDisposition = res.headers.get('content-disposition') || '';
  const filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
  const filenameRaw = filenameMatch?.[1] || filenameMatch?.[2];
  const filename = filenameRaw ? decodeURIComponent(filenameRaw) : fallbackFilename;

  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}
export async function downloadSummaryPdf(stage, type, date) {
  const params = date ? `?date=${encodeURIComponent(date)}` : '';
  const path = `/api/summary/${encodeURIComponent(stage)}/${encodeURIComponent(type)}/download${params}`;
  await downloadBlobResponse(path, `summary_${stage}_${type}.pdf`);
}
export async function downloadProductionDailyExport({ process, from, to, signal }) {
  const params = new URLSearchParams({
    process: String(process || ''),
    from: String(from || ''),
    to: String(to || ''),
  });
  const path = `/api/reports/production/export/daily?${params.toString()}`;
  const fallbackFilename = from && to && from !== to
    ? `production_daily_${process}_${from}_to_${to}.zip`
    : `production_daily_${process}_${from || to || 'export'}.pdf`;
  await downloadBlobResponse(path, fallbackFilename, { signal });
}
export async function downloadProductionWeeklyExport({ process, from, to, signal }) {
  const params = new URLSearchParams({
    process: String(process || ''),
    from: String(from || ''),
    to: String(to || ''),
  });
  const path = `/api/reports/production/export/weekly?${params.toString()}`;
  const fallbackFilename = `production_weekly_${process}_${from || 'from'}_to_${to || 'to'}.pdf`;
  await downloadBlobResponse(path, fallbackFilename, { signal });
}

// Boiler (Steaming)
export async function boilerLookup(barcode) {
  return await request(`/api/boiler/lookup?barcode=${encodeURIComponent(barcode)}`);
}
export async function boilerMarkSteamed(barcodes) {
  return await request('/api/boiler/steam', { method: 'POST', body: { barcodes } });
}
export async function boilerListSteamed(date) {
  const params = date ? `?date=${date}` : '';
  return await request(`/api/boiler/steamed${params}`);
}

export default {
  runMutationWithSuccess,
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
  createIssueTakeBack,
  reverseIssueTakeBack,
  getIssueTakeBacks,
  createIssueToCutterMachine,
  createIssueToHoloMachine,
  createIssueToConingMachine,
  createOpeningInbound,
  createOpeningCutterReceive,
  createOpeningHoloReceive,
  createOpeningConingReceive,
  reserveOpeningIssueSeries,
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
  markConingWastage,
  sendDocument,
  getDocumentHistory,
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
  listHoloProductionPerHours,
  createHoloProductionPerHour,
  updateHoloProductionPerHour,
  deleteHoloProductionPerHour,
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
  getIssueByConingBarcode,
  barcodeImageUrl,
  downloadSummaryPdf,
  downloadProductionDailyExport,
  downloadProductionWeeklyExport,
  getHoloProductionMetrics,
  saveHoloProductionMetrics,
  updateDispatch,
  updateDispatchChallan,
};
