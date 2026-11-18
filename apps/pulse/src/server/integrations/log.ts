/**
 * One structured line for a sibling read that failed soft. The readers still answer with an
 * empty list (Pulse keeps working), but a broken query or a missing grant shows up in the server
 * log with the workspace, the reader and the database message, instead of reading as "no data".
 */
export interface SoftFailLine {
  readonly orgId: string | null;
  readonly reader: string;
  readonly message: string;
  readonly code: string | null;
}

export function softFailLine(orgId: string | null, reader: string, error: unknown): SoftFailLine {
  // Drizzle wraps the database error: the real message and SQLSTATE sit on `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const base = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  const message = cause && !base.includes(cause.message) ? `${cause.message} (${base.split('\n')[0]})` : base;
  const codeOf = (value: unknown): string | null => (value && typeof value === 'object' && 'code' in value && typeof (value as { code: unknown }).code === 'string' ? (value as { code: string }).code : null);
  return { orgId, reader, message: message.slice(0, 500), code: codeOf(cause) ?? codeOf(error) };
}

/** Logs a soft failure of a sibling reader. Never throws. */
export function logSoftFail(orgId: string | null, reader: string, error: unknown): void {
  try {
    console.error('[pulse] sibling read failed', softFailLine(orgId, reader, error));
  } catch {
    // Logging must never break a read.
  }
}
