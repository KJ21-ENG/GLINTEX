import { createHash, timingSafeEqual } from 'crypto';

export const AGENT_TOKEN_HASH_ENV = 'GLINTEX_OWNER_AGENT_TOKEN_SHA256';
export const AGENT_ID_ENV = 'GLINTEX_OWNER_AGENT_ID';
export const AGENT_OWNER_ID_ENV = 'GLINTEX_OWNER_TELEGRAM_ID';
export const AGENT_SCOPES_ENV = 'GLINTEX_OWNER_AGENT_SCOPES';

export const AGENT_SCOPES = Object.freeze([
  'app.read',
  'finance.read',
  'system.read',
  'tasks.read',
  'tasks.write',
  'learning.read',
  'learning.propose',
  'operations.read',
  'operations.write',
  'audit.write',
]);

const KNOWN_SCOPES = new Set(AGENT_SCOPES);
const TOKEN_HASH_RE = /^[a-f0-9]{64}$/;
const TELEGRAM_ID_RE = /^\d{5,20}$/;
const AGENT_ID_RE = /^[a-z][a-z0-9-]{2,63}$/;

function normalizedHeader(value) {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0] || '').trim() : '';
  return typeof value === 'string' ? value.trim() : '';
}

function bearerToken(req) {
  const header = normalizedHeader(req.headers?.authorization || req.headers?.Authorization);
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice('bearer '.length).trim();
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashAgentToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function parseAgentScopes(raw) {
  const scopes = Array.from(new Set(
    String(raw || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  ));
  return {
    scopes,
    invalid: scopes.filter(scope => !KNOWN_SCOPES.has(scope)),
  };
}

function denied(status, error) {
  return { kind: 'denied', status, error };
}

export function authenticateAgentRequest(req, env = process.env) {
  const configuredHash = String(env?.[AGENT_TOKEN_HASH_ENV] || '').trim().toLowerCase();
  const configuredAgentId = String(env?.[AGENT_ID_ENV] || '').trim();
  const configuredOwnerId = String(env?.[AGENT_OWNER_ID_ENV] || '').trim();
  const parsedScopes = parseAgentScopes(env?.[AGENT_SCOPES_ENV]);

  if (!TOKEN_HASH_RE.test(configuredHash)
    || !AGENT_ID_RE.test(configuredAgentId)
    || !TELEGRAM_ID_RE.test(configuredOwnerId)
    || parsedScopes.invalid.length > 0
    || parsedScopes.scopes.length === 0) {
    return denied(503, 'agent_not_configured');
  }

  const token = bearerToken(req);
  if (token.length < 32 || token.length > 512 || !secureEqual(hashAgentToken(token), configuredHash)) {
    return denied(401, 'unauthorized');
  }

  const suppliedAgentId = normalizedHeader(req.headers?.['x-glintex-agent-id']);
  const requesterId = normalizedHeader(req.headers?.['x-glintex-requester-id']);
  const channel = normalizedHeader(req.headers?.['x-glintex-channel']).toLowerCase();
  const senderIsOwner = normalizedHeader(req.headers?.['x-glintex-sender-is-owner']).toLowerCase();
  const sessionKey = normalizedHeader(req.headers?.['x-glintex-session-key']).slice(0, 256) || null;
  const sessionId = normalizedHeader(req.headers?.['x-glintex-session-id']).slice(0, 128) || null;

  if (suppliedAgentId !== configuredAgentId
    || requesterId !== configuredOwnerId
    || channel !== 'telegram'
    || senderIsOwner !== 'true') {
    return denied(403, 'owner_context_required');
  }

  return {
    kind: 'authorized',
    agent: {
      authenticated: true,
      id: configuredAgentId,
      requesterId,
      channel,
      sessionKey,
      sessionId,
      scopes: parsedScopes.scopes,
    },
  };
}

export function requireAgentAuth(req, res, next) {
  const result = authenticateAgentRequest(req);
  if (result.kind !== 'authorized') {
    return res.status(result.status).json({ error: result.error });
  }
  req.agent = result.agent;
  return next();
}

export function requireAgentScope(scope) {
  if (!KNOWN_SCOPES.has(scope)) throw new Error(`Unknown agent scope: ${scope}`);
  return function agentScopeMiddleware(req, res, next) {
    if (!req.agent?.authenticated) return res.status(401).json({ error: 'unauthorized' });
    if (!Array.isArray(req.agent.scopes) || !req.agent.scopes.includes(scope)) {
      return res.status(403).json({ error: 'agent_scope_denied', requiredScope: scope });
    }
    return next();
  };
}
