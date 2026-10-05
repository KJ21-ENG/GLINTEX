import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWeightProvenance, collectWeightProvenance } from '../weightProvenance.js';
test('backward compatible without capture and exact precision', () => {
  assert.deepEqual(collectWeightProvenance({}), []);
  assert.equal(validateWeightProvenance({ source: 'scale', weightKg: 12.34567 }, 12.34567).weightKg, 12.34567);
});
test('reject invalid metadata and weight mismatch before mutation', () => {
  for (const v of [{ source: 'guess', weightKg: 4 }, { source: 'scale', weightKg: Infinity }, { source: 'scale', weightKg: 4, timestamp: 'invalid' }]) assert.throws(() => validateWeightProvenance(v));
  assert.throws(() => validateWeightProvenance({ source: 'scale', weightKg: 4 }, 5));
});
test('bounded allowlisted metadata excludes secrets', () => {
  const result = validateWeightProvenance({ source: 'scale', weightKg: 1, rawFrame: 'x'.repeat(900), token: 'secret', device: { path: 'COM3', token: 'secret' } });
  assert.equal(result.rawFrame.length, 512);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('batch provenance preserves row indices', () => {
  const r = collectWeightProvenance({ crates: [{ grossWeight: 1, weightProvenance: { source: 'manual', weightKg: 1 } }] });
  assert.equal(r[0].field, 'crates[0]');
});

test('middleware rejects before transaction handler and accepts legacy requests', async () => {
  const { validateTransactionWeightProvenance } = await import('../weightProvenance.js');
  let nextCalls = 0, status, body;
  const response = { status(code) { status = code; return this; }, json(value) { body = value; } };
  validateTransactionWeightProvenance({ body: { grossWeight: 4, weightProvenance: { source: 'scale', weightKg: 5 } } }, response, () => nextCalls++);
  assert.equal(status, 400); assert.equal(nextCalls, 0); assert.match(body.error, /match/);
  const legacy = { body: { grossWeight: 4 } };
  validateTransactionWeightProvenance(legacy, response, () => nextCalls++);
  assert.equal(nextCalls, 1); assert.deepEqual(legacy.weightProvenance, []);
});
