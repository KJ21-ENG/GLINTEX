/**
 * Weight Scale Utility - Web Serial API integration
 *
 * This module is intentionally "protocol-agnostic":
 * - It auto-detects weight from the device output (see `parseWeightReading`)
 * - It prefers a stable reading (multiple samples within tolerance)
 * - It supports selecting/remembering the right port
 * - It avoids concurrent readers via a singleton manager
 *
 * Important browser limitation:
 * Web Serial works only in Chromium-based browsers (Chrome/Edge) and only in
 * secure contexts (https or localhost).
 */

import { parseWeightReading, roundKg3 } from './weightScaleParser.js';

const SCALE_PREF_KEY = 'glintex.weightScale.preferredPortInfo';
const DEFAULT_BAUD_RATES = [9600, 2400, 4800, 1200, 19200, 38400, 57600, 115200];

function getSerial() {
  // Guard for non-browser contexts
  if (typeof navigator === 'undefined') return null;
  return navigator.serial || null;
}

function safeLocalStorageGet(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch (_) {
    // ignore
  }
}

function getPortInfo(port) {
  try {
    if (!port || typeof port.getInfo !== 'function') return null;
    const info = port.getInfo() || {};
    const vendorId = Number(info.vendorId);
    const productId = Number(info.productId);
    if (!Number.isFinite(vendorId) && !Number.isFinite(productId)) return null;
    return {
      vendorId: Number.isFinite(vendorId) ? vendorId : null,
      productId: Number.isFinite(productId) ? productId : null,
    };
  } catch (_) {
    return null;
  }
}

function formatPortLabel(info, index) {
  if (!info) return index != null ? `Port ${index + 1}` : 'Port';
  const v = info.vendorId != null ? `VID ${info.vendorId}` : 'VID ?';
  const p = info.productId != null ? `PID ${info.productId}` : 'PID ?';
  return index != null ? `Port ${index + 1} (${v}, ${p})` : `Port (${v}, ${p})`;
}

function loadPreferredPortInfo() {
  const raw = safeLocalStorageGet(SCALE_PREF_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const vendorId = Number(parsed.vendorId);
    const productId = Number(parsed.productId);
    if (!Number.isFinite(vendorId) && !Number.isFinite(productId)) return null;
    return {
      vendorId: Number.isFinite(vendorId) ? vendorId : null,
      productId: Number.isFinite(productId) ? productId : null,
    };
  } catch (_) {
    return null;
  }
}

function savePreferredPortInfo(info) {
  if (!info) return;
  safeLocalStorageSet(SCALE_PREF_KEY, JSON.stringify(info));
}

function closeQuietly(port) {
  if (!port || !port.readable) return Promise.resolve();
  return port.close().catch(() => {});
}

function openPort(port, baudRate) {
  return port.open({
    baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    flowControl: 'none',
  });
}

function pickPreferredPort(ports, preferredInfo) {
  if (!Array.isArray(ports) || ports.length === 0) return null;
  if (!preferredInfo) return ports[0];
  const match = ports.find((p) => {
    const info = getPortInfo(p);
    if (!info) return false;
    const vendorMatches = preferredInfo.vendorId == null || info.vendorId === preferredInfo.vendorId;
    const productMatches = preferredInfo.productId == null || info.productId === preferredInfo.productId;
    return vendorMatches && productMatches;
  });
  return match || ports[0];
}

function computeStableReading(samples, { toleranceKg, windowMs, minSamples }) {
  const tol = Number.isFinite(toleranceKg) ? toleranceKg : 0.01;
  const window = Number.isFinite(windowMs) ? windowMs : 1200;
  const min = Number.isFinite(minSamples) ? minSamples : 4;

  const now = Date.now();
  const recent = (samples || []).filter((s) => s && now - s.ts <= window);
  if (recent.length < min) {
    // If the device explicitly flags stable, we can accept earlier.
    const last = recent.length ? recent[recent.length - 1] : null;
    if (last?.meta?.stable && recent.length >= 2) return last;
    return null;
  }

  let minW = Infinity;
  let maxW = -Infinity;
  recent.forEach((s) => {
    minW = Math.min(minW, s.weightKg);
    maxW = Math.max(maxW, s.weightKg);
  });

  if (maxW - minW <= tol) {
    // Prefer explicitly stable if present; otherwise use the latest.
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i]?.meta?.stable) return recent[i];
    }
    return recent[recent.length - 1];
  }
  return null;
}

