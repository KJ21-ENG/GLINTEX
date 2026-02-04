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
    const recipients = resolveRecipients({ template, settings });

    if (recipients.length === 0) {
      console.warn('No recipients configured for', event);
      return { ok: false, reason: 'no_recipients' };
    }

    recipients.forEach(r => {
      if (r.type === 'number') {
        whatsapp.sendTextSafe(r.value, msg).catch(err => console.error('Failed to send to number', err));
      } else {
        whatsapp.sendToChatIdSafe(r.value, msg).catch(err => console.error('Failed to send to group', err));
      }
    });

    return { ok: true, recipients };
  } catch (err) {
    console.error('sendNotification error', err);
    return { ok: false, reason: 'error', error: err };
  }
}
