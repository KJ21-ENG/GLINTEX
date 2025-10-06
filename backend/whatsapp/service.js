import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import EventEmitter from 'events';
import qrcode from 'qrcode';

const SESS_DIR = path.resolve(new URL('..', import.meta.url).pathname, 'whatsapp');
const SESS_FILE = path.join(SESS_DIR, 'session.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
  }

  async init() {
    if (this.initialized) return;
    ensureDir(SESS_DIR);
    // Use LocalAuth which stores session data in ~/.local/share but we'll still provide explicit path fallback
    // create client with faster puppeteer flags
    this.client = new Client({ authStrategy: new LocalAuth({ clientId: 'glintex' }), puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process','--disable-extensions'] } });

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
      this.client = null;
      // Try to re-init after short delay
      setTimeout(async () => {
        try {
          console.log('Attempting to re-initialize Whatsapp client after disconnect...');
          await this.init();
        } catch (err) {
          console.error('Re-init failed', err);
        }
      }, 1000);
    });

    await this.client.initialize();
    this.initialized = true;
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
    // remove LocalAuth session directory used by whatsapp-web.js for this client
    try {
      const authDir = path.resolve(process.cwd(), '.wwebjs_auth', 'session-glintex');
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch (e) { console.error('Failed to clear auth dir', e); }
    this.initialized = false;
    this.client = null;
  }

  async sendText(number, text) {
    // wait until connected
    await this._waitUntilConnected(10000);
    if (!this.client) throw new Error('Client not initialized');
    // normalize number (ensure country code present)
    const normalized = normalizeNumber(number);
    // whatsapp-web.js expects id like '919999999999@c.us'
    const id = `${normalized}@c.us`;
    return await this.client.sendMessage(id, text);
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


