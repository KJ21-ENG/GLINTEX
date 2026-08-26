import assert from 'node:assert/strict';
import test from 'node:test';
import { canUsePackingUnitLabelActions, isAuthoritativePackingLabelPending, normalizePackingLabelResponse, unwrapPackingLabel } from '../packingLabel.js';

const authoritativeLabel = {
  barcode: 'PK-0001',
  itemName: 'S/S D COPPER-SML',
  baseCount: 1,
};

test('unwraps the label-service envelope returned by packing mutations', () => {
  const response = normalizePackingLabelResponse({
    unit: { id: 'unit-1', status: 'AVAILABLE' },
    label: { label: authoritativeLabel, labelText: 'PK-0001\nS/S D COPPER-SML\n1' },
    labelPending: false,
  });

  assert.deepEqual(response.label, authoritativeLabel);
  assert.equal(response.labelPending, false);
  assert.equal(response.unit.id, 'unit-1');
});

test('normalizes a replacement response without losing the replacement identity', () => {
  const response = normalizePackingLabelResponse({
    replacementUnit: { id: 'unit-2', status: 'AVAILABLE' },
    label: { label: { ...authoritativeLabel, barcode: 'PK-0002' }, labelText: 'PK-0002' },
  });

  assert.equal(response.unit.id, 'unit-2');
  assert.equal(response.label.barcode, 'PK-0002');
  assert.equal(response.labelPending, false);
});

test('keeps an incomplete authoritative label pending instead of fabricating fields', () => {
  const response = normalizePackingLabelResponse({
    unit: { id: 'unit-3', status: 'AVAILABLE' },
    label: { label: { barcode: 'PK-0003' }, labelText: 'PK-0003' },
  });

  assert.equal(response.label, null);
  assert.equal(response.labelPending, true);
});

test('accepts a direct DTO for already-normalized callers', () => {
  assert.deepEqual(unwrapPackingLabel(authoritativeLabel), authoritativeLabel);
});

test('allows Packing label actions only for writable sealed identities', () => {
  const unit = { barcode: 'PK-0001', status: 'AVAILABLE' };
  assert.equal(canUsePackingUnitLabelActions(unit, { canWrite: true }), true);
  assert.equal(canUsePackingUnitLabelActions(unit, { canWrite: false }), false);
  assert.equal(canUsePackingUnitLabelActions(unit, { canWrite: true, saving: true }), false);
  assert.equal(canUsePackingUnitLabelActions({ ...unit, status: 'IN_PROGRESS' }, { canWrite: true }), false);
  assert.equal(canUsePackingUnitLabelActions(unit, { canWrite: true, forceLabelPending: true }), false);
});

test('distinguishes a local printer failure from an authoritative pending label', () => {
  assert.equal(isAuthoritativePackingLabelPending({ unit: { id: 'unit-1', status: 'AVAILABLE' }, label: authoritativeLabel }), false);
  assert.equal(isAuthoritativePackingLabelPending({ unit: { id: 'unit-1', status: 'LABEL_PENDING' }, labelPending: true }), true);
});
