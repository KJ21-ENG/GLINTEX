import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  AgentActionError,
  buildConfirmationCode,
  confirmationMatches,
  hashActionRequest,
  hashConfirmationCode,
  normalizeActionRequest,
  operationIdIsValid,
} from './actionPolicy.js';

const ACTIVE_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED'];
const ACTIVE_LEARNING_STATUSES = ['PROPOSED', 'APPROVED'];

function configuredConfirmationSecret(env = process.env) {
  const secret = String(env.GLINTEX_OWNER_AGENT_CONFIRMATION_SECRET || '');
  if (secret.length < 32) {
    throw new AgentActionError('agent_not_configured', 'Agent confirmation policy is unavailable.', 503);
  }
  return secret;
}

function actionTtlSeconds(env = process.env) {
  const value = Number(env.GLINTEX_AGENT_ACTION_TTL_SECONDS || 600);
  if (!Number.isInteger(value) || value < 60 || value > 3600) {
    throw new AgentActionError('agent_not_configured', 'Agent action TTL is invalid.', 503);
  }
  return value;
}

function publicOperation(operation, extra = {}) {
  if (!operation) return null;
  return {
    id: operation.id,
    action: operation.action,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status: operation.status,
    idempotencyKey: operation.idempotencyKey,
    requestHash: operation.requestHash,
    preview: operation.preview,
    result: operation.result,
    verification: operation.verification,
    expiresAt: operation.expiresAt,
    executedAt: operation.executedAt,
    verifiedAt: operation.verifiedAt,
    failureCode: operation.failureCode,
    failureMessage: operation.failureMessage,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    ...extra,
  };
}

function entityTypeForAction(action) {
  return action === 'learning_candidate.propose' ? 'AgentLearningCandidate' : 'OwnerTask';
}

