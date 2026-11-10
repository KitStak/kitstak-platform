/**
 * Domain error model (BUILD_PLAN F5 conventions).
 *
 * `DomainError` extends the API `AppError`, so `defineRoute` maps it to the envelope
 * and HTTP status directly. Domain code throws it with one of the 0.2 codes.
 */
import { AppError, type ErrorCode } from "@/server/api/errors";

export type DomainErrorCode = Extract<
  ErrorCode,
  "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_STATE" | "INSUFFICIENT_STOCK" | "RULE_VIOLATION" | "DUPLICATE"
>;

export class DomainError extends AppError {
  constructor(code: DomainErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(code, message, { details });
    this.name = "DomainError";
  }
}

/** Thrown by stub-handoff files (BUILD_PLAN 0.6) until the owning module replaces them. */
export class NotImplementedError extends AppError {
  readonly feature: string;

  constructor(feature: string, owner: string) {
    super("INVALID_STATE", `${feature} is not configured yet (owned by ${owner}).`, { details: { feature, owner, notConfigured: true } });
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}

export const notFound = (what: string): DomainError => new DomainError("NOT_FOUND", `${what} not found`);
export const invalidState = (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
  new DomainError("INVALID_STATE", message, details);
export const ruleViolation = (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
  new DomainError("RULE_VIOLATION", message, details);
export const insufficientStock = (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
  new DomainError("INSUFFICIENT_STOCK", message, details);
export const domainValidation = (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
  new DomainError("VALIDATION", message, details);

/** Message of an unknown thrown value, for bulk per-id results. */
export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "INTERNAL", message: error.message };
  return { code: "INTERNAL", message: "Unexpected error" };
}
