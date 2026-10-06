/**
 * Weight Scale Utility - Web Serial API integration
 *
 * Browser capture uses editable bracket-integer or complete explicit-unit line profiles.
 * - Unrecognized protocols never become guessed numeric readings.
 * - It requires stable complete samples within tolerance.
 * - It supports selecting/remembering the right port
 * - It avoids concurrent readers via a singleton manager
 *
 * Important browser limitation:
 * Web Serial works only in Chromium-based browsers (Chrome/Edge) and only in
 * secure contexts (https or localhost).
 */

import { DEFAULT_SCALE_SETTINGS, parseWeightReading, ScaleFrameBuffer, validateScaleSettings } from './weightScaleParser.js';

const SCALE_PREF_KEY = 'glintex.weightScale.preferredPortInfo';
const SCALE_SETTINGS_KEY = 'glintex.weightScale.settings';
const DEFAULT_BAUD_RATES = [2400, 9600, 4800, 1200, 19200, 38400, 57600, 115200];

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
    const vendorId = Number(info.usbVendorId ?? NaN);
    const productId = Number(info.usbProductId ?? NaN);
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
    const vendorId = Number(parsed.vendorId ?? NaN);
    const productId = Number(parsed.productId ?? NaN);
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

async function closeQuietly(port) {
  if (port) await port.close();
}

function openPort(port, settings) {
  return port.open({
    baudRate: settings.baudRate, dataBits: settings.dataBits,
    parity: settings.parity, stopBits: settings.stopBits,
    flowControl: settings.flowControl === 'rtscts' ? 'hardware' : 'none',
  });
}

function pickPreferredPort(ports, preferredInfo) {
  if (!Array.isArray(ports) || ports.length === 0) return null;
  if (!preferredInfo) return ports.length === 1 ? ports[0] : null;
  const matches = ports.filter((p) => {
    const info = getPortInfo(p);
    if (!info) return false;
    const vendorMatches = preferredInfo.vendorId == null || info.vendorId === preferredInfo.vendorId;
    const productMatches = preferredInfo.productId == null || info.productId === preferredInfo.productId;
    return vendorMatches && productMatches;
  });
  return matches.length === 1 ? matches[0] : null;
}

function computeStableReading(samples, settings) {
  const recent = samples.filter(sample => Date.now() - sample.ts <= settings.staleMs)
    .slice(-settings.stabilitySamples);
  if (recent.length < settings.stabilitySamples) return null;
  const weights = recent.map(sample => sample.weightKg);
  return Math.max(...weights) - Math.min(...weights) <= settings.toleranceKg ? recent.at(-1) : null;
}

