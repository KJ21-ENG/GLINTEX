import test from 'node:test';
import assert from 'node:assert/strict';
import { captureProvenance, transactionWeightProvenance } from '../weightProvenance.js';
test('native capture retains precision and identity', () => {
  const p = captureProvenance({ weightKg: 12.34567, captureId: 'capture-1', rawFrame: 'ST 12.34567 kg', profileId: 'st-us-line', unit: 'kg', device: { path: 'COM3' }, source: 'native-scale' });
  assert.equal(p.weightKg, 12.34567);
  assert.equal(p.captureId, 'capture-1');
  assert.equal(p.rawFrame, 'ST 12.34567 kg');
  assert.equal(transactionWeightProvenance('12.34567', p), p);
  assert.equal(transactionWeightProvenance('12.346', p).source, 'manual');
});
