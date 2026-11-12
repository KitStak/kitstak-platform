/**
 * Node.js-only half of the instrumentation hook. Kept in its own module so the
 * Edge bundle never sees the scheduler, SQLite or `process.stderr`.
 */
import { startScheduler } from './server/scheduler';

/** Stream error codes that mean "the log sink is gone", never "the app is broken". */
const IGNORED_STDIO_ERRORS: ReadonlySet<string> = new Set(['EPIPE', 'ERR_STREAM_DESTROYED']);

function hasCode(error: unknown): error is { readonly code: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}

/**
 * Keep a broken log pipe from taking the whole server down.
 *
 * Without an `error` listener, an `EPIPE` on stdout/stderr (the terminal or pipe the
 * server logs to went away) is thrown from `console.*`, becomes an uncaughtException,
 * and the error handler that then logs it hits the same broken pipe — a synchronous
 * `_fatalException` loop that pins one core and starves the event loop while the port
 * stays open (observed 2026-11-12: `/orders` appeared to hang the server for 50+ min).
 * With a listener attached, stream errors are emitted here and swallowed instead.
 */
export function guardStdioAgainstBrokenPipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: unknown) => {
      if (hasCode(error) && IGNORED_STDIO_ERRORS.has(error.code)) return;
      // Anything else is a real stream failure; rethrowing here would recurse, so keep quiet.
    });
  }
}

export async function startNodeScheduler(): Promise<void> {
  try {
    await startScheduler();
  } catch (error: unknown) {
    // Never block server start-up on the scheduler; surface the failure loudly.
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[instrumentation] scheduler failed to start: ${message}\n`);
  }
}