async function previewAction(db, request) {
  const { action, data } = request;
  if (action === 'owner_task.create') {
    const duplicate = await db.ownerTask.findFirst({
      where: {
        title: { equals: data.title, mode: 'insensitive' },
        status: { in: ACTIVE_TASK_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) {
      throw new AgentActionError(
        'duplicate_task',
        'An active owner task with the same title already exists.',
        409,
        { existing: duplicate },
      );
    }
    return {
      entityType: 'OwnerTask',
      entityId: null,
      expectedVersion: null,
      preview: { operation: 'create', after: { ...data, status: 'OPEN', version: 1 } },
    };
  }

  if (action === 'learning_candidate.propose') {
    const duplicate = await db.agentLearningCandidate.findFirst({
      where: {
        statement: { equals: data.statement, mode: 'insensitive' },
        status: { in: ACTIVE_LEARNING_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) {
      throw new AgentActionError(
        'duplicate_learning_candidate',
        'A matching learning candidate already exists.',
        409,
        { existing: duplicate },
      );
    }
    return {
      entityType: 'AgentLearningCandidate',
      entityId: null,
      expectedVersion: null,
      preview: { operation: 'propose', after: { ...data, status: 'PROPOSED', version: 1 } },
    };
  }

  const current = await db.ownerTask.findUnique({ where: { id: data.taskId } });
  if (!current) throw new AgentActionError('task_not_found', 'The owner task no longer exists.', 404);
  if (current.version !== data.expectedVersion) {
    throw new AgentActionError('stale_update', 'The owner task changed after it was read.', 409, {
      expectedVersion: data.expectedVersion,
      currentVersion: current.version,
      current,
    });
  }

  let after;
  if (action === 'owner_task.update') after = { ...current, ...data.patch, version: current.version + 1 };
  if (action === 'owner_task.complete') after = { ...current, status: 'DONE', version: current.version + 1 };
  if (action === 'owner_task.cancel') after = { ...current, status: 'CANCELLED', version: current.version + 1 };
  if (after.status === current.status && ['owner_task.complete', 'owner_task.cancel'].includes(action)) {
    throw new AgentActionError('duplicate_transition', `The owner task is already ${current.status.toLowerCase()}.`, 409, {
      current,
    });
  }
  return {
    entityType: 'OwnerTask',
    entityId: current.id,
    expectedVersion: current.version,
    preview: { operation: action.split('.')[1], before: current, after },
  };
}

function confirmationFor(operation, secret) {
  return buildConfirmationCode({
    operationId: operation.id,
    requestHash: operation.requestHash,
    expiresAt: operation.expiresAt,
    secret,
  });
}

export async function prepareAgentAction(db, agent, body, options = {}) {
  const now = options.now || new Date();
  const env = options.env || process.env;
  const secret = configuredConfirmationSecret(env);
  const request = normalizeActionRequest(body);
  const requestHash = hashActionRequest(request);

  const existing = await db.agentOperation.findUnique({
    where: {
      agentId_action_idempotencyKey: {
        agentId: agent.id,
        action: request.action,
        idempotencyKey: request.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AgentActionError('idempotency_conflict', 'This idempotency key was already used for different data.', 409, {
        operationId: existing.id,
      });
    }
    if (existing.status === 'PREPARED' && new Date(existing.expiresAt).getTime() > now.getTime()) {
      const confirmationCode = confirmationFor(existing, secret);
      return publicOperation(existing, {
        confirmationCode,
        confirmationCommand: `CONFIRM GLINTEX ${confirmationCode}`,
        idempotentReplay: true,
      });
    }
    return publicOperation(existing, { idempotentReplay: true });
  }

  const prepared = await previewAction(db, request);
  const operationId = randomUUID();
  const expiresAt = new Date(now.getTime() + actionTtlSeconds(env) * 1_000);
  const confirmationCode = buildConfirmationCode({ operationId, requestHash, expiresAt, secret });
  const operation = await db.agentOperation.create({
    data: {
      id: operationId,
      agentId: agent.id,
      requesterId: agent.requesterId,
      channel: agent.channel,
      sessionKey: agent.sessionKey,
      action: request.action,
      entityType: prepared.entityType,
      entityId: prepared.entityId,
      status: 'PREPARED',
      idempotencyKey: request.idempotencyKey,
      requestHash,
      request,
      preview: prepared.preview,
      confirmationHash: hashConfirmationCode(confirmationCode),
      expiresAt,
      expectedVersion: prepared.expectedVersion,
    },
  });

  return publicOperation(operation, {
    confirmationCode,
    confirmationCommand: `CONFIRM GLINTEX ${confirmationCode}`,
    idempotentReplay: false,
  });
}

async function applyOperation(tx, operation, now) {
  const request = operation.request;
  const { action, data } = request;
  let entity;

  if (action === 'owner_task.create') {
    entity = await tx.ownerTask.create({
      data: {
        ...data,
        status: 'OPEN',
        version: 1,
        createdByAgentId: operation.agentId,
        updatedByAgentId: operation.agentId,
      },
    });
  }

  if (action === 'owner_task.update') {
    const current = await tx.ownerTask.findUnique({ where: { id: data.taskId } });
    if (!current) throw new AgentActionError('task_not_found', 'The owner task no longer exists.', 404);
    if (current.version !== data.expectedVersion) {
      throw new AgentActionError('stale_update', 'The owner task changed after approval.', 409, {
        expectedVersion: data.expectedVersion,
        currentVersion: current.version,
      });
    }
    const completedAt = data.patch.status === 'DONE'
      ? now
      : (data.patch.status && data.patch.status !== 'DONE' ? null : current.completedAt);
    const updated = await tx.ownerTask.updateMany({
      where: { id: data.taskId, version: data.expectedVersion },
      data: {
        ...data.patch,
        completedAt,
        version: { increment: 1 },
        updatedByAgentId: operation.agentId,
      },
    });
    if (updated.count !== 1) throw new AgentActionError('stale_update', 'The owner task changed during execution.', 409);
    entity = await tx.ownerTask.findUnique({ where: { id: data.taskId } });
  }

  if (action === 'owner_task.complete' || action === 'owner_task.cancel') {
    const targetStatus = action === 'owner_task.complete' ? 'DONE' : 'CANCELLED';
    const updated = await tx.ownerTask.updateMany({
      where: { id: data.taskId, version: data.expectedVersion },
      data: {
        status: targetStatus,
        completedAt: targetStatus === 'DONE' ? now : null,
        version: { increment: 1 },
        updatedByAgentId: operation.agentId,
      },
    });
    if (updated.count !== 1) throw new AgentActionError('stale_update', 'The owner task changed during execution.', 409);
    entity = await tx.ownerTask.findUnique({ where: { id: data.taskId } });
  }

  if (action === 'learning_candidate.propose') {
    entity = await tx.agentLearningCandidate.create({
      data: {
        ...data,
        status: 'PROPOSED',
        version: 1,
        proposedByAgentId: operation.agentId,
      },
    });
  }

  if (!entity) throw new AgentActionError('unsupported_action', 'The prepared action is no longer supported.', 409);
  return entity;
}

async function markOperationFailed(db, operationId, error) {
  try {
    await db.agentOperation.updateMany({
      where: { id: operationId, status: { in: ['PREPARED', 'EXECUTING'] } },
      data: {
        status: 'FAILED',
        failureCode: error.code || 'execution_failed',
        failureMessage: String(error.message || 'Execution failed.').slice(0, 500),
      },
    });
  } catch (markError) {
    console.error('Failed to mark agent operation as failed', { operationId, error: markError?.message });
  }
}

export async function executeAgentAction(db, agent, body, options = {}) {
  const now = options.now || new Date();
  const operationId = String(body?.operationId || '').trim();
  const confirmationCode = String(body?.confirmationCode || '').trim().toUpperCase();
  if (!operationIdIsValid(operationId)) throw new AgentActionError('validation_error', 'operationId is invalid.');

  const operation = await db.agentOperation.findUnique({ where: { id: operationId } });
  if (!operation || operation.agentId !== agent.id || operation.requesterId !== agent.requesterId) {
    throw new AgentActionError('operation_not_found', 'The prepared operation was not found.', 404);
  }
  if (operation.status === 'SUCCEEDED' || operation.status === 'VERIFIED') {
    return publicOperation(operation, { idempotentReplay: true, verificationRequired: operation.status !== 'VERIFIED' });
  }
  if (operation.status !== 'PREPARED') {
    throw new AgentActionError('operation_not_executable', `The operation is ${operation.status.toLowerCase()}.`, 409);
  }
  if (new Date(operation.expiresAt).getTime() <= now.getTime()) {
    await db.agentOperation.update({ where: { id: operation.id }, data: { status: 'EXPIRED' } });
    throw new AgentActionError('confirmation_expired', 'The confirmation code expired. Prepare the action again.', 409);
  }
  if (!confirmationMatches(confirmationCode, operation.confirmationHash)) {
    throw new AgentActionError('confirmation_invalid', 'The confirmation code is invalid.', 403);
  }

  try {
    const completed = await db.$transaction(async (tx) => {
      const claimed = await tx.agentOperation.updateMany({
        where: { id: operation.id, status: 'PREPARED', expiresAt: { gt: now } },
        data: { status: 'EXECUTING' },
      });
      if (claimed.count !== 1) {
        throw new AgentActionError('operation_conflict', 'The operation is already being handled.', 409);
      }

      const entity = await applyOperation(tx, operation, now);
      const result = { entity, operationId: operation.id };
      await tx.auditLog.create({
        data: {
          entityType: operation.entityType,
          entityId: entity.id,
          action: operation.action,
          actorUserId: null,
          actorUsername: 'glintex-owner-agent',
          actorRoleKey: 'glintex_owner_agent',
          payload: {
            operationId: operation.id,
            reason: operation.request.reason,
            requesterId: operation.requesterId,
            channel: operation.channel,
          },
        },
      });
      return tx.agentOperation.update({
        where: { id: operation.id },
        data: {
          entityId: entity.id,
          status: 'SUCCEEDED',
          result,
          executedAt: now,
          failureCode: null,
          failureMessage: null,
        },
      });
    }, { isolationLevel: 'Serializable' });

    return publicOperation(completed, { idempotentReplay: false, verificationRequired: true });
  } catch (error) {
    await markOperationFailed(db, operation.id, error);
    throw error;
  }
}

async function readEntityForOperation(db, operation) {
  if (!operation.entityId) return null;
  if (operation.entityType === 'OwnerTask') {
    return db.ownerTask.findUnique({ where: { id: operation.entityId } });
  }
  if (operation.entityType === 'AgentLearningCandidate') {
    return db.agentLearningCandidate.findUnique({ where: { id: operation.entityId } });
  }
  return null;
}

export async function verifyAgentAction(db, agent, operationId, options = {}) {
  const now = options.now || new Date();
  if (!operationIdIsValid(operationId)) throw new AgentActionError('validation_error', 'operationId is invalid.');
  const operation = await db.agentOperation.findUnique({ where: { id: operationId } });
  if (!operation || operation.agentId !== agent.id || operation.requesterId !== agent.requesterId) {
    throw new AgentActionError('operation_not_found', 'The operation was not found.', 404);
  }
  if (operation.status === 'VERIFIED') {
    return publicOperation(operation, {
      ok: operation.verification?.ok === true,
      idempotentReplay: true,
    });
  }
  if (!['SUCCEEDED', 'VERIFIED', 'VERIFICATION_FAILED'].includes(operation.status)) {
    throw new AgentActionError('operation_not_verifiable', `The operation is ${operation.status.toLowerCase()}.`, 409);
  }
  const entity = await readEntityForOperation(db, operation);
  const expectedEntity = operation.result?.entity;
  const normalizedEntity = entity ? JSON.parse(JSON.stringify(entity)) : null;
  const ok = Boolean(
    normalizedEntity
      && expectedEntity
      && normalizedEntity.id === expectedEntity.id
      && isDeepStrictEqual(normalizedEntity, expectedEntity),
  );
  const verification = {
    ok,
    checkedAt: now.toISOString(),
    entity,
    expectedVersion: expectedEntity?.version ?? null,
    currentVersion: entity?.version ?? null,
  };
  const updated = await db.agentOperation.update({
    where: { id: operation.id },
    data: {
      status: ok ? 'VERIFIED' : 'VERIFICATION_FAILED',
      verification,
      verifiedAt: now,
      failureCode: ok ? null : 'verification_failed',
      failureMessage: ok ? null : 'Stored entity did not match the completed operation.',
    },
  });
  return publicOperation(updated, { ok });
}

export function serializeAgentOperation(operation) {
  return publicOperation(operation);
}

export function toAgentActionError(error) {
  if (error instanceof AgentActionError) return error;
  console.error('Agent action failed', error);
  return new AgentActionError('internal_error', 'The operation could not be completed safely.', 500);
}
