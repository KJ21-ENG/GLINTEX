export class PackingError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = 'PackingError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function badRequest(code, message, details = null) {
  return new PackingError(code, message, 400, details);
}

export function notFound(code, message, details = null) {
  return new PackingError(code, message, 404, details);
}

export function conflict(code, message, details = null) {
  return new PackingError(code, message, 409, details);
}

export function forbidden(code = 'forbidden', message = 'You do not have permission to perform this action.', details = null) {
  return new PackingError(code, message, 403, details);
}

export function stableErrorResponse(error) {
  if (error instanceof PackingError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    };
  }

  if (error?.code === 'P2002') {
    return {
      statusCode: 409,
      body: {
        error: 'duplicate_resource',
        message: 'A resource with the same unique identity already exists.',
        details: error?.meta || null,
      },
    };
  }

  console.error('Packing domain error', error);
  return {
    statusCode: 500,
    body: {
      error: 'internal_error',
      message: 'The Packing operation could not be completed.',
      details: null,
    },
  };
}

export function requireNonEmptyString(value, field, max = 500) {
  const normalized = value === null || value === undefined ? '' : String(value).trim();
  if (!normalized) throw badRequest('required_field', `${field} is required.`, { field });
  if (normalized.length > max) throw badRequest('field_too_long', `${field} is too long.`, { field, max });
  return normalized;
}

export function optionalString(value, max = 500) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function parsePositiveInt(value, field, { allowZero = false } = {}) {
  const number = Number(value);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(number) || number < min) {
    throw badRequest('invalid_integer', `${field} must be an integer greater than or equal to ${min}.`, { field });
  }
  return number;
}

export function parseNonNegativeNumber(value, field, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number <= 0)) {
    throw badRequest('invalid_number', `${field} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`, { field });
  }
  return number;
}

export function parseDate(value, field = 'effectiveAt') {
  const date = value instanceof Date ? value : new Date(value || '');
  if (!value || Number.isNaN(date.getTime())) {
    throw badRequest('invalid_date', `${field} must be a valid date.`, { field });
  }
  return date;
}
