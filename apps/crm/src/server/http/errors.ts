/**
 * Typed application errors. Services throw these; `withApi` maps them to the JSON envelope
 * `{ ok: false, error: { code, message, details? } }` with the matching HTTP status.
 * Anything that is not an `AppError` becomes a generic 500 with no internals leaked.
 */

export const ERROR_CODES = {
  BAD_REQUEST: 400,
  ORG_REQUIRED: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Extra response headers (e.g. Retry-After). */
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = options.details;
    this.headers = options.headers ?? {};
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'The request is malformed', details?: unknown) {
    super('BAD_REQUEST', message, { details });
  }
}

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
  readonly code?: string;
}

export class ValidationError extends AppError {
  constructor(issues: readonly FieldIssue[], message = 'Some fields are invalid') {
    super('VALIDATION_FAILED', message, { details: { issues } });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You need to sign in to continue') {
    super('UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that", details?: unknown) {
    super('FORBIDDEN', message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', message?: string) {
    super('NOT_FOUND', message ?? `${resource} not found`);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(allowed: readonly string[]) {
    super('METHOD_NOT_ALLOWED', 'Method not allowed', { headers: { Allow: allowed.join(', ') } });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource was modified or already exists', details?: unknown) {
    super('CONFLICT', message, { details });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super('PAYLOAD_TOO_LARGE', `Request body exceeds the ${maxBytes} byte limit`, { details: { maxBytes } });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(expected = 'application/json') {
    super('UNSUPPORTED_MEDIA_TYPE', `Expected Content-Type ${expected}`);
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    super('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.', {
      details: { retryAfterSeconds: seconds },
      headers: { 'Retry-After': String(seconds) },
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'The service is temporarily unavailable') {
    super('SERVICE_UNAVAILABLE', message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong on our side', cause?: unknown) {
    super('INTERNAL', message, { cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Postgres error codes worth mapping to client errors. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';
const PG_CHECK_VIOLATION = '23514';

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Normalize any thrown value into an `AppError` (never exposes internal messages). */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  switch (pgCode(error)) {
    case PG_UNIQUE_VIOLATION:
      return new ConflictError('An item with these values already exists');
    case PG_FOREIGN_KEY_VIOLATION:
      return new BadRequestError('A linked item does not exist');
    case PG_INVALID_TEXT_REPRESENTATION:
      return new BadRequestError('An identifier in the request is malformed');
    case PG_CHECK_VIOLATION:
      return new BadRequestError('The request violates a data constraint');
    default:
      return new InternalError(undefined, error);
  }
}

/** An org-scoped endpoint was called without `orgId` / `orgSlug` / `x-org-id`. */
export class OrgRequiredError extends AppError {
  constructor() {
    super('ORG_REQUIRED', 'An organization must be selected (x-org-id header or orgId parameter)', {
      details: { field: 'orgId' },
    });
  }
}
