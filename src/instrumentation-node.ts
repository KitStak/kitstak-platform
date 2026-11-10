/**
 * Node.js-only half of the instrumentation hook. Kept in its own module so the
 * Edge bundle never sees the scheduler, SQLite or `process.stderr`.
 */
import { startScheduler } from "./server/scheduler";

export async function startNodeScheduler(): Promise<void> {
  try {
    await startScheduler();
  } catch (error: unknown) {
    // Never block server start-up on the scheduler; surface the failure loudly.
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[instrumentation] scheduler failed to start: ${message}\n`);
  }
}
