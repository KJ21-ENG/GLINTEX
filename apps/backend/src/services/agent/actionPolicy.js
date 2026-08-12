import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const AGENT_ACTIONS = Object.freeze([
  'owner_task.create',
  'owner_task.update',
  'owner_task.complete',
  'owner_task.cancel',
  'learning_candidate.propose',
]);

export const TASK_AREAS = Object.freeze([
  'FINANCE',
  'INVENTORY',
  'TECHNOLOGY',
  'APPLICATION',
  'OPERATIONS',
  'GENERAL',
]);

export const TASK_PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const TASK_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']);
export const LEARNING_CATEGORIES = Object.freeze([
  'OWNER_PREFERENCE',
  'DOMAIN_RULE',
  'WORKFLOW_GAP',
  'PROCESS_IMPROVEMENT',
]);

const ACTION_SET = new Set(AGENT_ACTIONS);
const AREA_SET = new Set(TASK_AREAS);
const PRIORITY_SET = new Set(TASK_PRIORITIES);
const STATUS_SET = new Set(TASK_STATUSES);
const LEARNING_CATEGORY_SET = new Set(LEARNING_CATEGORIES);
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIRMATION_RE = /^GLX-[A-F0-9]{10}$/;

export class AgentActionError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AgentActionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentActionError('validation_error', `${field} must be an object.`, 400, { field });
  }
  return value;
}

function cleanString(value, field, { min = 1, max = 500, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') {
    throw new AgentActionError('validation_error', `${field} must be a string.`, 400, { field });
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new AgentActionError(
      'validation_error',
      `${field} must contain between ${min} and ${max} characters.`,
      400,
      { field, min, max },
    );
  }
  return normalized;
}

function optionalString(value, field, options = {}) {
  if (value === undefined) return undefined;
  return cleanString(value, field, options);
}

function enumValue(value, field, allowed) {
  const normalized = cleanString(value, field, { min: 1, max: 64 }).toUpperCase();
  if (!allowed.has(normalized)) {
    throw new AgentActionError('validation_error', `${field} is not supported.`, 400, {
      field,
      allowed: Array.from(allowed),
    });
  }
  return normalized;
}

function optionalEnum(value, field, allowed) {
  if (value === undefined) return undefined;
  return enumValue(value, field, allowed);
}

function dateValue(value, field, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  const normalized = cleanString(value, field, { min: 10, max: 10 });
  if (!DATE_RE.test(normalized)) {
    throw new AgentActionError('validation_error', `${field} must use YYYY-MM-DD.`, 400, { field });
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new AgentActionError('validation_error', `${field} is not a real calendar date.`, 400, { field });
  }
  return normalized;
}

function optionalDate(value, field, options = {}) {
  if (value === undefined) return undefined;
  return dateValue(value, field, options);
}

function versionValue(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new AgentActionError('validation_error', 'expectedVersion must be a positive integer.', 400, {
      field: 'data.expectedVersion',
    });
  }
  return version;
}

function rejectExtraKeys(value, allowed, field) {
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length > 0) {
    throw new AgentActionError('validation_error', `${field} contains unsupported fields.`, 400, {
      field,
      unsupported: extra,
    });
  }
}

function normalizeTaskCreate(data) {
  rejectExtraKeys(data, new Set(['title', 'description', 'area', 'priority', 'dueDate']), 'data');
  return {
    title: cleanString(data.title, 'data.title', { max: 160 }),
    description: optionalString(data.description, 'data.description', { max: 2_000, nullable: true }) ?? null,
    area: data.area === undefined ? 'GENERAL' : enumValue(data.area, 'data.area', AREA_SET),
    priority: data.priority === undefined ? 'MEDIUM' : enumValue(data.priority, 'data.priority', PRIORITY_SET),
    dueDate: optionalDate(data.dueDate, 'data.dueDate', { nullable: true }) ?? null,
  };
}

function normalizeTaskUpdate(data) {
  rejectExtraKeys(data, new Set(['taskId', 'expectedVersion', 'patch']), 'data');
  const patch = plainObject(data.patch, 'data.patch');
  rejectExtraKeys(patch, new Set(['title', 'description', 'area', 'priority', 'status', 'dueDate']), 'data.patch');
  const normalizedPatch = {
    title: optionalString(patch.title, 'data.patch.title', { max: 160 }),
    description: optionalString(patch.description, 'data.patch.description', { max: 2_000, nullable: true }),
    area: optionalEnum(patch.area, 'data.patch.area', AREA_SET),
    priority: optionalEnum(patch.priority, 'data.patch.priority', PRIORITY_SET),
    status: optionalEnum(patch.status, 'data.patch.status', STATUS_SET),
    dueDate: optionalDate(patch.dueDate, 'data.patch.dueDate', { nullable: true }),
  };
  Object.keys(normalizedPatch).forEach((key) => {
    if (normalizedPatch[key] === undefined) delete normalizedPatch[key];
  });
  if (Object.keys(normalizedPatch).length === 0) {
    throw new AgentActionError('validation_error', 'data.patch must change at least one supported field.', 400, {
      field: 'data.patch',
    });
  }
  return {
    taskId: cleanString(data.taskId, 'data.taskId', { max: 80 }),
    expectedVersion: versionValue(data.expectedVersion),
    patch: normalizedPatch,
  };
}