class WeightScaleManager {
  constructor() {
    this.config = { ...DEFAULT_SCALE_SETTINGS };
    this.error = null;
    try {
      const saved = safeLocalStorageGet(SCALE_SETTINGS_KEY);
      if (saved) this.config = validateScaleSettings(JSON.parse(saved));
    } catch (_) { this.error = 'Saved scale settings are invalid. Review and save the settings below.'; }
    this.port = null; this.portInfo = null; this.baudRate = null;
    this.status = 'disconnected'; this._opened = false;
    this.reader = null; this._readAbort = null; this._connectPromise = null;
    this.lastReading = null; this.samples = []; this.stable = null;
    this._subscribers = new Set(); this._rawSubscribers = new Set();
    this._captureLock = Promise.resolve(); this._generation = 0;
    const serial = getSerial();
    serial?.addEventListener?.('disconnect', event => {
      if (event.target === this.port) this.disconnect().catch(() => {}).finally(() => this._setError('Scale disconnected'));
    });
    if (typeof window !== 'undefined') window.addEventListener?.('beforeunload', () => this.disconnect().catch(() => {}));
  }
  subscribe(fn) { this._subscribers.add(fn); fn(this.getState()); return () => this._subscribers.delete(fn); }
  subscribeRaw(fn) { this._rawSubscribers.add(fn); return () => this._rawSubscribers.delete(fn); }
  _emit() { const state = this.getState(); this._subscribers.forEach(fn => { try { fn(state); } catch (_) {} }); }
  _emitRaw(line) { this._rawSubscribers.forEach(fn => { try { fn(line); } catch (_) {} }); }
  _setStatus(status) { this.status = status; this._emit(); }
  _setError(message) { this.error = message; this.status = 'error'; this.clearReadings(); }
  getState() {
    return {
      status: this.status, error: this.error, config: { ...this.config },
      portInfo: this.portInfo, baudRate: this.baudRate, lastReading: this.lastReading,
      stableReading: this.stable && Date.now() - this.stable.ts <= this.config.staleMs ? this.stable : null,
      isConnected: this._opened, captureReady: this._opened && this.status === 'connected' && this.config.profileId !== 'unknown',
    };
  }
  clearReadings() { this.lastReading = null; this.samples = []; this.stable = null; this._emit(); }
  async configure(settings) {
    if (this._opened || this._connectPromise || this._capturing) throw new Error('Disconnect the scale before changing settings');
    this.config = validateScaleSettings(settings);
    safeLocalStorageSet(SCALE_SETTINGS_KEY, JSON.stringify(this.config));
    this.error = null; this.clearReadings();
    return { ...this.config };
  }
  async listAuthorizedPorts() {
    const ports = await getSerial()?.getPorts() || [];
    return ports.map((port, index) => { const info = getPortInfo(port); return { port, info, label: formatPortLabel(info, index) }; });
  }
  async getPreferredAuthorizedPort() {
    return pickPreferredPort(await getSerial()?.getPorts() || [], loadPreferredPortInfo());
  }
  async requestPort() {
    if (!getSerial()) throw new Error('Web Serial API not supported in this browser');
    const port = await getSerial().requestPort();
    const info = getPortInfo(port); if (info) savePreferredPortInfo(info);
    return port;
  }
  async connect({ port = null, baudRate, baudRates = DEFAULT_BAUD_RATES, autoBaud = false, probeMs = 900, minKg, maxKg } = {}) {
    if (!getSerial()) throw new Error('Web Serial API not supported in this browser');
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      const selected = port || await this.getPreferredAuthorizedPort();
      if (!selected) throw new Error('Select or authorize the scale port. Multiple ports require an explicit selection.');
      if (this.port === selected && this._opened && this._readAbort && this.status === 'connected') return this.getState();
      if (this.port) await this.disconnect();
      const generation = this._generation;
      const settings = validateScaleSettings({ ...this.config,
        ...(baudRate == null ? {} : { baudRate }), ...(minKg == null ? {} : { minKg }), ...(maxKg == null ? {} : { maxKg }),
      });
      this.error = null; this._setStatus('connecting');
      this.port = selected; this.portInfo = getPortInfo(selected);
      if (autoBaud) settings.baudRate = await this._openWithAutoBaud(selected, baudRates, { ...settings, probeMs });
      await openPort(selected, settings); this._opened = true;
      if (generation !== this._generation) { await closeQuietly(selected); this._opened = false; throw new Error('Connection cancelled'); }
      this.config = settings; this.baudRate = settings.baudRate;
      if (this.portInfo) savePreferredPortInfo(this.portInfo);
      this.clearReadings(); this._startReadLoop();
      this._setStatus(settings.profileId === 'unknown' ? 'unknown-protocol' : 'connected');
      return this.getState();
    })();
    try { return await this._connectPromise; }
    catch (error) { this._setError(error.message || 'Failed to connect to scale'); throw error; }
    finally { this._connectPromise = null; }
  }
  async _openWithAutoBaud(port, rates, settings) {
    for (const baudRate of rates) {
      // A port-open failure (busy/permission/disconnected) is not a baud mismatch.
      await openPort(port, { ...settings, baudRate }); this._opened = true;
      let recognized;
      try { recognized = await this._probePortForParse(port, settings); }
      finally { await closeQuietly(port); this._opened = false; }
      if (recognized) return baudRate;
    }
    throw new Error('No supported complete weight frames found. Verify scale protocol and baud rate.');
  }
  async _probePortForParse(port, settings) {
    if (!port.readable) return false;
    const reader = port.readable.getReader(), decoder = new TextDecoder();
    const frames = new ScaleFrameBuffer(settings.profileId);
    const deadline = Date.now() + settings.probeMs;
    try {
      let pending = reader.read();
      while (Date.now() < deadline) {
        const result = await Promise.race([
          pending.then(value => ({ value })),
          new Promise(resolve => setTimeout(() => resolve(null), Math.min(50, Math.max(1, deadline - Date.now())))),
        ]);
        if (!result) continue;
        if (result.value.done) return false;
        for (const raw of frames.push(decoder.decode(result.value.value || new Uint8Array(), { stream: true }))) {
          if (raw) this._emitRaw(raw.slice(0, 512));
          if (parseWeightReading(raw, settings)) return true;
        }
        pending = reader.read();
      }
      return false;
    } finally {
      // Probing always closes and reopens its port before the continuous reader starts.
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
  }
  async disconnect() {
    ++this._generation;
    await this._stopReadLoop();
    if (this._opened) { await closeQuietly(this.port); this._opened = false; }
    this.port = null; this.portInfo = null; this.baudRate = null;
    this.error = null; this.status = 'disconnected'; this.clearReadings();
  }
  _startReadLoop() {
    if (!this.port?.readable) throw new Error('Scale has no readable stream');
    const reader = this.port.readable.getReader(), decoder = new TextDecoder();
    const frames = new ScaleFrameBuffer(this.config.profileId), abort = new AbortController();
    this.reader = reader; this._readAbort = abort;
    this._resetFrame = () => frames.discardPartial();
    this._readTask = (async () => {
      try {
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const raw of frames.push(decoder.decode(value || new Uint8Array(), { stream: true }))) {
            if (raw) this._emitRaw(raw.slice(0, 512));
            const parsed = parseWeightReading(raw, this.config);
            if (!parsed) { this.clearReadings(); continue; }
            const sample = { weightKg: parsed.weightKg, ts: Date.now(), meta: parsed };
            this.lastReading = sample; this.samples.push(sample);
            this.samples = this.samples.filter(item => Date.now() - item.ts <= this.config.staleMs).slice(-this.config.stabilitySamples);
            this.stable = computeStableReading(this.samples, this.config); this._emit();
          }
        }
        if (!abort.signal.aborted) this._setError('Scale stopped sending data. Disconnect and reconnect.');
      } catch (error) { if (!abort.signal.aborted) this._setError(error.message || 'Scale read error'); }
      finally {
        reader.releaseLock();
        if (this.reader === reader) { this.reader = null; this._readAbort = null; this._resetFrame = null; }
      }
    })();
  }
  async _stopReadLoop() {
    this._readAbort?.abort();
    if (this.reader) await this.reader.cancel();
    await this._readTask;
    this._readTask = null;
  }
  async captureStableWeight({ timeoutMs = 8000, allowUserPrompt = false, forcePrompt = false, port = null } = {}) {
    const run = async () => {
      if (this.config.profileId === 'unknown') throw new Error('Choose a supported scale protocol in Scale settings first');
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid capture timeout');
      this._capturing = true;
      try {
        let selected = port || (!forcePrompt ? this.port || await this.getPreferredAuthorizedPort() : null);
        if (!selected && (allowUserPrompt || forcePrompt)) selected = await this.requestPort();
        if (!selected) throw new Error('Select or authorize the scale port before capture');
        await this.connect({ port: selected });
        this._resetFrame?.(); this.clearReadings();
        return await new Promise((resolve, reject) => {
          let unsub = () => {}, finished = false;
          const finish = (error, value) => {
            if (finished) return;
            finished = true; clearTimeout(timer); unsub();
            if (error) reject(error); else resolve(value);
          };
          const timer = setTimeout(() => finish(new Error('Could not read a fresh stable weight. Check the scale and its settings.')), timeoutMs);
          unsub = this.subscribe(state => {
            if (state.status === 'error' || state.status === 'disconnected') { finish(new Error(state.error || 'Scale disconnected')); return; }
            const reading = state.stableReading;
            if (!reading || reading.weightKg <= 0) return;
            finish(null, {
              weightKg: reading.weightKg, captureId: globalThis.crypto?.randomUUID?.() || null,
              timestamp: new Date(reading.ts).toISOString(), rawFrame: reading.meta.raw,
              source: 'browser-scale', profileId: this.config.profileId, unit: reading.meta.unit,
              profile: { id: this.config.profileId, unit: this.config.unit, decimalPlaces: this.config.decimalPlaces,
                stabilitySamples: this.config.stabilitySamples, toleranceKg: this.config.toleranceKg, staleMs: this.config.staleMs },
              meta: { ...reading.meta, stable: true }, portInfo: state.portInfo, baudRate: state.baudRate,
            });
          });
          if (finished) unsub();
        });
      } finally { this._capturing = false; }
    };
    const pending = this._captureLock.then(run, run);
    this._captureLock = pending.catch(() => {});
    return pending;
  }
}

