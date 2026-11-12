/**
 * Server instrumentation (Next.js convention): runs once per server instance before it accepts
 * requests. Starts the event-loop watchdog so a wedged process self-reports in the logs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startEventLoopWatchdog } = await import('./server/watchdog');
    startEventLoopWatchdog();
  }
}