function normalizeTaskTransition(data) {
  rejectExtraKeys(data, new Set(['taskId', 'expectedVersion']), 'data');
  return {
    taskId: cleanString(data.taskId, 'data.taskId', { max: 80 }),
    expectedVersion: versionValue(data.expectedVersion),
  };
}

function normalizeLearningCandidate(data) {
  rejectExtraKeys(data, new Set(['category', 'statement', 'evidence']), 'data');
  return {
    category: enumValue(data.category, 'data.category', LEARNING_CATEGORY_SET),
    statement: cleanString(data.statement, 'data.statement', { max: 1_000 }),
    evidence: optionalString(data.evidence, 'data.evidence', { max: 2_000, nullable: true }) ?? null,
  };
}

export function normalizeActionRequest(body) {
  const request = plainObject(body, 'request');
  rejectExtraKeys(request, new Set(['action', 'idempotencyKey', 'reason', 'data']), 'request');
  const action = cleanString(request.action, 'action', { max: 80 });
  if (!ACTION_SET.has(action)) {
    throw new AgentActionError('unsupported_action', 'This action is not exposed to the owner agent.', 400, {
      allowed: AGENT_ACTIONS,
    });
  }
  const idempotencyKey = cleanString(request.idempotencyKey, 'idempotencyKey', { min: 8, max: 128 });
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) {
    throw new AgentActionError('validation_error', 'idempotencyKey has an invalid format.', 400, {
      field: 'idempotencyKey',
    });
  }
  const reason = cleanString(request.reason, 'reason', { max: 500 });
  const data = plainObject(request.data, 'data');

  let normalizedData;
  if (action === 'owner_task.create') normalizedData = normalizeTaskCreate(data);
  if (action === 'owner_task.update') normalizedData = normalizeTaskUpdate(data);
  if (action === 'owner_task.complete' || action === 'owner_task.cancel') normalizedData = normalizeTaskTransition(data);
  if (action === 'learning_candidate.propose') normalizedData = normalizeLearningCandidate(data);

  return { action, idempotencyKey, reason, data: normalizedData };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function hashActionRequest(request) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(request)), 'utf8')
    .digest('hex');
}

export function buildConfirmationCode({ operationId, requestHash, expiresAt, secret }) {
  if (!OPERATION_ID_RE.test(String(operationId || ''))) {
    throw new AgentActionError('validation_error', 'operationId is invalid.');
  }
  if (!/^[a-f0-9]{64}$/.test(String(requestHash || ''))) {
    throw new AgentActionError('validation_error', 'requestHash is invalid.');
  }
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new AgentActionError('agent_not_configured', 'Agent confirmation policy is unavailable.', 503);
  }
  const expires = new Date(expiresAt);
  if (!Number.isFinite(expires.getTime())) {
    throw new AgentActionError('validation_error', 'expiresAt is invalid.');
  }
  const digest = createHmac('sha256', secret)
    .update(`${operationId}:${requestHash}:${expires.toISOString()}`, 'utf8')
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return `GLX-${digest}`;
}

export function hashConfirmationCode(code) {
  return createHash('sha256').update(String(code || '').toUpperCase(), 'utf8').digest('hex');
}

export function isValidConfirmationCode(code) {
  return CONFIRMATION_RE.test(String(code || '').trim().toUpperCase());
}

export function confirmationMatches(code, expectedHash) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!isValidConfirmationCode(normalized) || !/^[a-f0-9]{64}$/.test(String(expectedHash || ''))) return false;
  const actualBuffer = Buffer.from(hashConfirmationCode(normalized), 'utf8');
  const expectedBuffer = Buffer.from(expectedHash, 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function operationIdIsValid(value) {
  return OPERATION_ID_RE.test(String(value || ''));
}

export function requiredScopeForAction(action) {
  return action === 'learning_candidate.propose' ? 'learning.propose' : 'tasks.write';
}