// Compatibility facade: existing capture callers use the main-process owner in Electron.
class DesktopScaleManager {
  constructor(bridge) {
    this.bridge = bridge;
    this.state = { status: 'disconnected', isConnected: false };
    this.listeners = new Set(); this.rawListeners = new Set(); this.lastDiagnostic = '';
    const subscribe = bridge.onStatus || bridge.subscribe;
    if (subscribe) subscribe(state => this.accept(state));
    bridge.status().then(state => this.accept(state)).catch(() => {});
  }
  accept(state) {
    this.state = state;
    this.listeners.forEach(fn => fn(this.getState()));
    const last = state.diagnostics?.at(-1);
    const key = last ? last.timestamp + last.raw : '';
    if (key && key !== this.lastDiagnostic) { this.lastDiagnostic = key; this.rawListeners.forEach(fn => fn(last.raw)); }
  }
  getState() { return { ...this.state, isDesktop: true, captureReady: Boolean(this.state.isConnected && this.state.config?.profileId && this.state.config.profileId !== 'unknown') }; }
  subscribe(fn) { this.listeners.add(fn); fn(this.getState()); return () => this.listeners.delete(fn); }
  subscribeRaw(fn) { this.rawListeners.add(fn); return () => this.rawListeners.delete(fn); }
  async listAuthorizedPorts() {
    // Device choice and protocol are explicitly saved in Desktop settings. Do not
    // let the old browser dialog silently replace that selection.
    const state = await this.bridge.status(); this.accept(state);
    const ports = await this.bridge.enumerate();
    return ports.filter(p => p.path === state.config?.path).map(p => ({ port: p.path, info: p, label: p.path }));
  }
  async getPreferredAuthorizedPort() { const state = await this.bridge.status(); return state.config?.path || null; }
  async requestPort() { throw new Error('Use Desktop device settings to select the COM port and protocol profile'); }
  async connect() { const state = await this.bridge.connect(); this.accept(state); return state; }
  async disconnect() { await this.bridge.disconnect(); this.accept(await this.bridge.status()); }
  async configure(settings) { return this.bridge.configure(settings); }
  async captureStableWeight({ timeoutMs = 8000 } = {}) { return this.bridge.capture({ timeoutMs }); }
}

