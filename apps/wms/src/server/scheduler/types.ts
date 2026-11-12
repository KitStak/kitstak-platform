/** Scheduler contracts (BUILD_PLAN F6 `scheduler/`). */
import type { AppDb } from '@/server/api/db';
import type { Logger } from '@/server/log';

export interface SchedulerTaskContext {
  readonly db: AppDb;
  readonly now: Date;
  readonly log: Logger;
}

export interface TaskResult {
  readonly status: 'ok' | 'skipped';
  readonly message?: string;
}

/** Runs at most once per `everyMs` (checked on every 30 s tick). */
export interface IntervalSchedule {
  readonly kind: 'interval';
  readonly everyMs: number;
}

export type Schedule = IntervalSchedule;

export interface SchedulerTask {
  readonly key: string;
  readonly title: string;
  /** Owning module for 0.6 stubs; "foundation" otherwise. */
  readonly owner: string;
  /** False for a 0.6 stub: the runner never invokes it. */
  readonly configured: boolean;
  readonly schedule: Schedule;
  run(ctx: SchedulerTaskContext): TaskResult | Promise<TaskResult>;
}

export interface TaskRunState {
  readonly taskKey: string;
  readonly lastStartedAt: string | null;
  readonly lastFinishedAt: string | null;
  readonly lastStatus: 'ok' | 'skipped' | 'error' | null;
  readonly lastMessage: string | null;
  readonly runCount: number;
}

/** Builds a 0.6 stub task. */
export function createStubTask(key: string, title: string, owner: string, everyMs: number): SchedulerTask {
  return {
    key,
    title,
    owner,
    configured: false,
    schedule: { kind: 'interval', everyMs },
    run: () => ({ status: 'skipped', message: `${title} is not configured yet` }),
  };
}
