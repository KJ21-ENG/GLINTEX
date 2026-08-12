import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { createAgentApp } from '../../../agentApp.js';
import prisma from '../../../lib/prisma.js';
import { hashAgentToken } from '../../../middleware/agentAuth.js';

const enabled = process.env.GLINTEX_AGENT_INTEGRATION_TEST === '1';
const rawToken = 'integration-agent-token-012345678901234567890123456789';
const ownerId = '1234567890';
const agentId = 'glintex-owner';
const scopes = [
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
].join(',');
const adminDatabaseUrl = process.env.GLINTEX_AGENT_TEST_ADMIN_DATABASE_URL;
const adminPrisma = adminDatabaseUrl
  ? new PrismaClient({ datasources: { db: { url: adminDatabaseUrl } } })
  : prisma;

function agentHeaders(overrides = {}) {
  return {
    authorization: `Bearer ${rawToken}`,
    'x-glintex-agent-id': agentId,
    'x-glintex-requester-id': ownerId,
    'x-glintex-channel': 'telegram',
    'x-glintex-sender-is-owner': 'true',
    'x-glintex-session-key': 'agent:glintex-owner:telegram:direct:1234567890',
    'x-glintex-session-id': 'integration-session',
    ...overrides,
  };
}

async function clearAgentFixtures() {
  await adminPrisma.agentAccessLog.deleteMany({ where: { agentId } });
  await adminPrisma.agentOperation.deleteMany({ where: { agentId } });
  await adminPrisma.agentLearningCandidate.deleteMany({ where: { proposedByAgentId: agentId } });
  await adminPrisma.ownerTask.deleteMany({ where: { createdByAgentId: agentId } });
  await adminPrisma.auditLog.deleteMany({ where: { actorUsername: 'glintex-owner-agent' } });
}

before(async () => {
  if (!enabled) return;
  process.env.GLINTEX_OWNER_AGENT_TOKEN_SHA256 = hashAgentToken(rawToken);
  process.env.GLINTEX_OWNER_AGENT_ID = agentId;
  process.env.GLINTEX_OWNER_TELEGRAM_ID = ownerId;
  process.env.GLINTEX_OWNER_AGENT_SCOPES = scopes;
  process.env.GLINTEX_OWNER_AGENT_CONFIRMATION_SECRET = 'integration-confirmation-secret-01234567890123456789';
  process.env.GLINTEX_AGENT_ACTION_TTL_SECONDS = '600';
  await clearAgentFixtures();
});

