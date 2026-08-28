import assert from 'node:assert/strict';
import test from 'node:test';

const {
  brokeredV2Get,
  clearV2RequestBrokerForTests,
} = await import('../../../../frontend/src/api/v2RequestBroker.js');

test.afterEach(() => {
  clearV2RequestBrokerForTests();
});
test('identical in-flight v2 GETs share one fetch and receive independent bodies', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const [first, second] = await Promise.all([
      brokeredV2Get('/api/v2/test', { limit: 50 }),
      brokeredV2Get('/api/v2/test', { limit: 50 }),
    ]);
    assert.equal(fetchCount, 1);
    assert.deepEqual(await first.json(), { ok: true });
    assert.deepEqual(await second.json(), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Strict Mode cleanup aborts one consumer without duplicating or cancelling its remount', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let resolveFetch;
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    fetchCount += 1;
    resolveFetch = () => resolve(new Response(JSON.stringify({ reused: true }), { status: 200 }));
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
  try {
    const firstController = new AbortController();
    const first = brokeredV2Get('/api/v2/strict-mode', {}, { signal: firstController.signal });
    firstController.abort();
    const secondController = new AbortController();
    const second = brokeredV2Get('/api/v2/strict-mode', {}, { signal: secondController.signal });
    resolveFetch();
    await assert.rejects(first, { name: 'AbortError' });
    assert.deepEqual(await (await second).json(), { reused: true });
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an abandoned v2 GET aborts its shared fetch after the remount grace window', async () => {
  const originalFetch = globalThis.fetch;
  let sharedAborted = false;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      sharedAborted = true;
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
  try {
    const controller = new AbortController();
    const request = brokeredV2Get('/api/v2/abandoned', {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sharedAborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
