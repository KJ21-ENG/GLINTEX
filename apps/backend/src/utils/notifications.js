import prisma from '../lib/prisma.js';
import whatsapp from './whatsappStub.js';
import { getTemplateByEvent, interpolateTemplate } from './whatsappTemplates.js';

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

    const msg = interpolateTemplate(template.template, payload || {});
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
