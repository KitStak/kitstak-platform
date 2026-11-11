/**
 * Channel order-import failure classification (M12). PURE.
 *
 * Operators must never see raw SQL or driver text ("UNIQUE constraint failed: …") in Missing
 * Orders, Channel History or Recent Errors. `classifyImportError` turns any thrown value into a
 * catalog code plus a plain-language message, and says whether the runtime should retry the
 * import straight away (a shipment-order code collision is transient: the next attempt draws
 * the next free code).
 */

/** Catalog code for a shipment-order code collision (see REQ-AI-R5-2 for the catalog entry). */
export const ORDER_CODE_CONFLICT = "Shipment order code already in use";
export const UNEXPECTED = "Unexpected Error";

export interface ClassifiedImportError {
  readonly code: string;
  readonly message: string;
  /** True when retrying the same order immediately is expected to succeed. */
  readonly retryable: boolean;
}

const DB_TEXT = /(constraint failed|SQLITE_[A-Z_]+|no such (table|column)|syntax error|database is locked|FOREIGN KEY|NOT NULL constraint|CHECK constraint|SqliteError|Failed query|DrizzleQueryError|duplicate key value|violates (unique|foreign key|not-null|check) constraint|current transaction is aborted|(relation|column) "[^"]+" does not exist)/i;

/** True when a message carries database/driver internals that must not reach the UI. */
export function isInternalDbText(message: string): boolean {
  return DB_TEXT.test(message);
}

interface ErrorLike { readonly code?: unknown; readonly message?: unknown; readonly name?: unknown; readonly cause?: unknown; readonly constraint_name?: unknown; readonly constraint?: unknown }

/** The Postgres driver error behind a drizzle "Failed query" wrapper (or the error itself). */
function driverErrorOf(e: ErrorLike): ErrorLike {
  const cause = e.cause && typeof e.cause === "object" ? (e.cause as ErrorLike) : null;
  return cause && typeof cause.message === "string" ? cause : e;
}

export function classifyImportError(error: unknown): ClassifiedImportError {
  const e = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const driver = driverErrorOf(e);
  const own = typeof e.message === "string" ? e.message : typeof error === "string" ? error : "";
  const raw = driver !== e && typeof driver.message === "string" ? `${own}\n${driver.message}` : own;
  const appCode = typeof e.code === "string" ? e.code : "";
  const constraint = typeof driver.constraint_name === "string" ? driver.constraint_name : typeof driver.constraint === "string" ? driver.constraint : "";
  const pgOrderCodeClash = driver.code === "23505" && (constraint === "orders_code_idx" || /"orders_code_idx"/.test(raw));
  if (pgOrderCodeClash || /UNIQUE constraint failed:\s*shipment_orders\.code/i.test(raw) || (appCode === "DUPLICATE" && /order code/i.test(raw))) {
    return {
      code: ORDER_CODE_CONFLICT,
      message: "KitStak could not assign a free shipment order code to this order. It was retried automatically; if it keeps failing, check Settings → Data Setup → number sequences.",
      retryable: true,
    };
  }
  if (/database is locked|SQLITE_BUSY|deadlock detected|could not serialize access|canceling statement due to (lock|statement) timeout/i.test(raw)) {
    return { code: UNEXPECTED, message: "The warehouse database was busy, so the order was not saved. It will be downloaded again on the next run.", retryable: true };
  }
  if (isInternalDbText(raw)) {
    return { code: UNEXPECTED, message: "The order could not be saved because it conflicts with existing data. Retry the download; if it persists, send the payload to support.", retryable: false };
  }
  if (appCode === "VALIDATION" || appCode === "RULE_VIOLATION" || appCode === "INVALID_STATE" || appCode === "DUPLICATE" || appCode === "NOT_FOUND") {
    return { code: UNEXPECTED, message: raw || "The order was rejected by KitStak validation.", retryable: false };
  }
  return { code: UNEXPECTED, message: raw && raw.length <= 300 ? raw : "Something went wrong while saving the order.", retryable: false };
}

/** Minimum identical failures in one run before an alert is raised. */
export const REPEATED_FAILURE_THRESHOLD = 3;

/** Codes that failed at least `threshold` times in one run (alert candidates), most frequent first. */
export function repeatedFailures(codes: readonly string[], threshold = REPEATED_FAILURE_THRESHOLD): readonly { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= threshold).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
}
