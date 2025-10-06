import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';

const SESS_DIR = path.resolve(new URL('..', import.meta.url).pathname, 'whatsapp');
const SESS_FILE = path.join(SESS_DIR, 'session.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class WhatsappService {
  constructor() {
    this.client = null;
    this.qrDataUrl = null;
    this.status = 'disconnected';
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    ensureDir(SESS_DIR);
    // Use LocalAuth which stores session data in ~/.local/share but we'll still provide explicit path fallback
    this.client = new Client({ authStrategy: new LocalAuth({ clientId: 'glintex' }), puppeteer: { headless: true } });

    this.client.on('qr', async (qr) => {
      this.qrDataUrl = await qrcode.toDataURL(qr);
      this.status = 'qr';
    });

    this.client.on('ready', () => {
      this.status = 'connected';
      this.qrDataUrl = null;
    });

    this.client.on('authenticated', (session) => {
      this.status = 'authenticated';
    });

    this.client.on('auth_failure', (msg) => {
      this.status = 'disconnected';
      this.qrDataUrl = null;
      console.error('Auth failure:', msg);
    });

    this.client.on('disconnected', (reason) => {
      this.status = 'disconnected';
      this.qrDataUrl = null;
      console.log('Whatsapp disconnected', reason);
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
      }, 3000);
    });

    await this.client.initialize();
    this.initialized = true;
  }

  getStatus() {
    return { status: this.status, hasQr: !!this.qrDataUrl };
  }

  getQrDataUrl() {
    return this.qrDataUrl;
  }

  async logout() {
    if (!this.client) return;
    try {
      await this.client.logout();
    } catch (e) { console.error(e); }
    this.status = 'disconnected';
    this.qrDataUrl = null;
    // clear local auth dir for this client
    // LocalAuth stores in appData path; we won't attempt to erase it here for safety
  }

  async sendText(number, text) {
    if (!this.client) throw new Error('Client not initialized');
    // whatsapp-web.js expects number like '919999999999@c.us'
    const id = `${number.replace(/[^0-9]/g,'')}@c.us`;
    return await this.client.sendMessage(id, text);
  }
}

const svc = new WhatsappService();
export default svc;


