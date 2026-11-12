/**
 * Event-loop watchdog: samples loop delay and logs when the process stops yielding, so a
 * runaway synchronous loop shows up in the logs as `watchdog.event_loop_blocked` instead of
 * the server silently going dark. Started once per process from src/instrumentation.ts; the
 * timer is unref'd so it never keeps the process alive.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { logger } from './logger';

const SAMPLE_MS = 5_000;
/** p99 loop delay above this means requests are visibly stalling. */
const WARN_DELAY_MS = 250;
/** A sample arriving this much later than scheduled means the loop was fully blocked. */
const BLOCKED_GAP_MS = 10_000;
const NS_PER_MS = 1e6;
const BYTES_PER_MB = 1_048_576;

interface WatchdogGlobal {
  __kitstakWatchdogStarted?: boolean;
}

export function startEventLoopWatchdog(): void {
  const slot = globalThis as typeof globalThis & WatchdogGlobal;
  if (slot.__kitstakWatchdogStarted) return;
  slot.__kitstakWatchdogStarted = true;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastSample = Date.now();

  const timer = setInterval(() => {
    const now = Date.now();
    const overdueMs = now - lastSample - SAMPLE_MS;
    lastSample = now;
    const p99Ms = Math.round(histogram.percentile(99) / NS_PER_MS);
    const maxMs = Math.round(histogram.max / NS_PER_MS);
    const rssMb = Math.round(process.memoryUsage.rss() / BYTES_PER_MB);
    if (overdueMs > BLOCKED_GAP_MS) {
      logger.error('watchdog.event_loop_blocked', { blockedMs: overdueMs, p99Ms, maxMs, rssMb });
    } else if (p99Ms > WARN_DELAY_MS) {
      logger.warn('watchdog.event_loop_lag', { p99Ms, maxMs, rssMb });
    }
    histogram.reset();
  }, SAMPLE_MS);
  timer.unref?.();
}