class WeightScaleManager {
  constructor() {
    this.port = null;
    this.portInfo = null;
    this.baudRate = null;
    this.status = 'disconnected'; // disconnected | connecting | connected | error
    this.error = null;

    this.reader = null;
    this._readAbort = null;
    this._connectPromise = null;

    this.lastReading = null; // { weightKg, ts, meta }
    this.samples = [];
    this.stable = null; // same shape as lastReading

    this._subscribers = new Set();
    this._rawSubscribers = new Set();
    this._captureLock = Promise.resolve();

    const serial = getSerial();
    if (serial && typeof serial.addEventListener === 'function') {
      serial.addEventListener('disconnect', (event) => {
        if (event?.target && this.port && event.target === this.port) {
          this._setError('Scale disconnected');
          this.disconnect().catch(() => {});
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', () => {
        this.disconnect().catch(() => {});
      });
    }
  }

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._subscribers.add(fn);
    fn(this.getState());
    return () => this._subscribers.delete(fn);
  }

  subscribeRaw(fn) {
    if (typeof fn !== 'function') return () => {};
    this._rawSubscribers.add(fn);
    return () => this._rawSubscribers.delete(fn);
  }

  _emit() {
    const state = this.getState();
    this._subscribers.forEach((fn) => {
      try { fn(state); } catch (_) {}
    });
  }

  _emitRaw(line) {
    this._rawSubscribers.forEach((fn) => {
      try { fn(line); } catch (_) {}
    });
  }

  _setStatus(next) {
    if (this.status === next) return;
    this.status = next;
    this._emit();
  }

  _setError(message) {
    this.error = message || null;
    if (message) this.status = 'error';
    this._emit();
  }

  getState() {
    return {
      status: this.status,
      error: this.error,
      portInfo: this.portInfo,
      baudRate: this.baudRate,
      lastReading: this.lastReading,
      stableReading: this.stable,
      isConnected: this.status === 'connected',
    };
  }

  clearReadings() {
    this.lastReading = null;
    this.samples = [];
    this.stable = null;
    this._emit();
  }

  async listAuthorizedPorts() {
    const serial = getSerial();
    if (!serial) return [];
    const ports = await serial.getPorts();
    return ports.map((p, idx) => {
      const info = getPortInfo(p);
      return {
        port: p,
        info,
        label: formatPortLabel(info, idx),
      };
    });
  }

  async getPreferredAuthorizedPort() {
    const serial = getSerial();
    if (!serial) return null;
    const ports = await serial.getPorts();
    if (!ports.length) return null;
    const preferredInfo = loadPreferredPortInfo();
    return pickPreferredPort(ports, preferredInfo);
  }

  async requestPort() {
    const serial = getSerial();
    if (!serial) throw new Error('Web Serial API not supported in this browser');
    const port = await serial.requestPort();
    const info = getPortInfo(port);
    if (info) savePreferredPortInfo(info);
    return port;
  }

  async connect({
    port = null,
    baudRate = null,
    baudRates = DEFAULT_BAUD_RATES,
    autoBaud = true,
    probeMs = 900,
    minKg = 0,
    maxKg = 5000,
  } = {}) {
    const serial = getSerial();
    if (!serial) throw new Error('Web Serial API not supported in this browser');

    if (this._connectPromise) return await this._connectPromise;

    this._connectPromise = (async () => {
      this._setStatus('connecting');
      this.error = null;

      const resolvedPort = port || (await this.getPreferredAuthorizedPort());
      if (!resolvedPort) {
        this._setStatus('disconnected');
        throw new Error('No authorized scale port found');
      }

      // If switching ports, tear down the old connection first.
      if (this.port && this.port !== resolvedPort) {
        await this._stopReadLoop();
        if (this.port.readable) await closeQuietly(this.port);
        this.port = null;
        this.portInfo = null;
        this.baudRate = null;
        this.clearReadings();
      }

      this.port = resolvedPort;
      this.portInfo = getPortInfo(resolvedPort);
      if (this.portInfo) savePreferredPortInfo(this.portInfo);

      if (!resolvedPort.readable) {
        if (autoBaud) {
          const result = await this._openWithAutoBaud(resolvedPort, baudRates, { probeMs, minKg, maxKg });
          this.baudRate = result.baudRate;
        } else {
          const br = Number.isFinite(Number(baudRate)) ? Number(baudRate) : baudRates[0];
          await openPort(resolvedPort, br);
          this.baudRate = br;
        }
      } else {
        // Port already open - baudRate unknown (WebSerial doesn’t expose it)
        const br = Number(baudRate);
        if (Number.isFinite(br)) this.baudRate = br;
      }

      this._startReadLoop({ minKg, maxKg });
      this._setStatus('connected');
      return this.getState();
    })();

    try {
      return await this._connectPromise;
    } catch (err) {
      // Ensure UI doesn't get stuck in "connecting" on failures.
      const message = err?.message || 'Failed to connect to scale';
      this._setError(message);
      throw err;
    } finally {
      this._connectPromise = null;
    }
  }

