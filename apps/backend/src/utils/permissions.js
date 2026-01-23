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
];

export const PERMISSION_KEYS = [
  ...BASE_PERMISSION_KEYS,
  ...BASE_PERMISSION_KEYS.flatMap(key => ACTION_SUFFIXES.map(action => `${key}.${action}`)),
];

export const DEFAULT_ACCESS_LEVEL = ACCESS_LEVELS.WRITE;

function toLevel(value, fallback = DEFAULT_ACCESS_LEVEL) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num <= ACCESS_LEVELS.NONE) return ACCESS_LEVELS.NONE;
  if (num >= ACCESS_LEVELS.WRITE) return ACCESS_LEVELS.WRITE;
  return ACCESS_LEVELS.READ;
}

export function normalizePermissions(raw, options = {}) {
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
  for (const key of BASE_PERMISSION_KEYS) {
    normalized[key] = toLevel(source[key], baseDefault);
  }
  for (const key of PERMISSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) continue;
    normalized[key] = toLevel(source[key], actionDefault);
  }
  return normalized;
}

export function mergePermissions(permissionObjects) {
  const merged = normalizePermissions({}, { baseDefault: ACCESS_LEVELS.NONE, actionDefault: ACCESS_LEVELS.NONE });
  if (!Array.isArray(permissionObjects)) return merged;
  for (const raw of permissionObjects) {
    const normalized = normalizePermissions(raw, { baseDefault: ACCESS_LEVELS.NONE, actionDefault: ACCESS_LEVELS.NONE });
    for (const key of PERMISSION_KEYS) {
      merged[key] = Math.max(merged[key], normalized[key]);
    }
  }
  return merged;
}

export function isAdminRole(role) {
  return !!role && typeof role.key === 'string' && role.key.toLowerCase() === 'admin';
}

export function buildEffectivePermissions(roles) {
  if (Array.isArray(roles) && roles.some(isAdminRole)) {
    return normalizePermissions({}, { baseDefault: ACCESS_LEVELS.WRITE, actionDefault: ACCESS_LEVELS.WRITE });
  }
  const permissionObjects = Array.isArray(roles)
    ? roles.map(role => role?.permissions).filter(Boolean)
    : [];
  return mergePermissions(permissionObjects);
}

export function getPermissionLevel(permissions, key) {
  if (!permissions || typeof permissions !== 'object') return ACCESS_LEVELS.NONE;
  if (!Object.prototype.hasOwnProperty.call(permissions, key)) return ACCESS_LEVELS.NONE;
  return toLevel(permissions[key], ACCESS_LEVELS.NONE);
}

export function canRead(permissions, key) {
  return getPermissionLevel(permissions, key) >= ACCESS_LEVELS.READ;
}

export function canWrite(permissions, key) {
  return getPermissionLevel(permissions, key) >= ACCESS_LEVELS.WRITE;
}
