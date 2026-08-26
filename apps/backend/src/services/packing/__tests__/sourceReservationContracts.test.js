import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSourceReleaseWithinResidual,
  preflightPackingBatchSourceMutation,
  preflightPackingBatchSourceReservation,
} from '../batchService.js';

const source = {
  sourceId: 'qa-source-1',
  reservedBaseCount: 20,
  reservedNetWeightKg: 2.5,
  consumedBaseCount: 0,
  consumedNetWeightKg: 0,
  releasedBaseCount: 0,
  releasedNetWeightKg: 0,
};

function clientFor(batch = { status: 'CONFIRMED', kind: 'INITIAL' }, sourceRow = source) {
  const calls = [];
  return {
    calls,
    packingBatch: {
      findUnique: async (args) => {
        calls.push(['batch', args]);
        return batch;
      },
    },
    packingBatchSource: {
      findFirst: async (args) => {
        calls.push(['source', args]);
        return sourceRow;
      },
    },
  };
}

function excessivePayload() {
  return {
    reason: 'QA excessive release',
    sourceDelta: {
      additions: [],
      releases: [{ sourceType: 'CONING_RECEIVE', sourceId: 'qa-source-1', releasedBaseCount: 21, releasedNetWeightKg: 2.625 }],
    },
  };
}

test('the packing preflight exposes the authoritative residual error before writes_gated', async () => {
  const client = clientFor();
  const invoke = () => preflightPackingBatchSourceReservation({ batchId: 'qa-batch-1', payload: excessivePayload(), client });
  const first = await invoke().catch((error) => ({ code: error.code, statusCode: error.statusCode, message: error.message, details: error.details }));
  const replay = await invoke().catch((error) => ({ code: error.code, statusCode: error.statusCode, message: error.message, details: error.details }));

  assert.deepEqual(first, replay);
  assert.equal(first.code, 'source_release_exceeds_residual');
  assert.equal(first.statusCode, 400);
  assert.equal(first.message, 'A reservation release cannot exceed the source residual after completed consumption.');
  assert.deepEqual(first.details.residual, { count: 20, weight: 2.5 });
  assert.equal(client.calls.filter(([kind]) => kind === 'batch').length, 2);
  assert.equal(client.calls.filter(([kind]) => kind === 'source').length, 2);
});

test('a valid confirmed-batch release is a no-op for preflight and remains available to the normal gate', async () => {
  const client = clientFor();
  const payload = {
    reason: 'QA valid release',
    sourceDelta: {
      additions: [],
      releases: [{ sourceType: 'CONING_RECEIVE', sourceId: 'qa-source-1', releasedBaseCount: 2, releasedNetWeightKg: 0.25 }],
    },
  };
  await assert.doesNotReject(() => preflightPackingBatchSourceMutation({ path: '/api/packing/batches/qa-batch-1/sources/reserve', body: payload }, { client }));
  assert.equal(client.calls.filter(([kind]) => kind === 'batch').length, 1);
  assert.equal(client.calls.filter(([kind]) => kind === 'source').length, 1);
  assert.doesNotThrow(() => assertSourceReleaseWithinResidual(source, { releasedBaseCount: 2, releasedNetWeightKg: 0.25 }));
});

test('the preflight does not classify ineligible batches or unsupported source kinds before the generic gate', async () => {
  await assert.doesNotReject(() => preflightPackingBatchSourceReservation({
    batchId: 'qa-draft-batch',
    payload: excessivePayload(),
    client: clientFor({ status: 'DRAFT', kind: 'INITIAL' }),
  }));
  await assert.doesNotReject(() => preflightPackingBatchSourceReservation({
    batchId: 'qa-opening-batch',
    payload: excessivePayload(),
    client: clientFor({ status: 'CONFIRMED', kind: 'OPENING' }),
  }));
});
