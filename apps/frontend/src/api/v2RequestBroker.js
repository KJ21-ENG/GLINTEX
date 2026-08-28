import { API_BASE } from './base.js';

const inFlight = new Map();
const STRICT_MODE_REUSE_GRACE_MS = 75;

function abortError() {
  if (typeof DOMException !== 'undefined') return new DOMException('Request aborted', 'AbortError');
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

function buildUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const suffix = query.toString();
  return `${API_BASE}${path}${suffix ? `?${suffix}` : ''}`;
}

function scheduleSharedAbort(url, entry) {
  if (entry.settled || entry.consumers.size > 0 || entry.abortTimer) return;
  entry.abortTimer = setTimeout(() => {
    entry.abortTimer = null;
    if (!entry.settled && entry.consumers.size === 0) entry.controller.abort();
  }, STRICT_MODE_REUSE_GRACE_MS);
}

function createEntry(url, timeoutMs) {
  const controller = new AbortController();
  const entry = {
    controller,
    consumers: new Set(),
    abortTimer: null,
    timeoutTimer: null,
    settled: false,
    promise: null,
  };
  entry.timeoutTimer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  entry.promise = fetch(url, {
    method: 'GET',
    credentials: 'include',
    signal: controller.signal,
  }).finally(() => {
    entry.settled = true;
    clearTimeout(entry.timeoutTimer);
    if (entry.abortTimer) clearTimeout(entry.abortTimer);
    if (inFlight.get(url) === entry) inFlight.delete(url);
  });
  inFlight.set(url, entry);
  return entry;
}

export function brokeredV2Get(path, params = {}, { signal, timeoutMs = 30000 } = {}) {
  const url = buildUrl(path, params);
  let entry = inFlight.get(url);
  if (!entry || entry.settled) entry = createEntry(url, timeoutMs);
  if (entry.abortTimer) {
    clearTimeout(entry.abortTimer);
    entry.abortTimer = null;
  }

  const consumer = Symbol(url);
  entry.consumers.add(consumer);
  if (signal?.aborted) {
    entry.consumers.delete(consumer);
    scheduleSharedAbort(url, entry);
    return Promise.reject(abortError());
  }

  let removeAbortListener = () => {};
  const callerAbort = signal
    ? new Promise((_, reject) => {
      const onAbort = () => {
        entry.consumers.delete(consumer);
        scheduleSharedAbort(url, entry);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    })
    : null;

  const shared = entry.promise.then((response) => response.clone()).catch((error) => {
    if (entry.controller.signal.aborted) {
      if (entry.controller.signal.reason === 'timeout') {
        const timeoutError = new Error('Request timed out — check connection');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw abortError();
    }
    throw error;
  });

  return (callerAbort ? Promise.race([shared, callerAbort]) : shared).finally(() => {
    removeAbortListener();
    entry.consumers.delete(consumer);
    scheduleSharedAbort(url, entry);
  });
}

export function clearV2RequestBrokerForTests() {
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
}
