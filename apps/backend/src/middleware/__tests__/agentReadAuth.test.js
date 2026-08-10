import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_READ_PERMISSIONS_ENV,
  AGENT_READ_TOKEN_ENV,
  authenticateAgentReadRequest,
  parseAgentReadPermissions,
} from '../agentReadAuth.js';

const token = 'a'.repeat(48);

function request({ method = 'GET', suppliedToken } = {}) {
  return {
    method,
    headers: suppliedToken ? { 'x-glintex-agent-token': suppliedToken } : {},
  };
}

function env(overrides = {}) {
  return {
    [AGENT_READ_TOKEN_ENV]: token,
    [AGENT_READ_PERMISSIONS_ENV]: 'stock,reports,masters',
    ...overrides,
  };
}

test('ignores ordinary session-authenticated requests', () => {
  assert.deepEqual(authenticateAgentReadRequest(request(), env()), { kind: 'absent' });
});

test('authorizes only configured read scopes', () => {
  const result = authenticateAgentReadRequest(request({ suppliedToken: token }), env());
  assert.equal(result.kind, 'authorized');
  assert.equal(result.user.isAdmin, false);
  assert.equal(result.user.permissions.stock, 1);
  assert.equal(result.user.permissions.reports, 1);
  assert.equal(result.user.permissions.masters, 1);
  assert.equal(result.user.permissions.settings, 0);
  assert.equal(result.user.permissions['stock.edit'], 0);
  assert.equal(result.user.permissions['stock.delete'], 0);
});

test('rejects an invalid token without falling back to a user session', () => {
  assert.deepEqual(
    authenticateAgentReadRequest(request({ suppliedToken: 'b'.repeat(48) }), env()),
    { kind: 'denied', status: 401, error: 'unauthorized' },
  );
});

test('rejects every mutation method even with a valid token', () => {
  assert.deepEqual(
    authenticateAgentReadRequest(request({ method: 'POST', suppliedToken: token }), env()),
    { kind: 'denied', status: 403, error: 'agent_read_only' },
  );
});

test('fails closed for a missing, weak, empty-scope, or invalid-scope configuration', () => {
  assert.equal(
    authenticateAgentReadRequest(
      request({ suppliedToken: token }),
      env({ [AGENT_READ_TOKEN_ENV]: 'too-short' }),
    ).error,
    'agent_read_not_configured',
  );
  assert.equal(
    authenticateAgentReadRequest(
      request({ suppliedToken: token }),
      env({ [AGENT_READ_PERMISSIONS_ENV]: '' }),
    ).error,
    'agent_read_scope_missing',
  );
  assert.equal(
    authenticateAgentReadRequest(
      request({ suppliedToken: token }),
      env({ [AGENT_READ_PERMISSIONS_ENV]: 'stock,stock.edit' }),
    ).error,
    'agent_read_scope_invalid',
  );
});

test('deduplicates known scopes and reports unknown ones', () => {
  assert.deepEqual(parseAgentReadPermissions(' stock,stock,reports,unknown '), {
    permissions: ['stock', 'reports', 'unknown'],
    invalid: ['unknown'],
  });
});
