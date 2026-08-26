import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdempotencyKey } from '../packingRequest.js';

test('Packing idempotency UUID generation preserves the Crypto receiver', () => {
  const cryptoObject = {
    randomUUID() {
      assert.equal(this, cryptoObject);
      return 'uuid-1';
    },
  };

  assert.equal(createIdempotencyKey('packing', cryptoObject), 'packing-uuid-1');
});
