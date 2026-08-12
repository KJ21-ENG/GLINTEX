import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_ID_ENV,
  AGENT_OWNER_ID_ENV,
  AGENT_SCOPES_ENV,
  AGENT_TOKEN_HASH_ENV,
  authenticateAgentRequest,
  hashAgentToken,
  parseAgentScopes,
} from '../agentAuth.js';

const rawToken = 'owner-agent-token-'.padEnd(64, 'x');

function environment(overrides = {}) {
  return {
    [AGENT_TOKEN_HASH_ENV]: hashAgentToken(rawToken),
    [AGENT_ID_ENV]: 'glintex-owner',
    [AGENT_OWNER_ID_ENV]: '1234567890',
    [AGENT_SCOPES_ENV]: 'app.read,tasks.read,tasks.write',
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      authorization: `Bearer ${rawToken}`,
      'x-glintex-agent-id': 'glintex-owner',
      'x-glintex-requester-id': '1234567890',
      'x-glintex-channel': 'telegram',
      'x-glintex-sender-is-owner': 'true',
      'x-glintex-session-key': 'agent:glintex-owner:telegram:direct:1234567890',
      ...overrides,
    },
  };
}

test('authenticates a dedicated owner context without creating an admin session', () => {
  const result = authenticateAgentRequest(request(), environment());
  assert.equal(result.kind, 'authorized');
  assert.equal(result.agent.id, 'glintex-owner');
  assert.equal(result.agent.requesterId, '1234567890');
  assert.deepEqual(result.agent.scopes, ['app.read', 'tasks.read', 'tasks.write']);
  assert.equal('user' in result, false);
});

test('rejects missing, weak, or incorrect bearer credentials', () => {
  assert.equal(authenticateAgentRequest(request({ authorization: '' }), environment()).status, 401);
  assert.equal(authenticateAgentRequest(request({ authorization: 'Bearer short' }), environment()).status, 401);
  assert.equal(
    authenticateAgentRequest(request({ authorization: `Bearer ${'z'.repeat(64)}` }), environment()).status,
    401,
  );
});

test('fails closed when the runtime identity, owner identity, or channel does not match', () => {
  assert.equal(authenticateAgentRequest(request({ 'x-glintex-agent-id': 'other-agent' }), environment()).error, 'owner_context_required');
  assert.equal(authenticateAgentRequest(request({ 'x-glintex-requester-id': '123456789' }), environment()).error, 'owner_context_required');
  assert.equal(authenticateAgentRequest(request({ 'x-glintex-channel': 'web' }), environment()).error, 'owner_context_required');
  assert.equal(authenticateAgentRequest(request({ 'x-glintex-sender-is-owner': 'false' }), environment()).error, 'owner_context_required');
});

test('fails closed for incomplete or unknown configuration', () => {
  assert.equal(authenticateAgentRequest(request(), environment({ [AGENT_TOKEN_HASH_ENV]: '' })).status, 503);
  assert.equal(authenticateAgentRequest(request(), environment({ [AGENT_OWNER_ID_ENV]: 'owner' })).status, 503);
  assert.equal(authenticateAgentRequest(request(), environment({ [AGENT_SCOPES_ENV]: 'app.read,root.exec' })).status, 503);
});

test('scope parser deduplicates known values and reports unknown values', () => {
  assert.deepEqual(parseAgentScopes(' app.read,app.read,tasks.write,root.exec '), {
    scopes: ['app.read', 'tasks.write', 'root.exec'],
    invalid: ['root.exec'],
  });
});
