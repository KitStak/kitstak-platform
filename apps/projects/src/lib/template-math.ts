/**
 * Pure helpers over template payloads: task counts (counted the same way the project header
 * counts them: top-level tasks, subtasks separately) and start-date filling so timeline bars
 * have a real length when a template only gives due dates.
 */
import type { TemplatePayload, TemplateStatus, TemplateTask } from './template-types';

export interface TemplateTaskCounts {
  /** Top-level tasks (what the project header and Overview call "tasks"). */
  readonly tasks: number;
  /** Subtasks at any depth. */
  readonly subtasks: number;
}

export function countTemplateTaskTree(payload: Pick<TemplatePayload, 'tasks'>): TemplateTaskCounts {
  const walk = (list: readonly TemplateTask[] | undefined): number =>
    (list ?? []).reduce((sum, task) => sum + 1 + walk(task.subtasks), 0);
  const top = payload.tasks ?? [];
  return { tasks: top.length, subtasks: top.reduce((sum, task) => sum + walk(task.subtasks), 0) };
}

/**
 * "Day N" label for a template offset. The start date is Day 1, so an offset of 14 is Day 15.
 * Used by the template preview and the New project wizard so both show the same number.
 */
export function templateDayText(offset: number | undefined): string | null {
  if (offset === undefined) return null;
  if (offset <= 0) return 'Day 1';
  return `Day ${offset + 1}`;
}

/** "11 tasks + 3 subtasks", "1 task", "No tasks". */
export function describeTemplateTaskCounts(counts: TemplateTaskCounts, noun = 'tasks'): string {
  if (counts.tasks === 0) return `No ${noun}`;
  const single = noun.endsWith('s') ? noun.slice(0, -1) : noun;
  const head = `${counts.tasks} ${counts.tasks === 1 ? single : noun}`;
  if (!counts.subtasks) return head;
  return `${head} + ${counts.subtasks} ${counts.subtasks === 1 ? 'subtask' : 'subtasks'}`;
}

/**
 * Gives every top-level task that has a due offset but no start offset a start: the day after
 * the latest earlier due date that falls before its own (work runs in sequence), or day 0 for
 * the first. Milestones stay single-day. Subtasks without dates inherit the parent's range.
 */
export function withScheduledStarts(payload: TemplatePayload): TemplatePayload {
  const tasks = payload.tasks;
  if (!tasks?.length) return payload;
  const dues: number[] = [];
  const next = tasks.map((task): TemplateTask => {
    let start = task.startOffsetDays;
    const due = task.dueOffsetDays;
    if (start === undefined && due !== undefined) {
      if (task.isMilestone) start = due;
      else {
        const earlier = dues.filter((value) => value < due);
        start = earlier.length ? Math.min(due, Math.max(...earlier) + 1) : Math.min(0, due);
      }
    }
    if (due !== undefined && !task.isMilestone) dues.push(due);
    const subtasks = task.subtasks?.map((sub) =>
      sub.startOffsetDays === undefined && sub.dueOffsetDays === undefined && start !== undefined && due !== undefined
        ? { ...sub, startOffsetDays: start, dueOffsetDays: due }
        : sub,
    );
    return { ...task, ...(start !== undefined ? { startOffsetDays: start } : {}), ...(subtasks ? { subtasks } : {}) };
  });
  return { ...payload, tasks: next };
}

/**
 * The status a template task starts in: its own status, unless that is a finished one (done or
 * cancelled). A template saved from a finished project would otherwise create a project where
 * every task is already done. Undefined means "the project's default status".
 */
export function startingStatusKey(
  statuses: readonly Pick<TemplateStatus, 'key' | 'category'>[] | undefined,
  task: Pick<TemplateTask, 'statusKey'>,
): string | undefined {
  if (!task.statusKey) return undefined;
  const status = statuses?.find((s) => s.key === task.statusKey);
  if (!status) return undefined;
  return status.category === 'done' || status.category === 'cancelled' ? undefined : status.key;
}
