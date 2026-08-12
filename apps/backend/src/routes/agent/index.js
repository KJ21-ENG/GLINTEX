import { Router } from 'express';

import prisma from '../../lib/prisma.js';
import { requireAgentAuth, requireAgentScope } from '../../middleware/agentAuth.js';
import { attachAgentReadPrincipal } from '../../middleware/agentPrincipalAuth.js';
import v2Router from '../v2.js';
import {
  executeAgentAction,
  prepareAgentAction,
  serializeAgentOperation,
  toAgentActionError,
  verifyAgentAction,
} from '../../services/agent/actionService.js';
import { requiredScopeForAction } from '../../services/agent/actionPolicy.js';
import { auditAgentRead } from '../../services/agent/readAudit.js';
import {
  readAgentReference,
  readContractorSettlements,
  readLearningCandidates,
  readOperationHistory,
  readOwnerTasks,
  readProductionSummary,
  readSystemStatus,
} from '../../services/agent/readService.js';

const router = Router();

const ALLOWED_APP_READ_PATHS = [
  /^\/issue\/(cutter|holo|coning)\/tracking$/,
  /^\/receive\/(cutter|holo|coning)\/history$/,
  /^\/on-machine\/(cutter|holo|coning)$/,
  /^\/stock\/(holo|coning)\/lots$/,
];

function allowlistedAppReadPath(req, res, next) {
  if (!ALLOWED_APP_READ_PATHS.some(pattern => pattern.test(req.path))) {
    return res.status(404).json({ error: 'agent_resource_not_found' });
  }
  return next();
}

function actionCapability(req, res, next) {
  const required = requiredScopeForAction(String(req.body?.action || ''));
  if (!req.agent?.scopes?.includes(required)) {
    return res.status(403).json({ error: 'agent_scope_denied', requiredScope: required });
  }
  return next();
}

async function operationCapability(req, res, next) {
  try {
    const operationId = String(req.body?.operationId || req.params?.id || '').trim();
    const operation = await prisma.agentOperation.findFirst({
      where: { id: operationId, agentId: req.agent.id, requesterId: req.agent.requesterId },
      select: { action: true },
    });
    if (!operation) return res.status(404).json({ error: 'operation_not_found' });
    const required = requiredScopeForAction(operation.action);
    if (!req.agent.scopes.includes(required)) {
      return res.status(403).json({ error: 'agent_scope_denied', requiredScope: required });
    }
    return next();
  } catch (error) {
    console.error('Failed to resolve agent operation capability', error);
    return res.status(500).json({ error: 'operation_capability_failed' });
  }
}

function sendActionError(res, error) {
  const safe = toAgentActionError(error);
  return res.status(safe.status).json({ error: safe.code, message: safe.message, details: safe.details });
}

function sendReadError(res, error, fallbackCode, logLabel) {
  const status = error.status || 500;
  if (status >= 500) console.error(logLabel, error);
  return res.status(status).json({
    error: error.code || fallbackCode,
    ...(status < 500 ? { message: error.message, details: error.details } : {}),
  });
}

router.use(requireAgentAuth);