  async _openWithAutoBaud(port, baudRates, { probeMs, minKg, maxKg }) {
    const rates = Array.isArray(baudRates) && baudRates.length ? baudRates : DEFAULT_BAUD_RATES;

    // Some scales stream continuously; probe each baud rate briefly and pick the first that yields a plausible parse.
    for (const br of rates) {
      try {
        await openPort(port, br);
        const ok = await this._probePortForParse(port, { probeMs, minKg, maxKg });
        if (ok) return { baudRate: br, probed: true };
      } catch (_) {
        // ignore and try next
      }

      // If probe failed (or threw), close and retry.
      if (port.readable) await closeQuietly(port);
    }

    // Fallback: open at the first rate (best-effort)
    const fallback = rates[0];
    await openPort(port, fallback);
    return { baudRate: fallback, probed: false };
  }

  async _probePortForParse(port, { probeMs, minKg, maxKg }) {
    if (!port?.readable) return false;
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + (Number.isFinite(probeMs) ? probeMs : 900);

    try {
      // IMPORTANT: never call `reader.read()` while a previous `read()` is pending.
      // Some scales stream slowly and the old Promise.race(timeout) approach would
      // leave the pending read unresolved and immediately call `read()` again,
      // which throws in Chromium. Instead we keep a single pending read and
      // periodically "tick" until it resolves or we hit the probe deadline.
      let pendingRead = reader.read();

      while (Date.now() < deadline) {
        const sliceMs = Math.min(250, Math.max(0, deadline - Date.now()));
        const raced = await Promise.race([
          pendingRead
            .then((r) => ({ kind: 'read', r }))
            .catch((e) => ({ kind: 'error', e })),
          new Promise((resolve) => setTimeout(() => resolve({ kind: 'tick' }), sliceMs)),
        ]);

        if (raced.kind === 'tick') {
          continue;
        }
        if (raced.kind === 'error') {
          return false;
        }

        const { value, done } = raced.r || {};
        if (done) return false;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 400) buffer = buffer.slice(-200);

          const parsed = parseWeightReading(buffer, { minKg, maxKg });
          if (parsed && Number.isFinite(parsed.weightKg) && parsed.confidence >= 0.7) return true;
        }

        // Only issue the next read after the current one resolves.
        pendingRead = reader.read();
      }

