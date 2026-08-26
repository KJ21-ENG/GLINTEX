import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRecipeLifecycleReason, resolveRecipeSupersedesRecipeId } from '../recipeService.js';

test('recipe activation accepts an omitted or blank optional reason', () => {
  assert.equal(normalizeRecipeLifecycleReason({}), null);
  assert.equal(normalizeRecipeLifecycleReason({ reason: '  checked  ' }), 'checked');
});

test('recipe retirement rejects an omitted or blank reason', () => {
  assert.throws(() => normalizeRecipeLifecycleReason({}, { required: true }), /reason is required/i);
  assert.throws(() => normalizeRecipeLifecycleReason({ reason: '  ' }, { required: true }), /reason is required/i);
  assert.equal(normalizeRecipeLifecycleReason({ reason: '  superseded  ' }, { required: true }), 'superseded');
});

test('new draft versions inherit the active family predecessor when the client omits it', () => {
  assert.equal(resolveRecipeSupersedesRecipeId({ version: 2 }, { id: 'recipe-v1', version: 1 }), 'recipe-v1');
  assert.equal(resolveRecipeSupersedesRecipeId({ version: 1 }, { id: 'recipe-v1', version: 1 }), null);
  assert.equal(resolveRecipeSupersedesRecipeId({ version: 3, supersedesRecipeId: 'explicit-v2' }, { id: 'recipe-v1', version: 1 }), 'explicit-v2');
});
