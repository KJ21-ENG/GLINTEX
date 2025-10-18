import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import EventEmitter from 'events';
import qrcode from 'qrcode';
import os from 'os';
import { execSync } from 'child_process';

const SESS_DIR = path.resolve(new URL('..', import.meta.url).pathname, 'whatsapp');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function detectChromeExecutable() {
  // Prefer puppeteer if available
  try {
    // eslint-disable-next-line node/no-extraneous-require
    const puppeteer = require('puppeteer');
    if (puppeteer && typeof puppeteer.executablePath === 'function') {
      const p = puppeteer.executablePath();
      if (p && fs.existsSync(p)) return p;
    }
  } catch (_) {}

  // Common system paths
  const candidates = [];
  if (os.platform() === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (os.platform() === 'win32') {
    candidates.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push(process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe');
  } else {
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/chromium-browser');
    candidates.push('/usr/bin/chromium');
  }
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

// Check whether any running process references the given auth/profile directory
function isProfileInUse(authDir) {
  try {
    const out = execSync('ps aux', { encoding: 'utf8' });
    return out && out.includes(authDir);
  } catch (_) {
    return false;
  }
}

// Normalize mobile number to Indian format without '+'; e.g. '9876543210' -> '919876543210'
function normalizeNumber(number) {
  const digits = String(number || '').replace(/[^0-9]/g, '');
  if (!digits) throw new Error('Invalid phone number');
  // strip leading zeros
  let d = digits.replace(/^0+/, '');
  // if user provided 10-digit number, prepend country code 91
  if (d.length === 10) d = `91${d}`;
  return d;
}

class WhatsappService {
  constructor() {
    this.client = null;
    this.qrDataUrl = null;
    this.status = 'disconnected';
    this.initialized = false;
    this.emitter = new EventEmitter();
    this._waiting = [];
    this._sendQueue = [];
    this._processingQueue = false;
    this._maxSendAttempts = 3;
    this._shuttingDown = false;
    this._initializingPromise = null;
    this._healthInterval = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._exitHandlersBound = false;
  }

  async init(opts = {}) {
    const { force = false } = opts;
    if (this._shuttingDown) throw new Error('Whatsapp service shutting down');
    if (this._initializingPromise) {
      if (!force) return this._initializingPromise;
      try { await this._initializingPromise; } catch (_) { /* ignore, will retry below */ }
    }
    if (!force && this.initialized && this.client && this.status === 'connected') return;

    this._initializingPromise = this._initializeInternal();
    try {
      await this._initializingPromise;
    } finally {
      this._initializingPromise = null;
    }
  }

  async _initializeInternal() {
    await this._destroyClient();
    ensureDir(SESS_DIR);
    // Before launching, try to remove stale LocalAuth session lock if present and not in use
    try {
      const authDir = path.resolve(process.cwd(), '.wwebjs_auth', 'session-glintex');
      const lockFile = path.join(authDir, 'SingletonLock');
      if (fs.existsSync(lockFile) && !isProfileInUse(authDir)) {
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
          console.log('Removed stale LocalAuth session directory to avoid ProcessSingleton error:', authDir);
        } catch (e) {
          console.warn('Failed to remove stale LocalAuth session directory:', e && e.message);
        }
      }
    } catch (e) {
      // best-effort cleanup; continue to attempt init
    }

    // Use LocalAuth which stores session data in ~/.local/share but we'll still provide explicit path fallback
    // create client with faster puppeteer flags
    const execPath = detectChromeExecutable();
    const puppeteerOpts = {
      headless: true,
      defaultViewport: null,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--no-first-run','--disable-extensions','--disable-features=site-per-process'],
    };
    if (execPath) puppeteerOpts.executablePath = execPath;

    // Try multiple times to initialize browser (cleaning stale session dir between attempts)
    const maxLaunchAttempts = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxLaunchAttempts; attempt++) {
      try {
        const client = new Client({ authStrategy: new LocalAuth({ clientId: 'glintex' }), puppeteer: puppeteerOpts });

        client.on('qr', async (qr) => {
          this.qrDataUrl = await qrcode.toDataURL(qr);
          this.status = 'qr';
          this.emitter.emit('qr', { qr: this.qrDataUrl });
          this.emitter.emit('status', { status: this.status });
        });

        client.on('ready', () => {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.emitter.emit('status', { status: this.status });
          this.emitter.emit('qr', { qr: null });
          // flush waiting promises
          this._flushWaiting();
          // start processing any queued sends
          this._processQueue().catch(err => console.error('Queue processor failed', err));
          this._clearReconnectTimer();
          this._startHealthChecks();
        });

        client.on('authenticated', (session) => {
          this.status = 'authenticated';
          this.emitter.emit('status', { status: this.status });
        });

        client.on('auth_failure', async (msg) => {
          console.error('Auth failure:', msg);
          await this._handleFatalDisconnect('auth_failure');
        });

        client.on('disconnected', async (reason) => {
          console.log('Whatsapp disconnected', reason);
          await this._handleFatalDisconnect('disconnected');
        });

        this.client = client;
        this.status = 'initializing';
        this.emitter.emit('status', { status: this.status });

        await client.initialize();
        this.initialized = true;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`Whatsapp client initialize attempt #${attempt} failed:`, err && err.message);
        await this._destroyClient();
        // Attempt best-effort cleanup of stale session dir before retrying
        try {
          const authDir = path.resolve(process.cwd(), '.wwebjs_auth', 'session-glintex');
          const lockFile = path.join(authDir, 'SingletonLock');
          if (fs.existsSync(lockFile) && !isProfileInUse(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('Removed stale LocalAuth session directory and will retry initialization:', authDir);
          }
        } catch (cleanupErr) {
          console.warn('Cleanup during init failure failed', cleanupErr && cleanupErr.message);
        }
        if (attempt < maxLaunchAttempts) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
      }
    }
    if (lastErr) {
      this.status = 'disconnected';
      this.emitter.emit('status', { status: this.status });
      throw lastErr;
    }
    // attach process exit handlers to gracefully shutdown client
    if (!this._exitHandlersBound) {
      this._exitHandlersBound = true;
      process.once('SIGINT', async () => { this._shuttingDown = true; await this._destroyClient(); process.exit(0); });
      process.once('exit', async () => { this._shuttingDown = true; await this._destroyClient(); });
    }
  }

  getStatus() {
    return { status: this.status, hasQr: !!this.qrDataUrl, initializing: !this.initialized };
  }

  getQrDataUrl() {
    return this.qrDataUrl;
  }

  async logout() {
    // Perform a full logout: logout the session, destroy client, and remove LocalAuth session files
    try {
      if (this.client) {
        await this.client.logout();
      }
    } catch (e) { console.error(e); }
    await this._destroyClient();
    this._setDisconnectedState({ reason: 'logout', error: new Error('Whatsapp logged out'), scheduleReconnect: false });
    // remove LocalAuth session directory used by whatsapp-web.js for this client
    try {
      const authDir = path.resolve(process.cwd(), '.wwebjs_auth', 'session-glintex');
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch (e) { console.error('Failed to clear auth dir', e); }
    this._shuttingDown = false;
  }

  async sendText(number, text) {
    // Enqueue the send so it will be processed when client is ready.
    return this.enqueueSend(number, text);
  }

  // Safe send that doesn't throw if client not ready immediately; returns a promise
  async sendTextSafe(number, text) {
    // try a gentle wait first
    try {
      await this._waitUntilConnected(15000);
    } catch (err) {
      // Try to initialize and fall back to queueing
      try {
        await this.init();
      } catch (e) {
        // still not available, enqueue and let it run when ready; reject after timeout
        return this.enqueueSend(number, text, { timeout: 30000 });
      }
    }
    return this.enqueueSend(number, text);
  }

  // Send to a raw chat id (e.g. group id like '12345-67890@g.us')
  async sendToChatIdSafe(chatId, text) {
    try {
      await this._waitUntilConnected(15000);
    } catch (err) {
      try { await this.init(); } catch (_) { /* ignore, will enqueue */ }
    }
    return this.enqueueSend(null, text, { chatId });
  }

  enqueueSend(number, text, opts = {}) {
    if (this._shuttingDown) return Promise.reject(new Error('Whatsapp service shutting down'));
    return new Promise((resolve, reject) => {
      const entry = {
        number: number || null,
        chatId: opts.chatId || null,
        text,
        resolve,
        reject,
        attempts: 0,
        timeoutMs: opts.timeout || 0,
        enqueuedAt: Date.now(),
      };
      this._sendQueue.push(entry);
      // kick the processor
      this._processQueue().catch(err => console.error('Queue processor error', err));
    });
  }

  async _processQueue() {
    if (this._processingQueue) return;
    this._processingQueue = true;
    try {
      while (this._sendQueue.length > 0) {
        // ensure client is ready
        if (this.status !== 'connected' || !this.client) {
          // wait for ready or timeout before retrying
          try {
            await this._waitUntilConnected(30000);
          } catch (e) {
            const now = Date.now();
            const snapshot = [...this._sendQueue];
            for (const item of snapshot) {
              const expired = item.timeoutMs > 0 && (now - item.enqueuedAt) >= item.timeoutMs;
              if (expired || item.attempts >= this._maxSendAttempts) {
                const errMsg = expired ? 'Whatsapp send timed out waiting for connection' : 'Whatsapp client not available';
                try { item.reject(new Error(errMsg)); } catch (_) {}
                const idx = this._sendQueue.indexOf(item);
                if (idx >= 0) this._sendQueue.splice(idx, 1);
              }
            }
            // Pause processing until next status change
            break;
          }
        }

        const entry = this._sendQueue.shift();
        if (!entry) break;
        const now = Date.now();
        if (entry.timeoutMs > 0 && (now - entry.enqueuedAt) >= entry.timeoutMs) {
          try { entry.reject(new Error('Whatsapp send timed out')); } catch (_) {}
          continue;
        }
        entry.attempts += 1;
        // Determine chat id: either a provided chatId (group), or normalized phone number
        let id = null;
        if (entry.chatId) {
          id = String(entry.chatId);
        } else if (entry.number) {
          const normalized = (() => { try { return normalizeNumber(entry.number); } catch (_) { return null; } })();
          if (!normalized) {
            entry.reject(new Error('Invalid phone number'));
            continue;
          }
          id = `${normalized}@c.us`;
        } else {
          entry.reject(new Error('No recipient specified'));
          continue;
        }
        try {
          // perform send and await
          await this.client.sendMessage(id, entry.text);
          entry.resolve(true);
        } catch (err) {
          console.error('Failed to send whatsapp message', err && err.message);
          // if attempts remain, push back to queue's end to retry after reconnect
          if (entry.attempts < this._maxSendAttempts) {
            this._sendQueue.push(entry);
            // if error looks like session/page closed, attempt re-init
            if (this._isFatalError(err)) {
              await this._handleFatalDisconnect('send_failure');
            }
            // small delay to avoid tight loop
            await new Promise(r => setTimeout(r, 500));
          } else {
            entry.reject(err);
          }
        }
      }
    } finally {
      this._processingQueue = false;
    }
  }

  _waitUntilConnected(timeout = 10000) {
    if (this.status === 'connected' && this.client) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const entry = { timer: null, resolve: null, reject: null };
      const cleanup = () => {
        if (entry.timer) clearTimeout(entry.timer);
        const idx = this._waiting.indexOf(entry);
        if (idx >= 0) this._waiting.splice(idx, 1);
      };
      entry.resolve = () => { cleanup(); resolve(); };
      entry.reject = (err) => { cleanup(); reject(err); };
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout waiting for whatsapp connection'));
        }, timeout);
        entry.timer.unref?.();
      }
      this._waiting.push(entry);
    });
  }

  _flushWaiting(err = null) {
    const waits = this._waiting.slice();
    this._waiting = [];
    for (const waiter of waits) {
      if (waiter.timer) clearTimeout(waiter.timer);
      try {
        if (err) waiter.reject(err);
        else waiter.resolve();
      } catch (_) {}
    }
  }

  getEmitter() { return this.emitter; }

  async _destroyClient() {
    const client = this.client;
    this.client = null;
    if (client) {
      try { await client.destroy(); } catch (e) { console.warn('Failed to destroy whatsapp client', e && e.message); }
    }
    this.initialized = false;
    this._stopHealthChecks();
  }

  _setDisconnectedState({ reason, error = null, scheduleReconnect = true } = {}) {
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.emitter.emit('status', { status: this.status, reason });
    if (error) this.emitter.emit('error', { reason, message: error.message });
    this.initialized = false;
    this._flushWaiting(error || new Error('Whatsapp disconnected'));
    this._processingQueue = false;
    if (error) {
      const pending = this._sendQueue.splice(0);
      for (const item of pending) {
        try { item.reject(error); } catch (_) {}
      }
    }
    if (!scheduleReconnect) {
      this._clearReconnectTimer();
      return;
    }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._shuttingDown) return;
    if (this._reconnectTimer) return;
    const attempt = this._reconnectAttempts + 1;
    const delay = Math.min(60000, 1000 * Math.pow(2, attempt - 1));
    console.log(`Re-init attempt #${attempt} in ${delay}ms`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      this._reconnectAttempts = attempt;
      try {
        if (this._initializingPromise) {
          try {
            await this._initializingPromise;
          } catch (_) {
            // ignore and proceed to force init below
          }
          if (this.status === 'connected' && this.client) {
            this._reconnectAttempts = 0;
            console.log('Reconnect timer skipped; service already connected');
            return;
          }
        }
        await this.init({ force: true });
        this._reconnectAttempts = 0;
        console.log('Re-init successful');
      } catch (err) {
        console.error('Re-init failed', err && err.message);
        this._scheduleReconnect();
      }
    }, delay);
    this._reconnectTimer.unref?.();
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempts = 0;
  }

  _startHealthChecks() {
    if (this._healthInterval) return;
    this._healthInterval = setInterval(() => {
      this._runHealthCheck().catch(err => console.warn('Whatsapp health check failed', err && err.message));
    }, 60000);
    this._healthInterval.unref?.();
  }

  _stopHealthChecks() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async _runHealthCheck() {
    if (!this.client || this.status !== 'connected' || this._initializingPromise) return;
    try {
      const state = await this.client.getState();
      if (state !== 'CONNECTED') {
        throw new Error(`Unexpected whatsapp state: ${state}`);
      }
    } catch (err) {
      await this._handleFatalDisconnect('health_check');
      throw err;
    }
  }

  _isFatalError(err) {
    if (!err) return false;
    const msg = String(err.message || err || '').toLowerCase();
    return /session closed|session not created|target closed|protocol error|page crashed/.test(msg);
  }

  async _handleFatalDisconnect(reason) {
    await this._destroyClient();
    this._setDisconnectedState({ reason, scheduleReconnect: !this._shuttingDown });
  }
}

const svc = new WhatsappService();
export default svc;


