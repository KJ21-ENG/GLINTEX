import assert from 'node:assert/strict';
import test from 'node:test';
import { canDamagePackedUnit, canWriteOffPackedUnit } from '../packingUnitActionState.js';

test('DAMAGED units expose write-off but not a second damage action', () => {
  const unit = { status: 'DAMAGED' };
  assert.equal(canDamagePackedUnit(unit, { canWrite: true }), false);
  assert.equal(canWriteOffPackedUnit(unit, { canWrite: true }), true);
});

test('write-off remains permission and label-state gated', () => {
  const unit = { status: 'DAMAGED' };
  assert.equal(canWriteOffPackedUnit(unit, { canWrite: false }), false);
  assert.equal(canWriteOffPackedUnit(unit, { canWrite: true, saving: true }), false);
  assert.equal(canWriteOffPackedUnit(unit, { canWrite: true, forceLabelPending: true }), false);
});
