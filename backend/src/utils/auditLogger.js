import prisma from '../prismaClient.js';

function serializePayload(payload) {
  if (payload === undefined) return null;
  if (payload === null) return null;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to serialize audit payload', err);
    return { error: 'serialization_failed' };
  }
}

export async function logCrud({ entityType, entityId = null, action, payload = null, client }) {
  if (!entityType || !action) {
    return;
  }
  const target = client || prisma;
  try {
    await target.auditLog.create({
      data: {
        entityType,
        entityId,
        action,
        payload: serializePayload(payload),
      },
    });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}
