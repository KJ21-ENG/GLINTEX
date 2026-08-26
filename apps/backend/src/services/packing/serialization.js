import { Prisma } from '@prisma/client';

function isDecimal(value) {
  return value instanceof Prisma.Decimal;
}

export function serialize(value) {
  if (value === null || value === undefined) return value;
  if (isDecimal(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) output[key] = serialize(nested);
    return output;
  }
  return value;
}

export function toJsonSafe(value) {
  return JSON.parse(JSON.stringify(serialize(value)));
}

export function decimalString(value) {
  if (value === null || value === undefined) return null;
  return isDecimal(value) ? value.toString() : String(value);
}
