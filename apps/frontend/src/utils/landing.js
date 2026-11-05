import { ACCESS_LEVELS, getPermissionLevel } from './permissions.js';

// The app's modules in sidebar order (keep in sync with NAV_ITEMS in
// DashboardLayout). A user lands on the first one they can open.
export const APP_MODULES = [
  { key: 'inbound', permissions: ['inbound'] },
  { key: 'stock', permissions: ['stock'] },
  { key: 'issue', permissions: ['issue.cutter', 'issue.holo', 'issue.coning'] },
  { key: 'receive', permissions: ['receive.cutter', 'receive.holo', 'receive.coning'] },
  { key: 'dispatch', permissions: ['dispatch'] },
  { key: 'opening-stock', permissions: ['opening_stock'] },
  { key: 'box-transfer', permissions: ['box_transfer'] },
  // Boiler only works with the Holo process selected.
  { key: 'boiler', permissions: ['boiler'], process: 'holo' },
  { key: 'send-documents', permissions: ['send_documents'] },
  { key: 'masters', permissions: ['masters'] },
  { key: 'contractor-payments', permissions: ['contractor_payments'] },
  { key: 'reports', permissions: ['reports'] },
  { key: 'settings', permissions: ['settings'] },
];

export function canOpenModule(user, module) {
  if (!user || !module) return false;
  if (user.isAdmin) return true;
  const permissions = user.permissions || {};
  return module.permissions.some((key) => getPermissionLevel(permissions, key) >= ACCESS_LEVELS.READ);
}

export function getLandingModule(user) {
  return APP_MODULES.find((module) => canOpenModule(user, module)) || null;
}

// The process to select on landing. Issue and Receive check the stage of the
// current process, so keep it when allowed, otherwise pick an allowed stage.
const STAGES = ['cutter', 'holo', 'coning'];
export function getLandingProcess(user, module, current) {
  if (module?.process) return module.process;
  if (!module || user?.isAdmin || (module.key !== 'issue' && module.key !== 'receive')) return current;
  const allowed = (stage) => getPermissionLevel(user?.permissions || {}, `${module.key}.${stage}`) >= ACCESS_LEVELS.READ;
  return allowed(current) ? current : STAGES.find(allowed) || current;
}

// Where to go after sign-in: the page the user asked for when they can open
// it, otherwise /app, which redirects to their landing module.
export function resolvePostLoginPath(user, from) {
  const path = typeof from === 'string' ? from : '';
  const match = path.match(/^\/app\/([^/?#]+)/);
  if (!match) return '/app';
  const module = APP_MODULES.find((item) => item.key === match[1]);
  if (module && !canOpenModule(user, module)) return '/app';
  return path;
}
