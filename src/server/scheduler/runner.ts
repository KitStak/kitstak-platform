/**
 * In-process scheduler runner (BUILD_PLAN F6 `scheduler/runner.ts`).
 *
 * - Ticks every 30 s (timer is `unref`'d so it never keeps a process alive).
 * - Single flight on two levels: an in-process guard (a slow tick is never overlapped)
 *   and a database lease row, so only one server instance runs tasks at a time.
 * - Each configured task runs when its interval has elapsed since its last start; a
 *   failing task is recorded and logged and never stops the others.
 */
import type { AppDb } from "@/server/api/db";
import { toAppError } from "@/server/api/errors";
import { log as rootLog, type Logger } from "@/server/log";
import { acquireLease, ensureSchedulerTables, markTaskFinished, markTaskStarted, readTaskRuns, releaseLease } from "./store";
import type { SchedulerTask, TaskRunState } from "./types";

export const TICK_INTERVAL_MS = 30_000;
export const LEASE_TTL_MS = 5 * 60_000;

export interface TickResult {
  readonly at: string;
  readonly status: "ran" | "busy" | "lease-held" | "error";
  readonly ran: readonly { readonly key: string; readonly status: "ok" | "skipped" | "error"; readonly message?: string }[];
  readonly error?: string;
}

export interface SchedulerHeartbeat {
  readonly running: boolean;
  readonly ownerId: string;
  readonly startedAt: string | null;
  readonly lastTickAt: string | null;
  readonly lastTickStatus: TickResult["status"] | null;
  readonly tickIntervalMs: number;
  readonly tasks: readonly { readonly key: string; readonly configured: boolean }[];
}

export interface RunnerOptions {
  readonly getDb: () => Promise<AppDb> | AppDb;
  readonly tasks: readonly SchedulerTask[];
  readonly ownerId: string;
  readonly intervalMs?: number;
  readonly leaseTtlMs?: number;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export interface SchedulerRunner {
  start(): void;
  stop(): void;
  tick(): Promise<TickResult>;
  heartbeat(): SchedulerHeartbeat;
}

export function isTaskDue(task: SchedulerTask, state: TaskRunState | undefined, now: Date): boolean {
  if (!task.configured) return false;
  if (!state?.lastStartedAt) return true;
  return now.getTime() - new Date(state.lastStartedAt).getTime() >= task.schedule.everyMs;
}

export function createSchedulerRunner(options: RunnerOptions): SchedulerRunner {
  const now = options.now ?? (() => new Date());
  const logger = (options.log ?? rootLog).child({ component: "scheduler" });
  const intervalMs = options.intervalMs ?? TICK_INTERVAL_MS;
  const leaseTtlMs = options.leaseTtlMs ?? LEASE_TTL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<TickResult> | null = null;
  let startedAt: string | null = null;
  let lastTick: TickResult | null = null;
  let tablesReady = false;

  const runTask = async (db: AppDb, task: SchedulerTask): Promise<TickResult["ran"][number]> => {
    markTaskStarted(db, task.key, now());
    try {
      const result = await task.run({ db, now: now(), log: logger.child({ task: task.key }) });
      markTaskFinished(db, task.key, now(), result);
      return { key: task.key, status: result.status, ...(result.message ? { message: result.message } : {}) };
    } catch (error: unknown) {
      const message = toAppError(error).code === "INTERNAL" ? (error instanceof Error ? error.message : String(error)) : toAppError(error).message;
      logger.error("scheduler task failed", { task: task.key, err: error });
      markTaskFinished(db, task.key, now(), { status: "error", message });
      return { key: task.key, status: "error", message };
    }
  };

  const doTick = async (): Promise<TickResult> => {
    const at = now().toISOString();
    try {
      const db = await options.getDb();
      if (!tablesReady) {
        ensureSchedulerTables(db);
        tablesReady = true;
      }
      if (!acquireLease(db, options.ownerId, now(), leaseTtlMs)) return { at, status: "lease-held", ran: [] };
      try {
        const runs = readTaskRuns(db);
        const ran: TickResult["ran"][number][] = [];
        for (const task of options.tasks) {
          if (isTaskDue(task, runs.get(task.key), now())) ran.push(await runTask(db, task));
        }
        return { at, status: "ran", ran };
      } finally {
        releaseLease(db, options.ownerId, now());
      }
    } catch (error: unknown) {
      logger.error("scheduler tick failed", { err: error });
      return { at, status: "error", ran: [], error: error instanceof Error ? error.message : String(error) };
    }
  };

  const tick = async (): Promise<TickResult> => {
    if (inFlight) return { at: now().toISOString(), status: "busy", ran: [] };
    inFlight = doTick();
    try {
      lastTick = await inFlight;
      return lastTick;
    } finally {
      inFlight = null;
    }
  };

  return {
    start() {
      if (timer) return;
      startedAt = now().toISOString();
      timer = setInterval(() => { void tick(); }, intervalMs);
      timer.unref?.();
      void tick();
      logger.info("scheduler started", { ownerId: options.ownerId, intervalMs });
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    heartbeat: () => ({
      running: timer !== null,
      ownerId: options.ownerId,
      startedAt,
      lastTickAt: lastTick?.at ?? null,
      lastTickStatus: lastTick?.status ?? null,
      tickIntervalMs: intervalMs,
      tasks: options.tasks.map((task) => ({ key: task.key, configured: task.configured })),
    }),
  };
}
