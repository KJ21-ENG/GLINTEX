import { requireAuth as requireHumanSession } from './auth.js';
import { ACCESS_LEVELS, normalizePermissions } from '../utils/permissions.js';

const AGENT_READ_PERMISSIONS = Object.freeze([
  'inbound',
  'opening_stock',
  'issue.cutter',
  'receive.cutter',
  'issue.holo',
  'receive.holo',
  'issue.coning',
  'receive.coning',
  'stock',
  'dispatch',
  'reports',
  'masters',
  'contractor_payments',
  'boiler',
]);

export function attachAgentReadPrincipal(req, res, next) {
  if (!req.agent?.authenticated || !Array.isArray(req.agent.scopes) || !req.agent.scopes.includes('app.read')) {
    return res.status(403).json({ error: 'agent_scope_denied', requiredScope: 'app.read' });
  }

  const permissions = normalizePermissions({}, {
    baseDefault: ACCESS_LEVELS.NONE,
    actionDefault: ACCESS_LEVELS.NONE,
  });
  AGENT_READ_PERMISSIONS.forEach((key) => {
    permissions[key] = ACCESS_LEVELS.READ;
  });

  req.user = {
    id: null,
    username: 'glintex-owner-agent',
    displayName: 'GLINTEX Executive',
    principalType: 'service',
    roles: [{
      id: 'glintex-owner-agent',
      key: 'glintex_owner_agent',
      name: 'GLINTEX Owner Agent',
      description: 'Capability-scoped owner integration principal.',
      permissions,
    }],
    roleKeys: ['glintex_owner_agent'],
    roleNames: ['GLINTEX Owner Agent'],
    primaryRoleKey: 'glintex_owner_agent',
    isAdmin: false,
    permissions,
  };
  req.authContext = { kind: 'glintex-owner-agent', readOnly: true };
  return next();
}

export function isTrustedAgentReadPrincipal(req) {
  return req.method === 'GET'
    && req.agent?.authenticated === true
    && req.authContext?.kind === 'glintex-owner-agent'
    && req.authContext?.readOnly === true
    && req.user?.principalType === 'service'
    && req.user?.primaryRoleKey === 'glintex_owner_agent'
    && req.user?.isAdmin === false;
}

export function requireSessionOrAgentRead(req, res, next) {
  if (isTrustedAgentReadPrincipal(req)) return next();
  return requireHumanSession(req, res, next);
}
