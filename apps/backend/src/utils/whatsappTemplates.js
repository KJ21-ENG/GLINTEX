import prisma from '../lib/prisma.js';

export function interpolateTemplate(template, ctx) {
  if (!template) return '';
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const v = ctx && Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : '';
    if (Array.isArray(v)) return v.join(', ');
    // For certain keys, prefer a visible placeholder when empty
    if ((v === null || v === undefined || v === '') && ['machineName', 'operatorName', 'machineNumber'].includes(key)) return '—';
    return String(v ?? '');
  }).slice(0, 1500); // truncate to 1500 chars
}

export async function getTemplateByEvent(event) {
  return await prisma.whatsappTemplate.findUnique({ where: { event } });
}

export async function listTemplates() {
  return await prisma.whatsappTemplate.findMany({ orderBy: { id: 'asc' } });
}

export async function upsertTemplate(event, data) {
  return await prisma.whatsappTemplate.upsert({
    where: { event },
    update: data,
    create: { event, ...data },
  });
}


