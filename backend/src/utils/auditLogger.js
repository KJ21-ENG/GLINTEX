import prisma from '../prismaClient.js';

function sanitize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    console.error('Failed to serialize audit payload', err);
    return { error: 'serialization_failed' };
  }
}

function asContainer(value) {
  if (value === undefined) return {};
  const sanitized = sanitize(value);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return { ...sanitized };
  }
  return { value: sanitized };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildChanges(before, after) {
  if (!before || !after) return undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = {};
  keys.forEach((key) => {
    const prev = before[key];
    const next = after[key];
    if (!deepEqual(prev, next)) {
      changes[key] = { before: prev, after: next };
    }
  });
  return Object.keys(changes).length ? changes : undefined;
}

export async function logCrud({ entityType, entityId = null, action, before, after, payload, client }) {
  if (!entityType || !action) return;

  const target = client || prisma;
  try {
    let finalPayload = asContainer(payload);
    const sanitizedBefore = sanitize(before);
    const sanitizedAfter = sanitize(after);
    if (sanitizedBefore !== undefined) finalPayload.before = sanitizedBefore;
    if (sanitizedAfter !== undefined) finalPayload.after = sanitizedAfter;
    const changes = sanitizedBefore !== undefined && sanitizedAfter !== undefined
      ? buildChanges(sanitizedBefore || {}, sanitizedAfter || {})
      : undefined;
    if (changes) finalPayload.changes = changes;

    if (!Object.keys(finalPayload).length) {
      finalPayload = null;
    }
    const payloadText = finalPayload ? JSON.stringify(finalPayload, null, 2) : null;
    const compactPayload = sanitize(payload);

    await target.auditLog.create({
      data: {
        entityType,
        entityId,
        action,
        payload: compactPayload,
        payloadText,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}
