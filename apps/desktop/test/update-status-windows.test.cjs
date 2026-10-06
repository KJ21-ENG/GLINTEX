const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyUpdateStatus } = require('../scripts/verify-update-status.cjs');
test('real Windows sharing locks recover during helper read, atomic write and cleanup', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const result = await verifyUpdateStatus();
  assert.equal(result.passed, true);
  assert.equal(result.writerRecovered, true);
  assert.equal(result.readRecovered, true);
  assert.equal(result.cleanupRecovered, true);
});
