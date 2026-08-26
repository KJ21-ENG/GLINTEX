import assert from 'node:assert/strict';
import test from 'node:test';
import { IDEMPOTENT_TRANSACTION_OPTIONS, runIdempotent } from '../idempotency.js';

test('idempotent mutations use a bounded lock-wait transaction and replay one stored result', async () => {
  let storedResult;
  let workCalls = 0;
  const transactionOptions = [];
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => (storedResult === undefined ? [] : [{ payload: { result: storedResult } }]),
    auditLog: {
      create: async ({ data }) => {
        storedResult = data.payload.result;
      },
    },
  };
  const client = {
    $transaction: async (work, options) => {
      transactionOptions.push(options);
      return work(tx);
    },
  };

  const first = await runIdempotent({
    operation: 'test.reservation',
    idempotencyKey: 'same-key',
    client,
    work: async () => {
      workCalls += 1;
      return { id: 'result-1', reserved: true };
    },
  });
  const replay = await runIdempotent({
    operation: 'test.reservation',
    idempotencyKey: 'same-key',
    client,
    work: async () => {
      workCalls += 1;
      return { id: 'unexpected', reserved: true };
    },
  });

  assert.deepEqual(first, { replay: false, result: { id: 'result-1', reserved: true } });
  assert.deepEqual(replay, { replay: true, result: { id: 'result-1', reserved: true } });
  assert.equal(workCalls, 1);
  assert.deepEqual(transactionOptions, [IDEMPOTENT_TRANSACTION_OPTIONS, IDEMPOTENT_TRANSACTION_OPTIONS]);
});
