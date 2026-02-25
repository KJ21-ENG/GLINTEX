import prisma from '../lib/prisma.js';
import whatsapp from '../../whatsapp/service.js';
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

function resolveRecipients({ template, settings }) {
  const recipients = [];
  if (template.sendToPrimary !== false && settings && settings.whatsappNumber) {
    recipients.push({ type: 'number', value: settings.whatsappNumber });
  }

  const allowedGroups = (settings && Array.isArray(settings.whatsappGroupIds))
    ? settings.whatsappGroupIds
    : [];
  const templateGroups = Array.isArray(template.groupIds) ? template.groupIds : [];
  const groupsToSend = templateGroups.filter(id => allowedGroups.includes(id));
  for (const gid of groupsToSend) recipients.push({ type: 'group', value: gid });

  const seen = new Set();
  return recipients.filter(r => {
    const key = `${r.type}:${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeEventId(event) {
  const safeEvent = String(event || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${safeEvent}-${ts}-${rand}`;
}

export async function sendNotification(event, payload, opts = {}) {
  try {
    const eventId = makeEventId(event);
    console.log('[Whatsapp][notify] start', JSON.stringify({ eventId, event }));
    let template = await getTemplateByEvent(event);

    if (!template) {
      if (!opts.fallbackTemplate) {
        console.warn('[Whatsapp][notify] template_not_found', JSON.stringify({ eventId, event }));
        return { ok: false, reason: 'template_not_found', eventId };
      }
      template = {
        enabled: true,
        template: opts.fallbackTemplate,
        sendToPrimary: true,
        groupIds: [],
      };
    }

    if (!template.enabled) {
      console.log('[Whatsapp][notify] template_disabled', JSON.stringify({ eventId, event }));
      return { ok: false, reason: 'template_disabled', eventId };
    }

    const msg = await buildWhatsappMessage(template.template, payload || {});
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const recipients = resolveRecipients({ template, settings });

    if (recipients.length === 0) {
      console.warn('[Whatsapp][notify] no_recipients', JSON.stringify({ eventId, event }));
      return { ok: false, reason: 'no_recipients', eventId };
    }

    recipients.forEach(r => {
      const meta = {
        eventId,
        event,
        recipientType: r.type,
        recipient: r.value,
      };
      if (r.type === 'number') {
        whatsapp.sendTextSafe(r.value, msg, { meta }).catch(err => {
          console.error('[Whatsapp][notify] send_failed', JSON.stringify({ ...meta, error: err?.message || String(err) }));
        });
      } else {
        whatsapp.sendToChatIdSafe(r.value, msg, { meta }).catch(err => {
          console.error('[Whatsapp][notify] send_failed', JSON.stringify({ ...meta, error: err?.message || String(err) }));
        });
      }
    });

    console.log('[Whatsapp][notify] queued', JSON.stringify({ eventId, event, recipients: recipients.length }));
    return { ok: true, eventId, recipients };
  } catch (err) {
    console.error('[Whatsapp][notify] error', JSON.stringify({ event, error: err?.message || String(err) }));
    return { ok: false, reason: 'error', error: err };
  }
}
