import { timingSafeEqual } from 'crypto';
import { ACCESS_LEVELS, BASE_PERMISSION_KEYS, normalizePermissions } from '../utils/permissions.js';

export const AGENT_READ_TOKEN_HEADER = 'x-glintex-agent-token';
export const AGENT_READ_TOKEN_ENV = 'GLINTEX_AGENT_READ_TOKEN';
export const AGENT_READ_PERMISSIONS_ENV = 'GLINTEX_AGENT_READ_PERMISSIONS';

const MIN_TOKEN_LENGTH = 32;
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const KNOWN_PERMISSIONS = new Set(BASE_PERMISSION_KEYS);

function normalizeHeader(value) {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0] || '').trim() : '';
  return typeof value === 'string' ? value.trim() : '';
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseAgentReadPermissions(raw) {
  const requested = String(raw || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const permissions = Array.from(new Set(requested));
  return {
    permissions,
    invalid: permissions.filter(permission => !KNOWN_PERMISSIONS.has(permission)),
  };
}

function buildReadOnlyPermissions(scopes) {
  const permissions = normalizePermissions({}, {
    baseDefault: ACCESS_LEVELS.NONE,
    actionDefault: ACCESS_LEVELS.NONE,
  });
  for (const scope of scopes) permissions[scope] = ACCESS_LEVELS.READ;
  return permissions;
}

function denied(status, error) {
  return { kind: 'denied', status, error };
}

export function authenticateAgentReadRequest(req, env = process.env) {
  const suppliedToken = normalizeHeader(req.headers?.[AGENT_READ_TOKEN_HEADER]);
  if (!suppliedToken) return { kind: 'absent' };

  const configuredToken = String(env?.[AGENT_READ_TOKEN_ENV] || '').trim();
  if (configuredToken.length < MIN_TOKEN_LENGTH) {
    return denied(503, 'agent_read_not_configured');
  }
  if (!secureEqual(suppliedToken, configuredToken)) {
    return denied(401, 'unauthorized');
  }
  if (!READ_ONLY_METHODS.has(String(req.method || '').toUpperCase())) {
    return denied(403, 'agent_read_only');
  }

  const parsed = parseAgentReadPermissions(env?.[AGENT_READ_PERMISSIONS_ENV]);
  if (parsed.invalid.length > 0) {
    return denied(503, 'agent_read_scope_invalid');
  }
  if (parsed.permissions.length === 0) {
    return denied(503, 'agent_read_scope_missing');
  }

  const permissions = buildReadOnlyPermissions(parsed.permissions);
  const role = {
    id: 'glintex-agent-read',
    key: 'glintex_agent_read',
    name: 'GLINTEX Agent Read Only',
    description: 'Environment-scoped read-only integration identity.',
    permissions,
  };

  return {
    kind: 'authorized',
    user: {
      id: null,
      username: 'glintex-agent-read',
      displayName: 'GLINTEX Agent Read Only',
      roles: [role],
      roleKeys: [role.key],
      roleNames: [role.name],
      primaryRoleKey: role.key,
      isAdmin: false,
      permissions,
    },
    scopes: parsed.permissions,
  };
}
