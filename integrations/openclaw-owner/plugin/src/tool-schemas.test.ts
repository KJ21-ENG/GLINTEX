import { Check } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { prepareActionParameters } from './tool-schemas.js';

const common = {
  idempotencyKey: 'synthetic.acceptance.test-v1',
  reason: 'Synthetic schema acceptance test.',
};

describe('provider-compatible action schema', () => {
  it('uses one root object instead of a provider-truncated root union', () => {
    expect(prepareActionParameters.type).toBe('object');
    expect(prepareActionParameters).not.toHaveProperty('anyOf');
  });

  it('exposes create, transition, and learning fields to runtime validation', () => {
    expect(Check(prepareActionParameters, {
      action: 'owner_task.create',
      ...common,
      data: { title: 'Synthetic task', area: 'APPLICATION' },
    })).toBe(true);
    expect(Check(prepareActionParameters, {
      action: 'owner_task.cancel',
      ...common,
      data: { taskId: 'task-1', expectedVersion: 1 },
    })).toBe(true);
    expect(Check(prepareActionParameters, {
      action: 'learning_candidate.propose',
      ...common,
      data: { category: 'WORKFLOW_GAP', statement: 'Synthetic proposal.' },
    })).toBe(true);
  });

  it('still rejects unknown and misplaced fields at the plugin boundary', () => {
    expect(Check(prepareActionParameters, {
      action: 'owner_task.cancel',
      ...common,
      taskId: 'task-1',
      data: { expectedVersion: 1 },
    })).toBe(false);
    expect(Check(prepareActionParameters, {
      action: 'owner_task.cancel',
      ...common,
      data: { taskId: 'task-1', expectedVersion: 1, arbitrary: true },
    })).toBe(false);
  });
});
