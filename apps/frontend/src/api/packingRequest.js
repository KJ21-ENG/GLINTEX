export function createIdempotencyKey(prefix = 'packing', cryptoObject = globalThis.crypto) {
  const randomUUID = cryptoObject?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `${prefix}-${randomUUID.call(cryptoObject)}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