let _manager = null;
export function getScaleManager() {
  if (!_manager) _manager = typeof window !== 'undefined' && window.glintexDesktop?.scale
    ? new DesktopScaleManager(window.glintexDesktop.scale) : new WeightScaleManager();
  return _manager;
}

/**
 * Check if Web Serial API is supported
 */
export function isWebSerialSupported() {
  return Boolean((typeof window !== 'undefined' && window.glintexDesktop?.scale) || getSerial());
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
 * Returns the preferred unambiguous port, or the sole authorized port.
 */
export async function getActiveScalePort() {
  return await getScaleManager().getPreferredAuthorizedPort();
}

/**
 * Legacy helper kept for backwards compatibility.
 * Open connection to the scale with a specific baud rate.
 */
export async function openScale(port, { baudRate = DEFAULT_SCALE_SETTINGS.baudRate } = {}) {
  if (!port) throw new Error('Port is required');
  if (!port.readable) {
    await openPort(port, { ...DEFAULT_SCALE_SETTINGS, baudRate });
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
 * Uses the selected port and saved serial/profile settings, waits for fresh
 * stable samples, and returns the original captured kg precision.
 */
export async function catchWeight(options = {}) {
  const { weightKg } = await getScaleManager().captureStableWeight({
    timeoutMs: 8000,
    allowUserPrompt: false,
    ...options,
  });
  return weightKg;
}
