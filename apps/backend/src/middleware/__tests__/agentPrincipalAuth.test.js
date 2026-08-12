import assert from 'node:assert/strict';
import test from 'node:test';

import { attachAgentReadPrincipal, isTrustedAgentReadPrincipal } from '../agentPrincipalAuth.js';

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('builds a read-only service principal with no admin or action permissions', () => {
  const req = { method: 'GET', agent: { authenticated: true, scopes: ['app.read'] } };
  const res = response();
  let nextCalled = false;
  attachAgentReadPrincipal(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.isAdmin, false);
  assert.equal(req.user.principalType, 'service');
  assert.equal(req.user.permissions.stock, 1);
  assert.equal(req.user.permissions['stock.edit'], 0);
  assert.equal(req.user.permissions['stock.delete'], 0);
  assert.equal(isTrustedAgentReadPrincipal(req), true);
});

test('rejects missing app.read capability and every mutation method', () => {
  const req = { method: 'GET', agent: { authenticated: true, scopes: ['tasks.read'] } };
  const res = response();
  attachAgentReadPrincipal(req, res, () => assert.fail('next must not run'));
  assert.equal(res.statusCode, 403);

  const trusted = { method: 'POST', agent: { authenticated: true }, authContext: { kind: 'glintex-owner-agent', readOnly: true }, user: { principalType: 'service', primaryRoleKey: 'glintex_owner_agent', isAdmin: false } };
  assert.equal(isTrustedAgentReadPrincipal(trusted), false);
});
