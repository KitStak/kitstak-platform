/**
 * API error model (BUILD_PLAN 0.2).
 *
 * Throw `AppError` (or a subclass such as F5's `DomainError`) anywhere below a
 * `defineRoute` handler; it is mapped to the envelope and HTTP status here.
 * Any thrown object carrying a known string `code` is mapped too (duck typing), so
 * domain code does not have to import this module.
 */
import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'INVALID_STATE',
  'INSUFFICIENT_STOCK',
  'RULE_VIOLATION',
  'DUPLICATE',
  'RATE_LIMITED',
  // Another write held the app write lock for too long; safe to retry.
  'BUSY',
  // Platform codes (not domain): authentication, CSRF and unexpected failures.
  'UNAUTHENTICATED',
  'CSRF',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_STATE: 409,
  INSUFFICIENT_STOCK: 409,
  RULE_VIOLATION: 422,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
  BUSY: 503,
  UNAUTHENTICATED: 401,
  CSRF: 403,
  INTERNAL: 500,
};

/** Field path (dot-joined) -> messages. */
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface AppErrorOptions {
  readonly fieldErrors?: FieldErrors;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Extra response headers, e.g. `Retry-After`. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export const notFoundError = (what = 'Record'): AppError => new AppError('NOT_FOUND', `${what} not found`);
export const forbiddenError = (message = 'You do not have permission to perform this action'): AppError =>
  new AppError('FORBIDDEN', message);
export const unauthenticatedError = (message = 'Authentication required'): AppError =>
  new AppError('UNAUTHENTICATED', message);
export const conflictError = (message = 'This record changed since you opened it — Reload'): AppError =>
  new AppError('CONFLICT', message);
export const validationError = (message: string, fieldErrors?: FieldErrors): AppError =>
  new AppError('VALIDATION', message, { fieldErrors });
export const rateLimitedError = (
  retryAfterSeconds: number,
  message = 'Too many requests. Please try again shortly.',
): AppError =>
  new AppError('RATE_LIMITED', message, {
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    details: { retryAfterSeconds },
  });

/** Converts zod issues into `fieldErrors` + a short summary message. */
const DEFAULT_ZOD_PREFIX = 'Invalid request';

export function fromZodError(error: z.ZodError, prefix = DEFAULT_ZOD_PREFIX): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  // User-facing message: never the raw field key (docs/requests/facility-config.md REQ-1).
  // One failing field -> its message; several -> "Fix the highlighted fields". A custom prefix
  // (e.g. "Record 2 is invalid") is kept in front; field details stay in `fieldErrors`.
  const first = error.issues[0];
  const detail = !first
    ? ''
    : Object.keys(fieldErrors).length > 1
      ? 'Fix the highlighted fields'
      : first.message;
  const message = !detail ? prefix : prefix === DEFAULT_ZOD_PREFIX ? detail : `${prefix}: ${detail}`;
  return new AppError('VALIDATION', message, { fieldErrors });
}

/**
 * Normalises anything thrown into an `AppError`. Unknown errors become INTERNAL with a
 * generic message (the original is kept as `cause` for server logs only).
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) return fromZodError(error);
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      fieldErrors?: unknown;
      details?: unknown;
    };
    if (isErrorCode(candidate.code) && typeof candidate.message === 'string') {
      return new AppError(candidate.code, candidate.message, {
        cause: error,
        details: isPlainRecord(candidate.details) ? candidate.details : undefined,
        fieldErrors: isPlainRecord(candidate.fieldErrors)
          ? (candidate.fieldErrors as FieldErrors)
          : undefined,
      });
    }
  }
  return new AppError('INTERNAL', 'Internal server error', { cause: error });
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
