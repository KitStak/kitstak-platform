/**
 * In-process scheduler entry point (BUILD_PLAN F6), started by `src/instrumentation.ts`
 * in the Node.js runtime.
 *
 * - `startScheduler()` is idempotent per process: the runner lives on `globalThis`, so dev
 *   hot reloads and repeated `register()` calls never start a second timer.
 * - `runSchedulerTick()` backs `POST /api/cron/tick` (guard with `verifyCronAuthorization`).
 * - `getSchedulerHeartbeat()` is read by `/api/health`.
 * - Disabled under vitest, with `SCHEDULER_ENABLED=0`, and on Vercel (`VERCEL` set), where
 *   Vercel Cron drives `/api/cron/tick` every minute instead (vercel.json).
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { getAppDb } from "@/server/api/db";
import { SCHEDULER_TASKS } from "./registry";
import { createSchedulerRunner, TICK_INTERVAL_MS, type SchedulerHeartbeat, type SchedulerRunner, type TickResult } from "./runner";
import type { SchedulerTask } from "./types";

export interface SchedulerStartResult {
  readonly started: boolean;
  readonly reason?: string;
}

declare global {
  var __kitstakScheduler: SchedulerRunner | undefined;
  /** Task list the shared runner was created with (identity changes when the registry is re-evaluated). */
  var __kitstakSchedulerTasks: readonly SchedulerTask[] | undefined;
}

function createRunner(): SchedulerRunner {
  return createSchedulerRunner({
    getDb: getAppDb,
    tasks: SCHEDULER_TASKS,
    ownerId: `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
  });
}

/**
 * The runner captures its task list at creation. After a dev hot reload replaces a task module
 * (e.g. a module's stub handler), the registry array is new: swap in a fresh runner with the new
 * list, keeping it running if the old one was. Production never re-evaluates, so this is a no-op there.
 */
function syncRunnerTasks(): void {
  const current = globalThis.__kitstakScheduler;
  if (!current || globalThis.__kitstakSchedulerTasks === SCHEDULER_TASKS) return;
  const wasRunning = current.heartbeat().running;
  current.stop();
  globalThis.__kitstakScheduler = createRunner();
  globalThis.__kitstakSchedulerTasks = SCHEDULER_TASKS;
  if (wasRunning) globalThis.__kitstakScheduler.start();
}

function sharedRunner(): SchedulerRunner {
  syncRunnerTasks();
  if (!globalThis.__kitstakScheduler) {
    globalThis.__kitstakScheduler = createRunner();
    globalThis.__kitstakSchedulerTasks = SCHEDULER_TASKS;
  }
  return globalThis.__kitstakScheduler;
}

syncRunnerTasks();

export function schedulerDisabledReason(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  if (env.VITEST) return "Scheduler disabled under test";
  if (env.SCHEDULER_ENABLED === "0") return "Scheduler disabled (SCHEDULER_ENABLED=0)";
  if (env.VERCEL) return "Scheduler disabled on Vercel (Vercel Cron calls /api/cron/tick)";
  return null;
}

export async function startScheduler(): Promise<SchedulerStartResult> {
  const disabled = schedulerDisabledReason();
  if (disabled) return { started: false, reason: disabled };
  const runner = sharedRunner();
  if (runner.heartbeat().running) return { started: true, reason: "Already running" };
  runner.start();
  return { started: true };
}

export function stopScheduler(): void {
  globalThis.__kitstakScheduler?.stop();
}

/** One tick on demand (external cron). Safe alongside the timer: ticks never overlap. */
export async function runSchedulerTick(): Promise<TickResult> {
  return sharedRunner().tick();
}

export function getSchedulerHeartbeat(): SchedulerHeartbeat {
  syncRunnerTasks();
  return globalThis.__kitstakScheduler?.heartbeat() ?? {
    running: false,
    ownerId: "",
    startedAt: null,
    lastTickAt: null,
    lastTickStatus: null,
    tickIntervalMs: TICK_INTERVAL_MS,
    tasks: SCHEDULER_TASKS.map((task) => ({ key: task.key, configured: task.configured })),
  };
}

export { verifyCronAuthorization, type CronAuthResult } from "./cron-auth";
export { SCHEDULER_TASKS } from "./registry";
export type { SchedulerHeartbeat, TickResult } from "./runner";
export type { SchedulerTask, TaskResult } from "./types";
