import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { badRequest, conflict } from '../packing/errors.js';
import { toJsonSafe } from '../packing/serialization.js';

// Source reservations and other idempotent mutations may wait briefly for a
// deterministically ordered row lock held by a competing request. Prisma's
// five-second interactive-transaction defaults turn that expected wait into
// an internal error and can leave a same-key replay waiting behind it. Keep
// the wait bounded while allowing the first transaction to finish atomically.
export const IDEMPOTENT_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000,
});

function normalizeKey(value) {
  const key = String(value || '').trim();
  if (!key) throw badRequest('idempotency_key_required', 'Idempotency-Key header is required for this mutation.');
  if (key.length > 200) throw badRequest('idempotency_key_too_long', 'Idempotency-Key must be 200 characters or fewer.');
  return key;
}

function actorFields(actorUserId) {
  return actorUserId ? { actorUserId: String(actorUserId) } : {};
}

async function lockIdempotencyKey(tx, operation, key) {
  const namespaced = `${operation}:${key}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${namespaced}))`);
}

async function findStoredResult(tx, operation, key) {
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT "payload"
    FROM "AuditLog"
    WHERE "entityType" = 'packing_idempotency'
      AND "action" = ${operation}
      AND "payload"->>'idempotencyKey' = ${key}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  const payload = rows?.[0]?.payload;
  return payload && typeof payload === 'object' ? payload.result : undefined;
}

export async function runIdempotent({
  operation,
  idempotencyKey,
  actorUserId = null,
  work,
  client = prisma,
}) {
  const key = normalizeKey(idempotencyKey);
  if (typeof work !== 'function') throw conflict('idempotency_work_missing', 'The mutation handler is not configured.');

  return client.$transaction(async (tx) => {
    await lockIdempotencyKey(tx, operation, key);
    const stored = await findStoredResult(tx, operation, key);
    if (stored !== undefined) return { replay: true, result: stored };

    const result = await work(tx, key);
    const safeResult = toJsonSafe(result);
    await tx.auditLog.create({
      data: {
        entityType: 'packing_idempotency',
        entityId: result?.id ? String(result.id) : null,
        action: operation,
        ...actorFields(actorUserId),
        payload: { idempotencyKey: key, result: safeResult },
      },
    });
    return { replay: false, result };
  }, IDEMPOTENT_TRANSACTION_OPTIONS);
}

export function getIdempotencyKeyFromRequest(req) {
  return req.get('Idempotency-Key') || req.get('idempotency-key') || null;
}
