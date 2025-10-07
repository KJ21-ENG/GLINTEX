import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import EventEmitter from 'events';
import qrcode from 'qrcode';
import os from 'os';
import { execSync } from 'child_process';

const SESS_DIR = path.resolve(new URL('..', import.meta.url).pathname, 'whatsapp');
const SESS_FILE = path.join(SESS_DIR, 'session.json');

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
  }

  async init() {
    if (this.initialized) return;
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
        this.client = new Client({ authStrategy: new LocalAuth({ clientId: 'glintex' }), puppeteer: puppeteerOpts });

        this.client.on('qr', async (qr) => {
          this.qrDataUrl = await qrcode.toDataURL(qr);
          this.status = 'qr';
          this.emitter.emit('qr', { qr: this.qrDataUrl });
          this.emitter.emit('status', { status: this.status });
        });

        this.client.on('ready', () => {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.emitter.emit('status', { status: this.status });
          this.emitter.emit('qr', { qr: null });
          // flush waiting promises
          this._flushWaiting();
          // start processing any queued sends
          this._processQueue().catch(err => console.error('Queue processor failed', err));
        });

        this.client.on('authenticated', (session) => {
          this.status = 'authenticated';
          this.emitter.emit('status', { status: this.status });
        });

        this.client.on('auth_failure', (msg) => {
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.emitter.emit('status', { status: this.status });
          console.error('Auth failure:', msg);
        });

        this.client.on('disconnected', (reason) => {
          this.status = 'disconnected';
          this.qrDataUrl = null;
          console.log('Whatsapp disconnected', reason);
          this.emitter.emit('status', { status: this.status });
          // Do not permanently destroy client here - attempt to re-initialize so LocalAuth session is reused
          this.initialized = false;
          // keep client reference removed so sends know it's not available
          this.client = null;
          // let queue processor know we are disconnected; it will pause
          this._processingQueue = false;
          // Try to re-init with exponential backoff
          let reinitAttempt = 0;
          const tryReinit = async () => {
            if (this._shuttingDown) return;
            reinitAttempt += 1;
            const delay = Math.min(60000, 1000 * Math.pow(2, reinitAttempt));
            console.log(`Re-init attempt #${reinitAttempt} in ${delay}ms`);
            setTimeout(async () => {
              try {
                await this.init();
                console.log('Re-init successful');
              } catch (err) {
                console.error('Re-init failed', err && err.message);
                if (reinitAttempt < 6) tryReinit();
              }
            }, delay);
          };
          tryReinit();
        });

        await this.client.initialize();
        this.initialized = true;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`Whatsapp client initialize attempt #${attempt} failed:`, err && err.message);
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
    if (lastErr) throw lastErr;
    // attach process exit handlers to gracefully shutdown client
    process.once('SIGINT', async () => { this._shuttingDown = true; try { if (this.client) { await this.client.destroy(); } } catch (_) {} process.exit(0); });
    process.once('exit', async () => { this._shuttingDown = true; try { if (this.client) { await this.client.destroy(); } } catch (_) {} });
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
        try { await this.client.destroy(); } catch (_) {}
      }
    } catch (e) { console.error(e); }
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.emitter.emit('status', { status: this.status });
    // reject any queued sends because logout is explicit
    for (const item of this._sendQueue) {
      try { item.reject(new Error('Whatsapp logged out')); } catch (_) {}
    }
    this._sendQueue = [];
    // remove LocalAuth session directory used by whatsapp-web.js for this client
    try {
      const authDir = path.resolve(process.cwd(), '.wwebjs_auth', 'session-glintex');
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch (e) { console.error('Failed to clear auth dir', e); }
    this.initialized = false;
    this.client = null;
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

  enqueueSend(number, text, opts = {}) {
    if (this._shuttingDown) return Promise.reject(new Error('Whatsapp service shutting down'));
    return new Promise((resolve, reject) => {
      const entry = { number, text, resolve, reject, attempts: 0, timeout: opts.timeout || 0 };
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
            // If still not connected, reject oldest entries after their timeout
            const nowQueue = this._sendQueue.slice();
            for (const item of nowQueue) {
              item.attempts += 1;
              if (item.attempts >= this._maxSendAttempts || (item.timeout && item.timeout <= 0)) {
                // final rejection
                try { item.reject(new Error('Whatsapp client not available')); } catch (_) {}
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
        entry.attempts += 1;
        const normalized = (() => { try { return normalizeNumber(entry.number); } catch (_) { return null; } })();
        if (!normalized) {
          entry.reject(new Error('Invalid phone number'));
          continue;
        }
        const id = `${normalized}@c.us`;
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
            if (err && /Session closed|Session not created|Target closed|Protocol error/.test(String(err))) {
              try { this.initialized = false; this.client = null; await this.init(); } catch (e) { console.error('Re-init during send failure failed', e); }
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
    if (this.status === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiting.indexOf(onReady);
        if (idx >= 0) this._waiting.splice(idx, 1);
        reject(new Error('Timeout waiting for whatsapp connection'));
      }, timeout);
      const onReady = () => { clearTimeout(timer); resolve(); };
      this._waiting.push(onReady);
    });
  }

  _flushWaiting() {
    const waits = this._waiting.slice();
    this._waiting = [];
    for (const fn of waits) fn();
  }

  getEmitter() { return this.emitter; }
}

const svc = new WhatsappService();
export default svc;


