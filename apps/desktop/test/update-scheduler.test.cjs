const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { UpdateController } = require('../src/updates/controller.cjs');
const { UpdateScheduler, CHECK_INTERVAL, RETRY_DELAYS } = require('../src/updates/scheduler.cjs');

const bytes = Buffer.from('scheduler installer fixture');
const release = { schemaVersion: 1, product: 'GLINTEX', platform: 'win32', arch: 'x64', channel: 'stable', version: '1.1.3', sourceCommit: 'a'.repeat(40), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, signing: 'unsigned-test-installer', notes: 'Fixture only', publishedAt: '2026-10-07T00:00:00Z' };

async function fixture(t, fetch, supported = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-update-scheduler-'));
  const timers = new Map(), calls = [];
  let now = 1, id = 0;
  const updater = await new UpdateController({ version: '1.1.2', directory, supported, clock: () => now,
    fetch: async (url, options) => { calls.push(url); return fetch ? fetch(url, options) : new Response(url.endsWith('/latest') ? JSON.stringify(release) : bytes); },
    launch: () => assert.fail('Discovery must never install'),
  }).initialize();
  const scheduler = new UpdateScheduler({ updater,
    setTimer: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimer: timer => timers.delete(timer),
  });
  t.after(async () => { scheduler.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  const settle = async () => { if (updater.checking) await updater.checking; };
  const advance = async ms => {
    const target = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
    }
    now = target;
  };
  return { updater, scheduler, calls, timers, settle, advance, nextDelay: () => [...timers.values()][0]?.at - now };
}

test('startup checks immediately once, repeats after six hours, and never downloads', async t => {
  const f = await fixture(t);
  f.scheduler.start(); f.scheduler.start(); await f.settle();
  assert.equal(f.calls.length, 1); assert.equal(f.updater.status().state, 'available');
  assert.equal(f.updater.status().prompt, true); assert.equal(f.nextDelay(), CHECK_INTERVAL);
  await f.advance(CHECK_INTERVAL - 1); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(url => url.endsWith('/latest')));
  assert.equal(await f.updater.verified(), false);
});

test('restored session discovery before scheduler start does not trigger a second launch check', async t => {
  const f = await fixture(t);
  await f.updater.authenticationCompleted({ url: f.updater.origin + '/api/auth/me', statusCode: 200 });
  f.scheduler.start(); await f.settle();
  assert.equal(f.calls.length, 1); assert.equal(f.nextDelay(), CHECK_INTERVAL);
});

test('expired session retries immediately after successful trusted sign-in', async t => {
  let signedIn = false;
  const f = await fixture(t, () => signedIn ? new Response(JSON.stringify(release)) : new Response(null, { status: 401 }));
  f.scheduler.start(); await f.settle(); assert.equal(f.updater.status().state, 'signin');
  signedIn = true;
  await Promise.all(['login', 'me', 'bootstrap'].map(name => f.updater.authenticationCompleted({ url: f.updater.origin + '/api/auth/' + name, statusCode: 200 })));
  assert.equal(f.calls.length, 2); assert.equal(f.updater.status().state, 'available');
  assert.equal(f.timers.size, 1);
});

test('offline discovery retries with bounded backoff and resets after recovery', async t => {
  let online = false;
  const f = await fixture(t, () => { if (!online) throw Error('offline'); return new Response(JSON.stringify(release)); });
  f.scheduler.start(); await f.settle();
  assert.equal(f.updater.status().state, 'error'); assert.equal(Boolean(f.updater.status().prompt), false);
  for (const delay of [...RETRY_DELAYS, RETRY_DELAYS.at(-1)]) {
    assert.equal(f.nextDelay(), delay); await f.advance(delay);
  }
  online = true;
  await Promise.all([f.scheduler.retry(), f.scheduler.retry(), f.scheduler.retry()]);
  assert.equal(f.updater.status().state, 'available'); assert.equal(f.nextDelay(), CHECK_INTERVAL);
  assert.equal(f.calls.length, 7, 'reconnect signals share one request');
  await f.scheduler.retry(); assert.equal(f.calls.length, 7, 'healthy discovery is not repeated by reconnect events');
});

test('unavailable hosting retries automatically and manual checks retain visible feedback', async t => {
  const f = await fixture(t, () => new Response(null, { status: 503 }));
  f.scheduler.start(); await f.settle(); assert.equal(f.nextDelay(), RETRY_DELAYS[0]);
  await f.updater.check({ manual: true }); assert.equal(f.updater.status().prompt, true);
  assert.equal(f.timers.size, 1);
});

test('background checks hide stale no-update feedback but manual checks remain visible', async t => {
  const f = await fixture(t, () => new Response(null, { status: 204 }));
  await f.updater.check({ manual: true }); assert.equal(f.updater.status().prompt, true);
  await f.updater.check(); assert.equal(f.updater.status().prompt, false);
  f.scheduler.start(); await f.settle(); assert.equal(f.calls.length, 2);
});

test('download and installation choice pause discovery until work completes or choice is cancelled', async t => {
  const f = await fixture(t);
  f.scheduler.start(); await f.settle();
  await f.updater.download(); assert.equal(f.updater.status().state, 'ready');
  await f.updater.arm(); assert.equal(f.timers.size, 0);
  await f.scheduler.retry(); await f.advance(CHECK_INTERVAL * 2); assert.equal(f.calls.length, 2);
  await f.updater.disarm(); assert.equal(f.nextDelay(), CHECK_INTERVAL);
  await f.advance(CHECK_INTERVAL); assert.equal(f.calls.length, 3);
});

test('an active download pauses scheduled and reconnect discovery; cancellation restores the schedule', async t => {
  let started;
  const downloadStarted = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, (url, options) => {
    if (url.endsWith('/latest')) return new Response(JSON.stringify(release));
    started();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
  });
  f.scheduler.start(); await f.settle();
  const download = f.updater.download(); await downloadStarted;
  assert.equal(f.updater.status().state, 'downloading'); assert.equal(f.timers.size, 0);
  await f.advance(CHECK_INTERVAL); await f.scheduler.retry(); assert.equal(f.calls.length, 2);
  f.updater.cancel(); await download;
  assert.equal(f.updater.status().state, 'available'); assert.equal(f.nextDelay(), CHECK_INTERVAL);
});

test('stop cleans up listeners and timers; unsupported platforms never check', async t => {
  const f = await fixture(t); f.scheduler.start(); await f.settle(); f.scheduler.stop();
  assert.equal(f.timers.size, 0); assert.equal(f.updater.listenerCount('status'), 0);
  await f.advance(CHECK_INTERVAL); await f.scheduler.retry(); assert.equal(f.calls.length, 1);
  const unsupported = await fixture(t, null, false); unsupported.scheduler.start();
  assert.equal(unsupported.calls.length, 0); assert.equal(unsupported.timers.size, 0);
});
