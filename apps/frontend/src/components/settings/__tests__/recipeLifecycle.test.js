import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRecipeLifecyclePayload } from '../recipeLifecycle.js';
import { validateRecipeDraft } from '../recipeValidation.js';

const packingSettingsSource = readFileSync(new URL('../PackingSettings.jsx', import.meta.url), 'utf8');

test('activation keeps an optional trimmed reason and allows an empty note', () => {
  assert.deepEqual(buildRecipeLifecyclePayload('activate', '  reviewed by QA  '), { reason: 'reviewed by QA' });
  assert.deepEqual(buildRecipeLifecyclePayload('activate', ''), { reason: null });
});

test('retirement requires a non-empty trimmed reason', () => {
  assert.deepEqual(buildRecipeLifecyclePayload('retire', '  superseded  '), { reason: 'superseded' });
  assert.throws(() => buildRecipeLifecyclePayload('retire', '   '), /retirement reason is required/i);
});

test('recipe validation exposes a stable error for negative child-unit counts', () => {
  const error = validateRecipeDraft({
    familyKey: 'family',
    version: '2',
    warningVariancePercent: '2',
    approvalVariancePercent: '5',
    levels: [{ packageTypeId: 'packet', childUnitsPerContainer: '-1' }],
  });
  assert.equal(error, 'Every recipe level needs a package type and positive whole child-unit count.');
});

test('recipe draft submit delegates native-invalid values to the visible app validation', () => {
  assert.ok(packingSettingsSource.includes('<form className="space-y-5" noValidate onSubmit={submit}>'));
});
