/**
 * Read-side resilience for the M03 list APIs (critic R4: "no 5xx under concurrent load").
 * A list read that hits SQLITE_BUSY / SQLITE_LOCKED (a writer holding the lock past
 * better-sqlite3's busy timeout, or a WAL checkpoint) is retried with a short back-off
 * instead of surfacing a 500 to the grid.
 */

const RETRYABLE = new Set(["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_BUSY_RECOVERY", "SQLITE_LOCKED"]);

export function isBusyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE.has(code);
}

/** Runs `read`, retrying busy errors up to `attempts` times (50 ms, 150 ms, 400 ms …). */
export async function withBusyRetry<T>(read: () => T, attempts = 4): Promise<T> {
  let delay = 50;
  for (let i = 1; ; i += 1) {
    try {
      return read();
    } catch (error) {
      if (!isBusyError(error) || i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 3, 1000);
    }
  }
}
