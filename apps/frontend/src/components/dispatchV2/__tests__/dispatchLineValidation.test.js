import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCustomerReservationCompatibility, assertDispatchableSource, buildDispatchLinePayload } from '../dispatchLineValidation.js';

test('queue admission rejects a source reserved to a different customer', () => {
  assert.throws(
    () => assertCustomerReservationCompatibility('customer-b', { queueCustomerIds: ['customer-a'] }),
    /cannot mix customer-reserved units/i,
  );
  assert.throws(
    () => assertCustomerReservationCompatibility('customer-b', { draftCustomerId: 'customer-a' }),
    /reserved to a different Customer/i,
  );
  assert.doesNotThrow(() => assertCustomerReservationCompatibility('customer-a', { queueCustomerIds: ['customer-a'] }));
});

test('Dispatch V2 keeps historical Coning readable but rejects it at queue admission', () => {
  assert.throws(
    () => assertDispatchableSource({ sourceType: 'CONING', historical: true, dispatchable: false }),
    /historical coning.*cannot be admitted/i,
  );
  assert.doesNotThrow(() => assertDispatchableSource({ sourceType: 'HOLO', historical: true }));
});

test('whole Packed Stock dispatch omits optional partial fields', () => {
  const payload = buildDispatchLinePayload({
    sourceType: 'PACKED',
    sourceId: 'unit-1',
    barcode: 'PKU-1',
    availableCount: 8,
    availableNetWeightKg: 2.5,
    dispatchBaseCount: 8,
    dispatchNetWeightKg: 2.5,
    partialDispatch: false,
    residualBaseCount: 0,
    residualNetWeightKg: 0,
    damagedLostBaseCount: 0,
    damagedLostNetWeightKg: 0,
    salvageableBaseCount: 0,
    salvageableWeightKg: 0,
  }, 0);

  assert.deepEqual(payload, {
    sourceType: 'PACKED',
    sourceId: 'unit-1',
    sourceBarcode: 'PKU-1',
    baseCount: 8,
    netWeightKg: 2.5,
    reason: null,
    parentPackedUnitId: null,
  });
  assert.equal(Object.hasOwn(payload, 'residualBaseCount'), false);
  assert.equal(Object.hasOwn(payload, 'damagedLostBaseCount'), false);
  assert.equal(Object.hasOwn(payload, 'salvageableBaseCount'), false);
});

test('whole legacy dispatch omits optional partial fields', () => {
  const payload = buildDispatchLinePayload({
    sourceType: 'INBOUND',
    sourceId: 'receive-1',
    barcode: 'INB-1',
    availableNetWeightKg: 1.5,
    dispatchBaseCount: 12,
    dispatchNetWeightKg: 1.5,
  }, 0);

  assert.equal(payload.baseCount, 12);
  assert.equal(payload.netWeightKg, 1.5);
  assert.equal(Object.hasOwn(payload, 'residualBaseCount'), false);
  assert.equal(Object.hasOwn(payload, 'damagedLostBaseCount'), false);
  assert.equal(Object.hasOwn(payload, 'salvageableBaseCount'), false);
});

test('partial Packed Stock dispatch preserves explicit zero damage fields', () => {
  const payload = buildDispatchLinePayload({
    sourceType: 'PACKED',
    sourceId: 'unit-2',
    barcode: 'PKU-2',
    availableCount: 20,
    availableNetWeightKg: 2.5,
    dispatchBaseCount: 17,
    dispatchNetWeightKg: 2,
    partialDispatch: true,
    allowPartialDispatch: true,
    residualBaseCount: 3,
    residualNetWeightKg: 0.5,
    damagedLostBaseCount: 0,
    damagedLostNetWeightKg: 0,
    salvageableBaseCount: 0,
    salvageableWeightKg: 0,
    partialDispatchReason: 'Customer requested a partial issue',
  }, 0);

  assert.deepEqual(payload, {
    sourceType: 'PACKED',
    sourceId: 'unit-2',
    sourceBarcode: 'PKU-2',
    baseCount: 17,
    netWeightKg: 2,
    reason: 'Customer requested a partial issue',
    parentPackedUnitId: null,
    residualBaseCount: 3,
    residualNetWeightKg: 0.5,
    damagedLostBaseCount: 0,
    damagedLostNetWeightKg: 0,
    salvageableBaseCount: 0,
    salvageableWeightKg: 0,
  });
});