router.get('/health', requireAgentScope('system.read'), auditAgentRead('health'), async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;
    return res.json({ ok: true, service: 'glintex-owner-agent-api', checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Agent health check failed', error);
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
});

router.get('/reference', requireAgentScope('app.read'), auditAgentRead('reference'), async (req, res) => {
  try {
    return res.json(await readAgentReference(prisma));
  } catch (error) {
    console.error('Agent reference read failed', error);
    return res.status(500).json({ error: 'reference_read_failed' });
  }
});

router.get('/contractor-settlements', requireAgentScope('finance.read'), auditAgentRead('contractor_settlements'), async (req, res) => {
  try {
    return res.json(await readContractorSettlements(prisma, req.query));
  } catch (error) {
    return sendReadError(res, error, 'settlement_read_failed', 'Contractor settlement read failed');
  }
});

router.get('/owner-tasks', requireAgentScope('tasks.read'), auditAgentRead('owner_tasks'), async (req, res) => {
  try {
    return res.json(await readOwnerTasks(prisma, req.query));
  } catch (error) {
    return sendReadError(res, error, 'owner_task_read_failed', 'Owner task read failed');
  }
});

router.get('/learning-candidates', requireAgentScope('learning.read'), auditAgentRead('learning_candidates'), async (req, res) => {
  try {
    return res.json(await readLearningCandidates(prisma, req.query));
  } catch (error) {
    return sendReadError(res, error, 'learning_read_failed', 'Learning candidate read failed');
  }
});

router.get('/operations', requireAgentScope('operations.read'), auditAgentRead('operation_history'), async (req, res) => {
  try {
    const data = await readOperationHistory(prisma, req.agent, req.query);
    if (Array.isArray(data?.items)) data.items = data.items.map(serializeAgentOperation);
    else if (data) return res.json(serializeAgentOperation(data));
    return res.json(data);
  } catch (error) {
    return sendReadError(res, error, 'operation_history_failed', 'Operation history read failed');
  }
});

router.get('/production', requireAgentScope('app.read'), auditAgentRead('production'), async (req, res) => {
  try {
    return res.json(await readProductionSummary(prisma, req.query));
  } catch (error) {
    return sendReadError(res, error, 'production_read_failed', 'Production read failed');
  }
});

router.get('/system', requireAgentScope('system.read'), auditAgentRead('system_status'), async (req, res) => {
  try {
    return res.json(await readSystemStatus(prisma));
  } catch (error) {
    console.error('System status read failed', error);
    return res.status(503).json({ error: 'system_status_failed' });
  }
});

router.post('/actions/prepare', requireAgentScope('operations.write'), actionCapability, async (req, res) => {
  try {
    return res.status(201).json(await prepareAgentAction(prisma, req.agent, req.body));
  } catch (error) {
    return sendActionError(res, error);
  }
});

router.post('/actions/execute', requireAgentScope('operations.write'), operationCapability, async (req, res) => {
  try {
    return res.json(await executeAgentAction(prisma, req.agent, req.body));
  } catch (error) {
    return sendActionError(res, error);
  }
});

router.get('/actions/:id/verify', requireAgentScope('operations.read'), operationCapability, async (req, res) => {
  try {
    const result = await verifyAgentAction(prisma, req.agent, req.params.id);
    return res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    return sendActionError(res, error);
  }
});

router.post('/audit/read', requireAgentScope('audit.write'), async (req, res) => {
  const resource = String(req.body?.resource || '').trim();
  const filtersHash = String(req.body?.filtersHash || '').trim().toLowerCase();
  const source = String(req.body?.source || '').trim().toLowerCase();
  const outcome = String(req.body?.outcome || 'SUCCEEDED').trim().toUpperCase();
  if (!['finance_outstanding', 'finance_runs'].includes(resource)
    || !/^[a-f0-9]{64}$/.test(filtersHash)
    || source !== 'tally'
    || !['SUCCEEDED', 'FAILED'].includes(outcome)) {
    return res.status(400).json({ error: 'validation_error' });
  }
  const resultCount = Number(req.body?.resultCount);
  const durationMs = Number(req.body?.durationMs);
  const row = await prisma.agentAccessLog.create({
    data: {
      agentId: req.agent.id,
      requesterId: req.agent.requesterId,
      channel: req.agent.channel,
      sessionKey: req.agent.sessionKey,
      resource,
      source,
      filtersHash,
      resultCount: Number.isInteger(resultCount) && resultCount >= 0 ? resultCount : null,
      outcome,
      durationMs: Number.isInteger(durationMs) && durationMs >= 0 ? durationMs : null,
      errorCode: outcome === 'FAILED' ? String(req.body?.errorCode || 'finance_read_failed').slice(0, 120) : null,
    },
  });
  return res.status(201).json({ ok: true, auditId: row.id });
});

router.use(
  '/app',
  requireAgentScope('app.read'),
  allowlistedAppReadPath,
  attachAgentReadPrincipal,
  auditAgentRead(req => `app:${req.path}`),
  v2Router,
);

router.use((req, res) => res.status(404).json({ error: 'agent_resource_not_found' }));

export default router;
