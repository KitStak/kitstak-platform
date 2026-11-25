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
  /** The plan is view only: reads work, every change is refused (docs/billing/SPEC.md section 9.4). */
  'plan.read_only',
  'RATE_LIMITED',
  'LOCKED',
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
  'plan.read_only': 402,
  RATE_LIMITED: 429,
  LOCKED: 423,
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
/** A write that would change money on a closed day (docs/programs/SPEC.md 4.3.4). */
export const locked = (message: string): DomainError => new DomainError('LOCKED', message);
export const invalid = (message: string, fields?: Record<string, string>): DomainError =>
  new DomainError('VALIDATION', message, fields);

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
