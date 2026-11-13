/**
 * Typed domain errors. Domain functions throw these; server actions convert them to an
 * `ActionResult` failure (src/server/actions/_action.ts) and route handlers to a JSON envelope
 * (src/server/http/api.ts). Messages are plain language and safe to show to the user.
 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION',
  'NOT_ENTITLED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  NOT_ENTITLED: 402,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Field-level messages for forms (`{ name: 'Give the project a name.' }`). */
  readonly fields?: Readonly<Record<string, string>>;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
  }
}

export const notFound = (what = 'That item'): DomainError =>
  new DomainError('NOT_FOUND', `${what} doesn't exist or you no longer have access to it.`);
export const forbidden = (message = "You don't have permission to do that."): DomainError =>
  new DomainError('FORBIDDEN', message);
export const conflict = (message: string): DomainError => new DomainError('CONFLICT', message);
export const invalid = (message: string, fields?: Record<string, string>): DomainError =>
  new DomainError('VALIDATION', message, fields);

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
