import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentActionError,
  buildConfirmationCode,
  confirmationMatches,
  hashActionRequest,
  hashConfirmationCode,
  normalizeActionRequest,
} from '../actionPolicy.js';

test('normalizes an owner task create action with bounded defaults', () => {
  assert.deepEqual(normalizeActionRequest({
    action: 'owner_task.create',
    idempotencyKey: 'task-20260812-001',
    reason: 'Owner asked to follow up on inventory variance.',
    data: { title: 'Review inventory variance', area: 'inventory' },
  }), {
    action: 'owner_task.create',
    idempotencyKey: 'task-20260812-001',
    reason: 'Owner asked to follow up on inventory variance.',
    data: {
      title: 'Review inventory variance',
      description: null,
      area: 'INVENTORY',
      priority: 'MEDIUM',
      dueDate: null,
    },
  });
});

test('requires optimistic concurrency for updates and rejects extra fields', () => {
  assert.throws(() => normalizeActionRequest({
    action: 'owner_task.update',
    idempotencyKey: 'task-20260812-002',
    reason: 'Update priority.',
    data: { taskId: 'task-1', patch: { priority: 'high' } },
  }), AgentActionError);

  assert.throws(() => normalizeActionRequest({
    action: 'owner_task.create',
    idempotencyKey: 'task-20260812-003',
    reason: 'Invalid payload.',
    data: { title: 'Unsafe', shell: 'rm -rf /' },
  }), /unsupported fields/i);
});

test('canonical action hashes are stable across object key order', () => {
  assert.equal(
    hashActionRequest({ b: 2, a: { y: 2, x: 1 } }),
    hashActionRequest({ a: { x: 1, y: 2 }, b: 2 }),
  );
});

test('confirmation codes are deterministic, scoped, and timing-safe comparable', () => {
  const input = {
    operationId: 'b8ae4ff9-b148-4fde-a9fd-061bb6d855c8',
    requestHash: 'a'.repeat(64),
    expiresAt: new Date('2026-08-12T10:00:00Z'),
    secret: 's'.repeat(48),
  };
  const code = buildConfirmationCode(input);
  assert.match(code, /^GLX-[A-F0-9]{10}$/);
  assert.equal(confirmationMatches(code, hashConfirmationCode(code)), true);
  assert.equal(confirmationMatches('GLX-0000000000', hashConfirmationCode(code)), false);
  assert.notEqual(code, buildConfirmationCode({ ...input, operationId: 'a3d005af-280d-4f43-a381-029bb61baa48' }));
});
