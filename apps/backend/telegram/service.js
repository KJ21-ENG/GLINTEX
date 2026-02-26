import prisma from '../src/lib/prisma.js';

const API_BASE = 'https://api.telegram.org';

function normalizeChatId(chatId) {
  const value = String(chatId || '').trim();
  return value || null;
}

function sanitizeErrorMessage(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'unknown_error';
  return text.replace(/\d{8,}/g, '[redacted]');
}

class TelegramService {
  constructor() {
    this.status = 'disconnected';
    this.lastError = null;
    this.lastCheckedAt = null;
  }

  async init() {
    try {
      await this.refreshStatus();
    } catch (err) {
      this.status = 'error';
      this.lastError = sanitizeErrorMessage(err?.message || err);
    }
  }

  async _loadSettings() {
    return await prisma.settings.findUnique({ where: { id: 1 } });
  }

  async _resolveToken(explicitToken = null) {
    const token = String(explicitToken || '').trim();
    if (token) return token;
    const settings = await this._loadSettings();
    const stored = String(settings?.telegramBotToken || '').trim();
    if (!stored) throw new Error('telegram_token_not_configured');
    return stored;
  }

  _buildUrl(token, method) {
    return `${API_BASE}/bot${encodeURIComponent(token)}/${method}`;
  }

  async _postJson(token, method, body) {
    const response = await fetch(this._buildUrl(token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(sanitizeErrorMessage(data?.description || `${method}_failed_${response.status}`));
    }
    return data?.result || data;
  }

  async refreshStatus() {
    this.lastCheckedAt = new Date().toISOString();
    try {
      const token = await this._resolveToken();
      const response = await fetch(this._buildUrl(token, 'getMe'), {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        const errorMessage = sanitizeErrorMessage(data?.description || `HTTP_${response.status}`);
        this.status = 'error';
        this.lastError = errorMessage;
        return this.getStatus();
      }
      this.status = 'connected';
      this.lastError = null;
      return this.getStatus();
    } catch (err) {
      this.status = 'disconnected';
      this.lastError = sanitizeErrorMessage(err?.message || err);
      return this.getStatus();
    }
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  async sendText(chatId, text, opts = {}) {
    const token = await this._resolveToken(opts.token);
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) throw new Error('telegram_chat_id_missing');

    const result = await this._postJson(token, 'sendMessage', {
      chat_id: normalizedChatId,
      text: String(text || ''),
      disable_web_page_preview: true,
    });

    this.status = 'connected';
    this.lastError = null;
    this.lastCheckedAt = new Date().toISOString();
    return result;
  }

  async sendTextSafe(chatId, text, opts = {}) {
    try {
      return await this.sendText(chatId, text, opts);
    } catch (err) {
      this.status = 'error';
      this.lastError = sanitizeErrorMessage(err?.message || err);
      this.lastCheckedAt = new Date().toISOString();
      throw err;
    }
  }

  async sendMedia(chatId, buffer, filename = 'document', mimetype = 'application/octet-stream', caption = '', opts = {}) {
    const token = await this._resolveToken(opts.token);
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) throw new Error('telegram_chat_id_missing');
    if (!buffer) throw new Error('telegram_media_buffer_missing');

    const form = new FormData();
    form.append('chat_id', normalizedChatId);
    if (caption) form.append('caption', String(caption).slice(0, 1024));
    const mediaBlob = new Blob([buffer], { type: mimetype || 'application/octet-stream' });
    form.append('document', mediaBlob, filename || 'document');

    const response = await fetch(this._buildUrl(token, 'sendDocument'), {
      method: 'POST',
      body: form,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(sanitizeErrorMessage(data?.description || `telegram_media_send_failed_${response.status}`));
    }

    this.status = 'connected';
    this.lastError = null;
    this.lastCheckedAt = new Date().toISOString();
    return data?.result || data;
  }

  async sendMediaSafe(chatId, buffer, filename, mimetype, caption = '', opts = {}) {
    try {
      return await this.sendMedia(chatId, buffer, filename, mimetype, caption, opts);
    } catch (err) {
      this.status = 'error';
      this.lastError = sanitizeErrorMessage(err?.message || err);
      this.lastCheckedAt = new Date().toISOString();
      throw err;
    }
  }

  async getChatInfo(chatId, opts = {}) {
    const token = await this._resolveToken(opts.token);
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) throw new Error('telegram_chat_id_missing');
    const result = await this._postJson(token, 'getChat', { chat_id: normalizedChatId });
    const displayName = String(
      result?.title
      || [result?.first_name, result?.last_name].filter(Boolean).join(' ')
      || (result?.username ? `@${result.username}` : '')
      || normalizedChatId
    ).trim();
    return {
      chatId: normalizedChatId,
      type: result?.type || null,
      title: result?.title || null,
      username: result?.username || null,
      firstName: result?.first_name || null,
      lastName: result?.last_name || null,
      displayName,
    };
  }

  async getChatInfoSafe(chatId, opts = {}) {
    try {
      return await this.getChatInfo(chatId, opts);
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err?.message || err));
    }
  }
}

const telegram = new TelegramService();

export default telegram;
