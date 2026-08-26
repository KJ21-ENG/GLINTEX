import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';

export const PACKING_LAUNCH_STATE_ID = 'packing_dispatch_v2';

export const AFFECTED_WRITE_OPERATIONS = Object.freeze([
  'dispatch-v2',
  'reconing',
  'packing',
  'packed-stock',
  'legacy-dispatch',
  'legacy-stock',
]);

const WRITE_GATE_STATUSES = new Set(['WRITES_GATED', 'CUTOVER_APPLIED', 'FAILED', 'REVERSED']);
const OPERATION_ALIASES = new Map([
  ['re-coning', 'reconing'],
  ['reconing', 'reconing'],
  ['dispatch-v2', 'dispatch-v2'],
  ['dispatch', 'dispatch-v2'],
  ['packing', 'packing'],
  ['packed-stock', 'packed-stock'],
  ['stock', 'packed-stock'],
  ['affected-stock', 'packed-stock'],
  ['legacy-dispatch', 'legacy-dispatch'],
  ['legacy-stock', 'legacy-stock'],
]);
const NEW_WRITE_OPERATIONS = new Set(['packing', 'packed-stock', 'dispatch-v2']);
const LEGACY_WRITE_OPERATIONS = new Set(['reconing', 'legacy-dispatch', 'legacy-stock']);

const NEW_WRITE_PERMISSION_KEYS = new Map([
  ['packing', 'packing'],
  ['packed-stock', 'packing'],
  ['dispatch-v2', 'dispatch'],
]);

export class AffectedWritesGatedError extends Error {
  constructor(operation, launchState, { reason = 'writes_gated', requiredStatus = null } = {}) {
    const normalizedOperation = normalizeOperation(operation);
    super(`The ${normalizedOperation} write path is temporarily gated during Packing cutover.`);
    this.name = 'AffectedWritesGatedError';
    this.code = 'writes_gated';
    this.statusCode = 423;
    this.details = {
      operation: normalizedOperation,
      launchState: launchState?.status || 'UNAVAILABLE',
      affectedWritesPaused: true,
      reason,
      ...(requiredStatus ? { requiredStatus } : {}),
    };
  }
}

function normalizeOperation(operation) {
  const value = String(operation || '').trim().toLowerCase();
  const normalized = OPERATION_ALIASES.get(value);
  if (!normalized) {
    throw new Error(`Unsupported affected-write operation: ${value || '(empty)'}`);
  }
  return normalized;
}

export function hasNewWritePermission(req, operation) {
  const normalizedOperation = normalizeOperation(operation);
  if (!NEW_WRITE_OPERATIONS.has(normalizedOperation)) return false;
  if (req?.user?.isAdmin) return true;
  const permissionKey = NEW_WRITE_PERMISSION_KEYS.get(normalizedOperation);
  return Number(req?.user?.permissions?.[permissionKey] || 0) >= 2;
}

export function isAffectedWriteGated(launchState) {
  if (!launchState) return true;
  return Boolean(launchState.affectedWritesPaused) || WRITE_GATE_STATUSES.has(String(launchState.status || '').toUpperCase());
}

export async function readLaunchState(client = prisma) {
  return client.packingLaunchState.findUnique({ where: { id: PACKING_LAUNCH_STATE_ID } });
}

export async function getOrCreateLaunchState(client = prisma) {
  return client.packingLaunchState.upsert({
    where: { id: PACKING_LAUNCH_STATE_ID },
    update: {},
    create: { id: PACKING_LAUNCH_STATE_ID },
  });
}

export async function assertAffectedWriteAllowed(operation, { client = prisma } = {}) {
  const normalizedOperation = normalizeOperation(operation);
  const launchState = await readLaunchState(client);
  const isNewWrite = NEW_WRITE_OPERATIONS.has(normalizedOperation);
  const isLegacyWrite = LEGACY_WRITE_OPERATIONS.has(normalizedOperation);

  if (!isNewWrite && !isLegacyWrite) {
    throw new AffectedWritesGatedError(normalizedOperation, launchState, { reason: 'unsupported_write_policy' });
  }

  // Preserve the old browser/client behavior before the launch singleton is
  // created, but fail closed for all new Packing, Packed Stock, and V2 writes.
  if (!launchState) {
    if (isLegacyWrite) {
      return {
        id: PACKING_LAUNCH_STATE_ID,
        status: 'PREPARATION',
        affectedWritesPaused: false,
        cutoffAt: null,
        adjustmentBatchId: null,
        lastError: null,
        synthetic: true,
      };
    }
    throw new AffectedWritesGatedError(normalizedOperation, launchState, { reason: 'launch_state_required', requiredStatus: 'ACTIVE' });
  }

  if (isNewWrite) {
    if (launchState.status !== 'ACTIVE' || launchState.affectedWritesPaused) {
      throw new AffectedWritesGatedError(normalizedOperation, launchState, { reason: 'active_launch_required', requiredStatus: 'ACTIVE' });
    }
    return launchState;
  }

  if (isAffectedWriteGated(launchState)) {
    throw new AffectedWritesGatedError(normalizedOperation, launchState);
  }
  if (!['PREPARATION', 'ACTIVE'].includes(launchState.status)) {
    throw new AffectedWritesGatedError(normalizedOperation, launchState, { reason: 'unsupported_launch_phase' });
  }
  return launchState;
}

export function createAffectedWriteGateMiddleware(operation, { client = prisma } = {}) {
  const normalizedOperation = normalizeOperation(operation);
  return async (req, res, next) => {
    try {
      await assertAffectedWriteAllowed(normalizedOperation, { client });
      return next();
    } catch (error) {
      if (error instanceof AffectedWritesGatedError) {
        return res.status(error.statusCode).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }
      return next(error);
    }
  };
}

export async function runDeterministicWritePreflight({ preflight, gate } = {}) {
  if (typeof preflight === 'function') await preflight();
  return gate();
}

export const requireAffectedWriteAccess = createAffectedWriteGateMiddleware;
export const assertWriteGateOpen = assertAffectedWriteAllowed;

async function lockLaunchState(tx) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('packing-dispatch-v2-launch-state'))`);
}

export async function transitionLaunchState({
  status,
  affectedWritesPaused,
  cutoffAt,
  adjustmentBatchId,
  lastError,
  actorUserId = null,
  client = prisma,
} = {}) {
  const normalizedStatus = String(status || '').trim().toUpperCase();
  const allowedStatuses = ['PREPARATION', 'WRITES_GATED', 'CUTOVER_APPLIED', 'ACTIVE', 'FAILED', 'REVERSED'];
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new Error(`Unsupported Packing launch state: ${normalizedStatus || '(empty)'}`);
  }

  return client.$transaction(async (tx) => {
    await lockLaunchState(tx);
    const data = {
      status: normalizedStatus,
      affectedWritesPaused: Boolean(affectedWritesPaused),
      ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}),
    };
    if (cutoffAt !== undefined) data.cutoffAt = cutoffAt;
    if (adjustmentBatchId !== undefined) data.adjustmentBatchId = adjustmentBatchId;
    if (lastError !== undefined) data.lastError = lastError;

    return tx.packingLaunchState.upsert({
      where: { id: PACKING_LAUNCH_STATE_ID },
      update: data,
      create: {
        id: PACKING_LAUNCH_STATE_ID,
        ...data,
      },
    });
  });
}

export function writeGateErrorResponse(error) {
  if (!(error instanceof AffectedWritesGatedError)) return null;
  return {
    statusCode: error.statusCode,
    body: {
      error: error.code,
      message: error.message,
      details: error.details,
    },
  };
}
