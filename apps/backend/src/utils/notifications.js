import prisma from '../lib/prisma.js';
import whatsapp from '../../whatsapp/service.js';
import telegram from '../../telegram/service.js';
import { getTemplateByEvent, interpolateTemplate } from './whatsappTemplates.js';
import { resolveRecordUserFields } from './userResolver.js';

const CREATOR_TEMPLATE_REGEX = /(\{\{\s*createdBy(?:Label|Name|Username|UserId)?\s*\}\})|(@createdBy(?:Label|Name|Username|UserId)?)/;

function formatCreatorLabel(user, fallbackId) {
  if (user) {
    const display = (user.displayName || '').trim();
    const username = (user.username || '').trim();
    if (display && username && display.toLowerCase() !== username.toLowerCase()) {
      return `${display} (${username})`;
    }
    return display || username || fallbackId || '';
  }
  return fallbackId || '';
}

function normalizeChatIds(chatIds) {
  if (!Array.isArray(chatIds)) return [];
  const seen = new Set();
  const normalized = [];
  for (const raw of chatIds) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function isWhatsAppEnabled(settings) {
  return settings?.whatsappEnabled !== false;
}

function isTelegramEnabled(settings) {
  return settings?.telegramEnabled === true;
}

export function getNotificationChannelConfig(settings = {}) {
  return {
    whatsappEnabled: isWhatsAppEnabled(settings),
    telegramEnabled: isTelegramEnabled(settings),
  };
}

async function enrichPayloadWithCreator(payload) {
  if (!payload || !payload.createdByUserId) {
    return { payload, creatorLabel: '' };
  }

  const enriched = await resolveRecordUserFields({ createdByUserId: payload.createdByUserId });
  const user = enriched?.createdByUser || null;
  const creatorLabel = formatCreatorLabel(user, payload.createdByUserId);

  return {
    payload: {
      ...payload,
      createdByName: user?.displayName || user?.username || '',
      createdByUsername: user?.username || '',
      createdByLabel: creatorLabel,
    },
    creatorLabel,
  };
}

export async function buildWhatsappMessage(template, payload) {
  const { payload: enrichedPayload, creatorLabel } = await enrichPayloadWithCreator(payload);
  let msg = interpolateTemplate(template, enrichedPayload || {});
  if (creatorLabel && !CREATOR_TEMPLATE_REGEX.test(template || '')) {
    msg = `${msg}\nCreated by: ${creatorLabel}`;
  }
  return String(msg || '').slice(0, 1500);
}

export async function appendCreatorToCaption(caption, createdByUserId) {
  if (!createdByUserId) return caption || '';
  const enriched = await resolveRecordUserFields({ createdByUserId });
  const creatorLabel = formatCreatorLabel(enriched?.createdByUser || null, createdByUserId);
  if (!creatorLabel) return caption || '';
  const base = caption ? String(caption) : '';
  const suffix = `Created by: ${creatorLabel}`;
  return (base ? `${base}\n${suffix}` : suffix).slice(0, 1500);
}

export function resolveWhatsappRecipients({ template, settings }) {
  const recipients = [];
  if (template?.sendToPrimary !== false && settings?.whatsappNumber) {
    recipients.push({ type: 'number', value: settings.whatsappNumber });
  }

  const allowedGroups = Array.isArray(settings?.whatsappGroupIds)
    ? settings.whatsappGroupIds
    : [];
  const templateGroups = Array.isArray(template?.groupIds) ? template.groupIds : [];
  const groupsToSend = templateGroups.filter(id => allowedGroups.includes(id));
  for (const gid of groupsToSend) recipients.push({ type: 'group', value: gid });

  const seen = new Set();
  return recipients.filter((recipient) => {
    const key = `${recipient.type}:${recipient.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveTelegramRecipients(settings = {}) {
  return normalizeChatIds(settings?.telegramChatIds);
}

export function resolveTemplateTelegramRecipients({ template, settings }) {
  const settingsChatIds = resolveTelegramRecipients(settings || {});
  const templateChatIds = normalizeChatIds(template?.telegramChatIds);
  // Strict mode: Telegram targets must be explicitly selected per template.
  if (templateChatIds.length === 0) return [];
  // Global chat list is the authoritative allow-list.
  if (settingsChatIds.length === 0) return [];
  const allowSet = new Set(settingsChatIds);
  return templateChatIds.filter((chatId) => allowSet.has(chatId));
}

function sanitizeLogText(value, max = 500) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function withTimeout(promise, ms, label = 'operation_timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

function normalizeRecipientEntry(channel, raw) {
  if (raw && typeof raw === 'object') {
    const value = sanitizeLogText(raw.value ?? raw.recipient, 200);
    if (!value) return null;
    return { value, type: sanitizeLogText(raw.type, 40) || (channel === 'telegram' ? 'chat' : null) };
  }
  const value = sanitizeLogText(raw, 200);
  if (!value) return null;
  return { value, type: channel === 'telegram' ? 'chat' : null };
}

function buildDeliveryRowsForChannel({ channel, channelData, event, templateEvent, templateId, source, createdByUserId }) {
  const rows = [];
  if (!channelData || channelData.enabled !== true) {
    rows.push({
      event: sanitizeLogText(event, 120),
      templateEvent: sanitizeLogText(templateEvent, 120),
      templateId: Number.isInteger(templateId) ? templateId : null,
      source: sanitizeLogText(source, 120),
      channel,
      recipient: null,
      recipientType: null,
      status: 'skipped',
      reason: channelData?.enabled === false ? 'channel_disabled' : 'channel_unavailable',
      error: null,
      createdByUserId: sanitizeLogText(createdByUserId, 120),
    });
    return rows;
  }

  const recipients = Array.isArray(channelData.recipients)
    ? channelData.recipients.map((entry) => normalizeRecipientEntry(channel, entry)).filter(Boolean)
    : [];
  const results = Array.isArray(channelData.results) ? channelData.results : [];
  const resultByRecipient = new Map();
  for (const result of results) {
    const key = sanitizeLogText(result?.recipient, 200);
    if (!key) continue;
    resultByRecipient.set(key, result);
  }

  if (recipients.length === 0) {
    rows.push({
      event: sanitizeLogText(event, 120),
      templateEvent: sanitizeLogText(templateEvent, 120),
      templateId: Number.isInteger(templateId) ? templateId : null,
      source: sanitizeLogText(source, 120),
      channel,
      recipient: null,
      recipientType: null,
      status: 'skipped',
      reason: sanitizeLogText(channelData.reason || 'no_recipients', 120),
      error: null,
      createdByUserId: sanitizeLogText(createdByUserId, 120),
    });
    return rows;
  }

  for (const recipient of recipients) {
    const result = resultByRecipient.get(recipient.value);
    const success = result?.success === true;
    rows.push({
      event: sanitizeLogText(event, 120),
      templateEvent: sanitizeLogText(templateEvent, 120),
      templateId: Number.isInteger(templateId) ? templateId : null,
      source: sanitizeLogText(source, 120),
      channel,
      recipient: recipient.value,
      recipientType: recipient.type,
      status: success ? 'success' : 'failed',
      reason: success ? null : sanitizeLogText(channelData.reason || 'send_failed', 120),
      error: success ? null : sanitizeLogText(result?.error, 1000),
      createdByUserId: sanitizeLogText(createdByUserId, 120),
    });
  }

  return rows;
}

export async function persistNotificationDeliveryLogs({
  event = null,
  templateEvent = null,
  templateId = null,
  source = 'notification_send',
  channels = {},
  createdByUserId = null,
} = {}) {
  try {
    const data = [];
    data.push(...buildDeliveryRowsForChannel({
      channel: 'whatsapp',
      channelData: channels?.whatsapp,
      event,
      templateEvent,
      templateId,
      source,
      createdByUserId,
    }));
    data.push(...buildDeliveryRowsForChannel({
      channel: 'telegram',
      channelData: channels?.telegram,
      event,
      templateEvent,
      templateId,
      source,
      createdByUserId,
    }));
    if (data.length === 0) return;
    await prisma.notificationDeliveryLog.createMany({ data });
  } catch (err) {
    console.error('Failed to write notification delivery logs', err);
  }
}

async function sendWhatsappRecipients(recipients, message) {
  const settled = await Promise.all(recipients.map(async (recipient) => {
    try {
      if (recipient.type === 'number') {
        await withTimeout(whatsapp.sendTextSafe(recipient.value, message), 15000, 'whatsapp_send_timeout');
      } else {
        await withTimeout(whatsapp.sendToChatIdSafe(recipient.value, message), 15000, 'whatsapp_send_timeout');
      }
      return { recipient: recipient.value, type: recipient.type, success: true };
    } catch (err) {
      return { recipient: recipient.value, type: recipient.type, success: false, error: err?.message || String(err) };
    }
  }));
  return settled;
}

async function sendTelegramRecipients(chatIds, message) {
  const settled = await Promise.all(chatIds.map(async (chatId) => {
    try {
      await withTimeout(telegram.sendTextSafe(chatId, message), 15000, 'telegram_send_timeout');
      return { recipient: chatId, success: true };
    } catch (err) {
      return { recipient: chatId, success: false, error: err?.message || String(err) };
    }
  }));
  return settled;
}

export async function sendNotification(event, payload, opts = {}) {
  try {
    console.log('sendNotification called for', event, 'payload:', payload && JSON.stringify(payload));
    let template = await getTemplateByEvent(event);

    if (!template) {
      if (!opts.fallbackTemplate) {
        console.warn('No template for event', event);
        return { ok: false, reason: 'template_not_found' };
      }
      template = {
        enabled: true,
        template: opts.fallbackTemplate,
        sendToPrimary: true,
        groupIds: [],
      };
    }

    if (!template.enabled) {
      console.log('Template disabled for event', event);
      return { ok: false, reason: 'template_disabled' };
    }

    const msg = await buildWhatsappMessage(template.template, payload || {});
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const { whatsappEnabled, telegramEnabled } = getNotificationChannelConfig(settings || {});

    if (!whatsappEnabled && !telegramEnabled) {
      const channels = { whatsapp: { enabled: false }, telegram: { enabled: false } };
      persistNotificationDeliveryLogs({
        event,
        templateEvent: template?.event || event,
        templateId: Number.isInteger(template?.id) ? template.id : null,
        source: opts?.source || 'send_notification',
        channels,
        createdByUserId: payload?.createdByUserId || opts?.actorUserId || null,
      }).catch(() => { });
      return { ok: false, reason: 'no_enabled_channels', channels };
    }

    const channelResults = {
      whatsapp: {
        enabled: whatsappEnabled,
        recipients: [],
        results: [],
        ok: false,
        reason: null,
      },
      telegram: {
        enabled: telegramEnabled,
        recipients: [],
        results: [],
        ok: false,
        reason: null,
      },
    };

    if (whatsappEnabled) {
      const recipients = resolveWhatsappRecipients({ template, settings: settings || {} });
      channelResults.whatsapp.recipients = recipients;
      if (recipients.length === 0) {
        channelResults.whatsapp.reason = 'no_recipients';
      } else {
        channelResults.whatsapp.results = await sendWhatsappRecipients(recipients, msg);
        channelResults.whatsapp.ok = channelResults.whatsapp.results.some((result) => result.success);
        if (!channelResults.whatsapp.ok) {
          channelResults.whatsapp.reason = 'send_failed';
        }
      }
    }

    if (telegramEnabled) {
      const chatIds = resolveTemplateTelegramRecipients({ template, settings: settings || {} });
      channelResults.telegram.recipients = chatIds.map((chatId) => ({ type: 'chat', value: chatId }));
      if (chatIds.length === 0) {
        channelResults.telegram.reason = 'no_recipients';
      } else {
        channelResults.telegram.results = await sendTelegramRecipients(chatIds, msg);
        channelResults.telegram.ok = channelResults.telegram.results.some((result) => result.success);
        if (!channelResults.telegram.ok) {
          channelResults.telegram.reason = 'send_failed';
        }
      }
    }

    const overallOk = channelResults.whatsapp.ok || channelResults.telegram.ok;
    persistNotificationDeliveryLogs({
      event,
      templateEvent: template?.event || event,
      templateId: Number.isInteger(template?.id) ? template.id : null,
      source: opts?.source || 'send_notification',
      channels: channelResults,
      createdByUserId: payload?.createdByUserId || opts?.actorUserId || null,
    }).catch(() => { });
    if (!overallOk) {
      return {
        ok: false,
        reason: 'all_channels_failed',
        recipients: channelResults.whatsapp.recipients,
        channels: channelResults,
      };
    }

    return {
      ok: true,
      recipients: channelResults.whatsapp.recipients,
      channels: channelResults,
    };
  } catch (err) {
    console.error('sendNotification error', err);
    return { ok: false, reason: 'error', error: err?.message || String(err) };
  }
}
