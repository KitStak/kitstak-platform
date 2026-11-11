/** Task handler contract: `tasks.execute()` dispatches each task to `task-handlers/<type>.ts`. */
import type * as schema from "@/server/db/schema";
import type { DomainCtx, Tx } from "../types";

export type TaskRow = typeof schema.tasks.$inferSelect;

export interface TaskExecuteInput {
  readonly targetLocationId: string;
  readonly targetLpId?: string | null;
  /** Quantity done; defaults to the remaining planned quantity. Less than remaining = short. */
  readonly qty?: number;
  /** Serial numbers scanned while picking. */
  readonly serials?: readonly string[];
  /** Pick-short: re-allocate the missing quantity elsewhere and create a resolution job. */
  readonly createResolutionJob?: boolean;
  readonly note?: string | null;
}

export interface TaskExecution {
  readonly taskId: string;
  readonly doneQty: number;
  readonly shortQty: number;
  readonly resolutionJobId?: string | null;
}

export type TaskHandler = (tx: Tx, ctx: DomainCtx, task: TaskRow, input: TaskExecuteInput) => Promise<TaskExecution>;
