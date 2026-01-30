export const ACCESS_LEVELS = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
};

export const ACTION_SUFFIXES = ['edit', 'delete'];

export const BASE_PERMISSION_KEYS = [
  'inbound',
  'issue.cutter',
  'issue.holo',
  'issue.coning',
  'receive.cutter',
  'receive.holo',
  'receive.coning',
  'boiler',
  'dispatch',
  'stock',
  'reports',
  'masters',
  'settings',
  'opening_stock',
  'box_transfer',
  'send_documents',
];

export const PERMISSION_KEYS = [
  ...BASE_PERMISSION_KEYS,
  ...BASE_PERMISSION_KEYS.flatMap(key => ACTION_SUFFIXES.map(action => `${key}.${action}`)),
];

export const DEFAULT_ACCESS_LEVEL = ACCESS_LEVELS.WRITE;

const toLevel = (value, fallback = DEFAULT_ACCESS_LEVEL) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num <= ACCESS_LEVELS.NONE) return ACCESS_LEVELS.NONE;
  if (num >= ACCESS_LEVELS.WRITE) return ACCESS_LEVELS.WRITE;
  return ACCESS_LEVELS.READ;
};

export const normalizePermissions = (raw, options = {}) => {
  let baseDefault = DEFAULT_ACCESS_LEVEL;
  let actionDefault = ACCESS_LEVELS.NONE;
  if (typeof options === 'number') {
    baseDefault = options;
  } else if (options && typeof options === 'object') {
    baseDefault = options.baseDefault ?? DEFAULT_ACCESS_LEVEL;
    actionDefault = options.actionDefault ?? ACCESS_LEVELS.NONE;
  }
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalized = {};
  BASE_PERMISSION_KEYS.forEach((key) => {
    normalized[key] = toLevel(source[key], baseDefault);
  });
  PERMISSION_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) return;
    normalized[key] = toLevel(source[key], actionDefault);
  });
  return normalized;
};

export const getPermissionLevel = (permissions, key) => {
  if (!permissions || typeof permissions !== 'object') return ACCESS_LEVELS.NONE;
  if (!Object.prototype.hasOwnProperty.call(permissions, key)) return ACCESS_LEVELS.NONE;
  return toLevel(permissions[key], ACCESS_LEVELS.NONE);
};

export const canRead = (permissions, key) => getPermissionLevel(permissions, key) >= ACCESS_LEVELS.READ;
export const canWrite = (permissions, key) => getPermissionLevel(permissions, key) >= ACCESS_LEVELS.WRITE;
export const canEdit = (permissions, key) => getPermissionLevel(permissions, `${key}.edit`) >= ACCESS_LEVELS.READ;
export const canDelete = (permissions, key) => getPermissionLevel(permissions, `${key}.delete`) >= ACCESS_LEVELS.READ;

export const MODULE_PERMISSIONS = [
  { key: 'inbound', label: 'Inbound', supportsEdit: true, supportsDelete: true },
  { key: 'stock', label: 'Stock' },
  { key: 'boiler', label: 'Boiler' },
  { key: 'dispatch', label: 'Dispatch', supportsDelete: true },
  { key: 'reports', label: 'Reports' },
  { key: 'masters', label: 'Masters', supportsEdit: true, supportsDelete: true },
  { key: 'settings', label: 'Settings', supportsEdit: true },
  { key: 'opening_stock', label: 'Opening Stock', supportsDelete: true },
  { key: 'box_transfer', label: 'Box Transfer', supportsDelete: true },
  { key: 'send_documents', label: 'Send Documents' },
];

export const ISSUE_STAGE_PERMISSIONS = [
  { stage: 'cutter', key: 'issue.cutter', label: 'Cutter', supportsEdit: true, supportsDelete: true },
  { stage: 'holo', key: 'issue.holo', label: 'Holo', supportsEdit: true, supportsDelete: true },
  { stage: 'coning', key: 'issue.coning', label: 'Coning', supportsEdit: true, supportsDelete: true },
];

export const RECEIVE_STAGE_PERMISSIONS = [
  { stage: 'cutter', key: 'receive.cutter', label: 'Cutter', supportsEdit: true, supportsDelete: true },
  { stage: 'holo', key: 'receive.holo', label: 'Holo', supportsEdit: true, supportsDelete: true },
  { stage: 'coning', key: 'receive.coning', label: 'Coning', supportsEdit: true, supportsDelete: true },
];

export const PROCESS_PERMISSION_KEYS = {
  inbound: 'inbound',
  stock: 'stock',
  boiler: 'boiler',
  dispatch: 'dispatch',
  reports: 'reports',
  masters: 'masters',
  settings: 'settings',
  openingStock: 'opening_stock',
  boxTransfer: 'box_transfer',
  sendDocuments: 'send_documents',
};

export const STAGE_PERMISSION_KEYS = {
  issue: {
    cutter: 'issue.cutter',
    holo: 'issue.holo',
    coning: 'issue.coning',
  },
  receive: {
    cutter: 'receive.cutter',
    holo: 'receive.holo',
    coning: 'receive.coning',
  },
};