after(async () => {
  if (!enabled) return;
  await clearAgentFixtures();
  if (adminPrisma !== prisma) await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

test('owner agent API enforces identity, fixed routes, confirmation, audit, and replay safety', { skip: !enabled }, async () => {
  const app = createAgentApp();
  const title = `Synthetic owner-agent acceptance ${Date.now()}`;

  await request(app).get('/healthz').expect(200, { ok: true });
  await request(app).get('/api/agent/v1/health').expect(401, { error: 'unauthorized' });
  await request(app)
    .get('/api/agent/v1/health')
    .set(agentHeaders({ authorization: 'Bearer wrong-token-that-is-long-enough-01234567890123456789' }))
    .expect(401, { error: 'unauthorized' });
  await request(app)
    .get('/api/agent/v1/health')
    .set(agentHeaders({ 'x-glintex-requester-id': '9999999999' }))
    .expect(403, { error: 'owner_context_required' });
  await request(app)
    .get('/api/agent/v1/health')
    .set(agentHeaders({ 'x-glintex-channel': 'webchat' }))
    .expect(403, { error: 'owner_context_required' });
  await request(app).get('/api/agent/v1/health').set(agentHeaders()).expect(200);

  await request(app)
    .get('/api/agent/v1/app/issue/cutter/tracking/export.json')
    .set(agentHeaders())
    .expect(404, { error: 'agent_resource_not_found' });
  await request(app)
    .post('/api/agent/v1/app/issue/cutter/tracking')
    .set(agentHeaders())
    .send({})
    .expect(404);
  await request(app)
    .get('/api/agent/v1/app/issue/cutter/tracking?limit=1')
    .set(agentHeaders())
    .expect(200);

  await request(app)
    .post('/api/agent/v1/actions/prepare')
    .set(agentHeaders())
    .send({
      action: 'contractor_settlement.mark_paid',
      idempotencyKey: 'integration-forbidden-action',
      reason: 'Prove an unexposed payment-like action is denied.',
      data: {},
    })
    .expect(400)
    .expect(response => assert.equal(response.body.error, 'unsupported_action'));

  const prepared = await request(app)
    .post('/api/agent/v1/actions/prepare')
    .set(agentHeaders())
    .send({
      action: 'owner_task.create',
      idempotencyKey: `integration-create-${Date.now()}`,
      reason: 'Create a synthetic fixture for owner-agent release validation.',
      data: {
        title,
        description: 'This fixture must be cancelled before the test finishes.',
        area: 'TECHNOLOGY',
        priority: 'LOW',
      },
    })
    .expect(201);

  assert.equal(prepared.body.status, 'PREPARED');
  assert.match(prepared.body.confirmationCommand, /^CONFIRM GLINTEX GLX-[A-F0-9]{10}$/);

  await request(app)
    .post('/api/agent/v1/actions/execute')
    .set(agentHeaders())
    .send({ operationId: prepared.body.id, confirmationCode: 'GLX-0000000000' })
    .expect(403)
    .expect(response => assert.equal(response.body.error, 'confirmation_invalid'));

  const executed = await request(app)
    .post('/api/agent/v1/actions/execute')
    .set(agentHeaders())
    .send({ operationId: prepared.body.id, confirmationCode: prepared.body.confirmationCode })
    .expect(200);
  assert.equal(executed.body.status, 'SUCCEEDED');
  assert.equal(executed.body.verificationRequired, true);

  const replay = await request(app)
    .post('/api/agent/v1/actions/execute')
    .set(agentHeaders())
    .send({ operationId: prepared.body.id, confirmationCode: prepared.body.confirmationCode })
    .expect(200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.entityId, executed.body.entityId);

  const verified = await request(app)
    .get(`/api/agent/v1/actions/${prepared.body.id}/verify`)
    .set(agentHeaders())
    .expect(200);
  assert.equal(verified.body.ok, true);
  assert.equal(verified.body.status, 'VERIFIED');

  const task = await prisma.ownerTask.findUnique({ where: { id: executed.body.entityId } });
  assert.equal(task.title, title);
  assert.equal(task.status, 'OPEN');
  assert.equal(task.version, 1);

  await request(app)
    .post('/api/agent/v1/actions/prepare')
    .set(agentHeaders())
    .send({
      action: 'owner_task.create',
      idempotencyKey: `integration-duplicate-${Date.now()}`,
      reason: 'Prove the duplicate-title guard.',
      data: { title, area: 'TECHNOLOGY', priority: 'LOW' },
    })
    .expect(409)
    .expect(response => assert.equal(response.body.error, 'duplicate_task'));

  const cancelPrepared = await request(app)
    .post('/api/agent/v1/actions/prepare')
    .set(agentHeaders())
    .send({
      action: 'owner_task.cancel',
      idempotencyKey: `integration-cancel-${Date.now()}`,
      reason: 'Remove the synthetic release-validation task.',
      data: { taskId: task.id, expectedVersion: task.version },
    })
    .expect(201);
  await request(app)
    .post('/api/agent/v1/actions/execute')
    .set(agentHeaders())
    .send({ operationId: cancelPrepared.body.id, confirmationCode: cancelPrepared.body.confirmationCode })
    .expect(200);
  const cancelVerified = await request(app)
    .get(`/api/agent/v1/actions/${cancelPrepared.body.id}/verify`)
    .set(agentHeaders())
    .expect(200);
  assert.equal(cancelVerified.body.ok, true);
  assert.equal(cancelVerified.body.verification.entity.status, 'CANCELLED');

  const history = await request(app)
    .get('/api/agent/v1/operations?limit=10')
    .set(agentHeaders())
    .expect(200);
  assert.equal(history.body.total, 2);
  assert.equal(JSON.stringify(history.body).includes('confirmationHash'), false);

  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(await prisma.agentAccessLog.count({ where: { agentId } }) >= 3);
  assert.equal(await prisma.auditLog.count({ where: { actorUsername: 'glintex-owner-agent' } }), 2);
});
