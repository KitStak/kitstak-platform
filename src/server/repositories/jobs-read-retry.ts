/**
 * Read-side wrapper for the M03 list APIs (critic R4: "no 5xx under concurrent load").
 *
 * Under SQLite a list read could hit SQLITE_BUSY / SQLITE_LOCKED and was retried here. Postgres
 * readers never block on writers (MVCC), so there is nothing to retry: the wrapper only awaits
 * the read. Kept so the route handlers stay unchanged.
 */

/** Always false on Postgres (kept for API compatibility). */
export function isBusyError(_error: unknown): boolean {
  return false;
}

/** Runs `read` (formerly retried SQLite busy errors). */
export async function withBusyRetry<T>(read: () => T | Promise<T>): Promise<T> {
  return await read();
}
