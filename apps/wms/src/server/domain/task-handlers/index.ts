/** Task-type -> handler registry used by `tasks.execute()`. */
import type { TaskType } from "@/lib/enums";
import { executeCount } from "./count";
import { executeLoading, executePacking, executeSorting } from "./fulfilment";
import { executeKitting } from "./kitting";
import { executePicking } from "./picking";
import { executeReplenishment } from "./replenishment";
import type { TaskHandler } from "./types";

export const TASK_HANDLERS: Readonly<Record<TaskType, TaskHandler>> = {
  Picking: executePicking,
  Packing: executePacking,
  Sorting: executeSorting,
  Loading: executeLoading,
  Count: executeCount,
  Replenishment: executeReplenishment,
  Kitting: executeKitting,
};

export type { TaskExecuteInput, TaskExecution, TaskHandler, TaskRow } from "./types";