      // Deadline reached while a read might still be pending; cancel so we can release the lock.
      try { await reader.cancel(); } catch (_) { }
      return false;
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  }

  async disconnect() {
    await this._stopReadLoop();
    if (this.port?.readable) {
      await closeQuietly(this.port);
    }
    this.port = null;
    this.portInfo = null;
    this.baudRate = null;
    this.status = 'disconnected';
    this.error = null;
    this.clearReadings();
  }

  _startReadLoop({ minKg, maxKg }) {
    if (!this.port?.readable) return;
    if (this._readAbort) return; // already running

    const reader = this.port.readable.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    const abort = new AbortController();
    this._readAbort = abort;

    let buffer = '';
    let lastEmitTs = 0;
    let lastEmittedWeight = null;

    const handleText = (text, { isBufferSample = false } = {}) => {
      const parsed = parseWeightReading(text, { minKg, maxKg });
      if (!parsed) return;
      const weightKg = roundKg3(parsed.weightKg);
      if (!Number.isFinite(weightKg)) return;

      const ts = Date.now();
      // Avoid spamming duplicates when parsing from rolling buffers.
      if (lastEmittedWeight != null && Math.abs(weightKg - lastEmittedWeight) < 0.0005 && ts - lastEmitTs < (isBufferSample ? 150 : 80)) {
        return;
      }

      lastEmittedWeight = weightKg;
      lastEmitTs = ts;
      const sample = { weightKg, ts, meta: parsed };
      this.lastReading = sample;
      this.samples.push(sample);
      if (this.samples.length > 30) this.samples.splice(0, this.samples.length - 30);
      this.stable = computeStableReading(this.samples, { toleranceKg: 0.01, windowMs: 1200, minSamples: 4 });
      this._emit();
    };

    (async () => {
      try {
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;

          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;

          buffer += chunk;
          if (buffer.length > 2000) buffer = buffer.slice(-800);

          // Emit raw lines for debug UIs
          const parts = buffer.split(/\r?\n|\r/);
          buffer = parts.pop() || '';
          parts.forEach((line) => {
            const trimmed = String(line || '').trim();
            if (!trimmed) return;
            this._emitRaw(trimmed);
            handleText(trimmed, { isBufferSample: false });
          });

          // Also parse from the rolling buffer (covers bracket-only protocols without newlines)
          handleText(buffer, { isBufferSample: true });
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          this._setError(err?.message || 'Scale read error');
        }
      } finally {
        try { reader.releaseLock(); } catch (_) {}
        if (!abort.signal.aborted) {
          // Reader ended unexpectedly
          this._setStatus('disconnected');
        }
        this.reader = null;
        this._readAbort = null;
        this._emit();
      }
    })();
  }

  async _stopReadLoop() {
    if (!this.reader && !this._readAbort) return;
    try { this._readAbort?.abort(); } catch (_) {}
    try { await this.reader?.cancel(); } catch (_) {}
    try { this.reader?.releaseLock(); } catch (_) {}
    this.reader = null;
    this._readAbort = null;
  }

  async captureStableWeight({
    timeoutMs = 8000,
    allowUserPrompt = false,
    forcePrompt = false,
    port = null,
    minKg = 0,
    maxKg = 5000,
  } = {}) {
    const run = async () => {
    if (!isWebSerialSupported()) {
      throw new Error('Weight scale not supported in this browser. Please use Chrome or Edge.');
    }

    let resolvedPort = port;
    if (!resolvedPort && !forcePrompt) {
      resolvedPort = await this.getPreferredAuthorizedPort();
    }
    if (!resolvedPort && (allowUserPrompt || forcePrompt)) {
      resolvedPort = await this.requestPort();
    }
    if (!resolvedPort) {
      throw new Error('No authorized scale port found. Please connect/authorize the scale.');
    }

    await this.connect({ port: resolvedPort, autoBaud: true, minKg, maxKg });
    this.clearReadings();

    const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 8000);

    return await new Promise((resolve, reject) => {
      let intervalId = null;
      const unsub = this.subscribe((state) => {
        const stable = state?.stableReading;
        if (stable && Number.isFinite(stable.weightKg) && stable.weightKg > 0) {
          if (intervalId) clearInterval(intervalId);
          unsub();
          resolve({
            weightKg: stable.weightKg,
            meta: stable.meta || null,
            portInfo: state.portInfo || null,
            baudRate: state.baudRate || null,
          });
        }
      });

      intervalId = setInterval(() => {
        if (Date.now() <= deadline) return;
        clearInterval(intervalId);
        try { unsub(); } catch (_) {}
        reject(new Error('Could not read a stable weight. Ensure the scale is connected and stable.'));
      }, 120);
    });
    };

    // Serialize captures to avoid multiple concurrent readers/timeouts fighting each other.
    const chained = this._captureLock.then(run, run);
    this._captureLock = chained.catch(() => {});
    return await chained;
  }
}

let _manager = null;
export function getScaleManager() {
  if (!_manager) _manager = new WeightScaleManager();
  return _manager;
}

/**
 * Check if Web Serial API is supported
 */
export function isWebSerialSupported() {
  return Boolean(getSerial());
}

/**
 * Request user to select a serial port (first-time setup)
 * Must be called from a user gesture (click handler)
 */
export async function requestScalePort() {
  return await getScaleManager().requestPort();
}

/**
 * Get a previously authorized port automatically.
 * Returns the preferred port if possible, otherwise the first available port.
 */
export async function getActiveScalePort() {
  return await getScaleManager().getPreferredAuthorizedPort();
}

/**
 * Legacy helper kept for backwards compatibility.
 * Open connection to the scale with a specific baud rate.
 */
export async function openScale(port, { baudRate = DEFAULT_BAUD_RATES[0] } = {}) {
  if (!port) throw new Error('Port is required');
  if (!port.readable) {
    await openPort(port, baudRate);
  }
  return port;
}

/**
 * Close the scale connection
 */
export async function closeScale(port) {
  await closeQuietly(port);
}

/**
 * Read a single weight from the scale (best-effort).
 * Prefer `catchWeight()` for stable readings.
 */
export async function readWeight(port, timeoutMs = 2000) {
  const manager = getScaleManager();
  await manager.connect({ port, autoBaud: false, baudRate: DEFAULT_BAUD_RATES[0] });
  const result = await manager.captureStableWeight({ timeoutMs, port });
  return result.weightKg;
}

/**
 * Main function: Catch weight from scale
 *
 * Auto-detects port, auto-baud probes, waits for a stable reading,
 * and returns the weight in kg (3 decimals).
 */
export async function catchWeight(options = {}) {
  const { weightKg } = await getScaleManager().captureStableWeight({
    timeoutMs: 8000,
    allowUserPrompt: false,
    ...options,
  });
  return weightKg;
}
