import prisma from '../lib/prisma.js';

// Replicating formatting logic from frontend/src/utils/formatting.js for backend use
function parseDateToISO(dateStr) {
  if (!dateStr) return '';
  if (dateStr instanceof Date) return dateStr.toISOString().slice(0, 10);
  if (typeof dateStr !== 'string') return '';
  const s = dateStr.trim();
  const isoMatch = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const dmyMatch = s.match(/^(\d{2})[-\/]?(\d{2})[-\/]?(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function formatDateDDMMYYYY(dateStr) {
  const iso = parseDateToISO(dateStr);
  if (!iso) return String(dateStr || '');
  const [yyyy, mm, dd] = iso.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

function interpolateVariables(template, ctx) {
  if (!template) return '';

  const dateKeys = ['date', 'inboundDate', 'createdAt', 'updatedAt'];
  const weightKeys = [
    'weight', 'totalWeight', 'netWeight', 'grossWeight', 'tareWeight',
    'rollWeight', 'coneWeight', 'yarnKg', 'metallicBobbinsWeight',
    'perConeTargetG', 'issuedBobbinWeight', 'wastage', 'totalNetWeight'
  ];

  // Matches {{variable}} or @variable
  return template.replace(/(\{\{\s*([\w.]+)\s*\}\})|(@([\w.]+))/g, (match, p1, p2, p3, p4) => {
    const key = p2 || p4;
    let v = ctx && Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : '';

    if (v === null || v === undefined) {
      // For certain keys, prefer a visible placeholder when empty
      if (['machineName', 'operatorName', 'machineNumber'].includes(key)) return '—';
      return '';
    }

    if (Array.isArray(v)) return v.join(', ');

    // Format date values to DD/MM/YYYY
    if (dateKeys.includes(key) && v) {
      return formatDateDDMMYYYY(v);
    }
    // Format weight values to 3 decimals
    if (weightKeys.includes(key)) {
      const num = Number(v);
      return Number.isFinite(num) ? num.toFixed(3) : String(v);
    }

    return String(v);
  });
}

export function interpolateTemplate(template, ctx) {
  return interpolateVariables(template, ctx).slice(0, 1500);
}

export function interpolateTelegramTemplate(template, ctx, suffix = '') {
  const source = template || '';
  // Parse only template markup, before interpolation, so stars in item names and
  // other values stay literal. Require word boundaries and keep unmatched stars.
  const bold = /(?<![\p{L}\p{N}_*\\])\*([^\s*](?:[^*\r\n]*[^\s*])?)\*(?![\p{L}\p{N}_*])/gu;
  let text = '';
  let cursor = 0;
  const entities = [];
  for (const match of source.matchAll(bold)) {
    text += interpolateVariables(source.slice(cursor, match.index), ctx);
    const value = interpolateVariables(match[1], ctx);
    // JS string lengths and Telegram entity offsets both use UTF-16 code units.
    if (value.length > 0) entities.push({ type: 'bold', offset: text.length, length: value.length });
    text += value;
    cursor = match.index + match[0].length;
  }
  text += interpolateVariables(source.slice(cursor), ctx) + suffix;
  text = text.slice(0, 1500);
  // Do not cut an emoji's surrogate pair at the notification length limit.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return {
    text,
    entities: entities.filter((entity) => entity.offset < text.length).map((entity) => ({
      ...entity,
      length: Math.min(entity.length, text.length - entity.offset),
    })),
  };
}

export async function getTemplateByEvent(event) {
  return await prisma.whatsappTemplate.findUnique({ where: { event } });
}

export async function listTemplates() {
  return await prisma.whatsappTemplate.findMany({ orderBy: { id: 'asc' } });
}

export async function upsertTemplate(event, data, opts = {}) {
  const actorUserId = opts.actorUserId;
  return await prisma.whatsappTemplate.upsert({
    where: { event },
    update: { ...data, ...(actorUserId ? { updatedByUserId: actorUserId } : {}) },
    create: { event, ...data, ...(actorUserId ? { createdByUserId: actorUserId, updatedByUserId: actorUserId } : {}) },
  });
}
