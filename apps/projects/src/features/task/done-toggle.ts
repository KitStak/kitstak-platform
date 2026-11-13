'use client';
/**
 * One way to finish or reopen a task from anywhere (List, Board, drawer, task page, keyboard):
 * the optimistic save starts at once and the toast with Undo shows in the same frame, instead
 * of after the server answers. If the save fails, the toast goes away (the mutation already
 * rolled back and explained why). Undo (button or Ctrl/Cmd+Z) puts the previous status back.
 *
 *   toggleDoneWithUndo({ taskKey: task.key, closing: true, target: done.id, previous: task.statusId,
 *     save: (statusId) => ops.updateTask(task.id, { statusId }) });
 */
import { toast } from '@/components/ui';

export interface DoneToggleInput {
  readonly taskKey: string;
  /** True when the task is being marked done, false when it is being reopened. */
  readonly closing: boolean;
  readonly target: string;
  readonly previous: string;
  /** Saves a status; resolves falsy when it failed (and already showed an error). */
  readonly save: (statusId: string) => Promise<unknown>;
}

export function toggleDoneWithUndo({ taskKey, closing, target, previous, save }: DoneToggleInput): Promise<boolean> {
  const pending = save(target);
  const id = toast.undo(closing ? `Marked ${taskKey} done` : `Reopened ${taskKey}`, {
    onUndo: async () => {
      // Let the first save land before reverting, so the two writes cannot cross.
      await pending;
      await save(previous);
    },
  });
  return pending.then((result) => {
    if (result) return true;
    toast.forgetUndo(id);
    return false;
  });
}
