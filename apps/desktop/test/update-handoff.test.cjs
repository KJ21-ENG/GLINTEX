const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { retryStatusAccess, waitForHelper } = require('../src/updates/status-file.cjs');
const expected = { parentPid: 123, release: { version: '1.1.4' } };
const ready = JSON.stringify({ state: 'waiting', parentPid: 123, version: '1.1.4' });
const ioError = code => Object.assign(new Error(code), { code });
function childFixture() {
  const child = new EventEmitter();
  child.killed = false; child.detached = false;
  child.kill = () => { child.killed = true; };
  child.unref = () => { child.detached = true; };
  return child;
}
function timed(readFile) {
  let now = 0;
  return { readFile, timeout: 1000, clock: () => now, wait: async ms => { now += ms; } };
}
test('a locked status read retries until the matching Windows helper acknowledges', async () => {
  const child = childFixture();
  const errors = ['EBUSY', 'EACCES', 'EPERM', 'ENOENT'];
  let reads = 0;
  await waitForHelper(child, 'status.json', expected, timed(async () => {
    const code = errors[reads++]; if (code) throw ioError(code); return ready;
  }));
  assert.equal(reads, 5); assert.equal(child.killed, false); assert.equal(child.detached, true);
  assert.equal(child.listenerCount('exit'), 0);
});
test('permanent locking is bounded, keeps GLINTEX open and stops the waiting helper', async () => {
  const child = childFixture(); let reads = 0;
  await assert.rejects(waitForHelper(child, 'status.json', expected, timed(async () => {
    reads++; throw ioError('EBUSY');
  })), /kept the update status file locked.*remains open/);
  assert.equal(reads, 10); assert.equal(child.killed, true); assert.equal(child.detached, false);
});
test('unrelated I/O errors and a failed helper still stop immediately', async () => {
  for (const readFile of [async () => { throw ioError('EIO'); }, async () => '{"state":"failed"}']) {
    const child = childFixture(); let waits = 0;
    await assert.rejects(waitForHelper(child, 'status.json', expected, { ...timed(readFile), wait: async () => { waits++; } }));
    assert.equal(waits, 0); assert.equal(child.killed, true);
  }
});
test('missing, partial, oversized or another parent/version status cannot authorize closing', async () => {
  const statuses = ['{', 'x'.repeat(4097), JSON.stringify({ state: 'waiting', parentPid: 999, version: '1.1.4' }), JSON.stringify({ state: 'waiting', parentPid: 123, version: '1.1.3' })];
  for (const status of statuses) {
    const child = childFixture();
    await assert.rejects(waitForHelper(child, 'status.json', expected, timed(async () => status)), /did not acknowledge/);
    assert.equal(child.killed, true); assert.equal(child.detached, false);
  }
});
test('a helper exit during a locked read is not hidden by the access retry', async () => {
  const child = childFixture();
  await assert.rejects(waitForHelper(child, 'status.json', expected, timed(async () => {
    child.emit('exit', 1); throw ioError('EBUSY');
  })), /exited before acknowledgement/);
  assert.equal(child.killed, true);
});
test('old status cleanup retries transient locks, but not unrelated errors', async () => {
  let calls = 0;
  await retryStatusAccess(async () => { if (++calls < 4) throw ioError('EPERM'); }, timed());
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(retryStatusAccess(async () => { calls++; throw ioError('ENOSPC'); }, timed()), { code: 'ENOSPC' });
  assert.equal(calls, 1);
  await assert.rejects(retryStatusAccess(async () => { throw ioError('EBUSY'); }, timed()), /kept the update status file locked/);
});
