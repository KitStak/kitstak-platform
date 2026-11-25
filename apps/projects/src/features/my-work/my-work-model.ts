/** Pure My Work logic: when-groups, sorting, project grouping, drop-to-reschedule dates. */
import { addDaysIso, todayIso, type IsoDate } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';

export type WhenGroup = 'overdue' | 'today' | 'upcoming' | 'later' | 'none' | 'done';
export type MyWorkSort = 'due' | 'priority' | 'project' | 'updated' | 'title';

export const WHEN_GROUPS: readonly { readonly key: WhenGroup; readonly label: string; readonly hint: string }[] = [
  { key: 'overdue', label: 'Overdue', hint: 'Past their due date' },
  { key: 'today', label: 'Today', hint: 'Due today' },
  { key: 'upcoming', label: 'Upcoming', hint: 'Due in the next 7 days' },
  { key: 'later', label: 'Later', hint: 'Due after next week' },
  { key: 'none', label: 'No date', hint: 'Not scheduled yet' },
  { key: 'done', label: 'Done lately', hint: 'Finished in the last 7 days' },
];

export const SORT_LABELS: Readonly<Record<MyWorkSort, string>> = {
  due: 'Due date',
  priority: 'Priority',
  project: 'Project',
  updated: 'Recently updated',
  title: 'Name (A to Z)',
};

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 } as const;

export const isDone = (task: TaskSummary) => task.statusCategory === 'done' || task.statusCategory === 'cancelled';

export function whenGroup(task: TaskSummary, today: IsoDate = todayIso()): WhenGroup {
  if (isDone(task)) return 'done';
  const due = task.dueDate;
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= addDaysIso(today, 7)) return 'upcoming';
  return 'later';
}

export function compareTasks(sort: MyWorkSort, projectName: (id: string) => string = () => ''): (a: TaskSummary, b: TaskSummary) => number {
  const byDue = (a: TaskSummary, b: TaskSummary) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
  const byPriority = (a: TaskSummary, b: TaskSummary) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  const byTitle = (a: TaskSummary, b: TaskSummary) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const chain =
    (...fns: ((a: TaskSummary, b: TaskSummary) => number)[]) =>
    (a: TaskSummary, b: TaskSummary) => {
      for (const fn of fns) {
        const result = fn(a, b);
        if (result) return result;
      }
      return a.key.localeCompare(b.key, undefined, { numeric: true });
    };
  switch (sort) {
    case 'priority':
      return chain(byPriority, byDue);
    case 'project':
      return chain((a, b) => projectName(a.projectId).localeCompare(projectName(b.projectId)), byDue, byPriority);
    case 'updated':
      return chain((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'title':
      return chain(byTitle);
    default:
      return chain(byDue, byPriority);
  }
}

export interface TaskGroup<K extends string = string> {
  readonly key: K;
  readonly label: string;
  readonly tasks: readonly TaskSummary[];
}

/**
 * Groups by when the task is due. `keepIds` (tasks finished during this visit) stay in the group
 * they were in, struck through, instead of jumping to Done.
 */
export function groupByWhen(
  tasks: readonly TaskSummary[],
  options: { readonly today?: IsoDate; readonly sort?: MyWorkSort; readonly showDone?: boolean; readonly keepIds?: ReadonlySet<string>; readonly projectName?: (id: string) => string } = {},
): TaskGroup<WhenGroup>[] {
  const today = options.today ?? todayIso();
  const compare = compareTasks(options.sort ?? 'due', options.projectName);
  const keep = options.keepIds ?? new Set<string>();
  const buckets = new Map<WhenGroup, TaskSummary[]>();
  for (const task of tasks) {
    let group = whenGroup(task, today);
    if (group === 'done' && keep.has(task.id)) group = whenGroup({ ...task, statusCategory: 'todo' }, today);
    else if (group === 'done' && !options.showDone) continue;
    const list = buckets.get(group) ?? [];
    list.push(task);
    buckets.set(group, list);
  }
  return WHEN_GROUPS.filter((g) => buckets.has(g.key)).map((g) => ({
    key: g.key,
    label: g.label,
    tasks: [...(buckets.get(g.key) ?? [])].sort(g.key === 'done' ? (a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') : compare),
  }));
}

/** Groups by project (alphabetical), each sorted with `sort`. */
export function groupByProject(
  tasks: readonly TaskSummary[],
  projectName: (id: string) => string,
  options: { readonly sort?: MyWorkSort; readonly showDone?: boolean; readonly keepIds?: ReadonlySet<string> } = {},
): TaskGroup[] {
  const compare = compareTasks(options.sort ?? 'due', projectName);
  const keep = options.keepIds ?? new Set<string>();
  const buckets = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (isDone(task) && !options.showDone && !keep.has(task.id)) continue;
    const list = buckets.get(task.projectId) ?? [];
    list.push(task);
    buckets.set(task.projectId, list);
  }
  return [...buckets.entries()]
    .map(([projectId, list]) => ({ key: projectId, label: projectName(projectId) || 'Project', tasks: [...list].sort(compare) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The due date a task gets when dropped on a when-group (undefined = not a drop target). */
export function dueDateForDrop(group: WhenGroup, task: TaskSummary, today: IsoDate = todayIso()): IsoDate | null | undefined {
  switch (group) {
    case 'today':
      return today;
    case 'upcoming':
      return task.dueDate && task.dueDate > today && task.dueDate <= addDaysIso(today, 7) ? task.dueDate : addDaysIso(today, 1);
    case 'later':
      return task.dueDate && task.dueDate > addDaysIso(today, 7) ? task.dueDate : addDaysIso(today, 14);
    case 'none':
      return null;
    default:
      return undefined;
  }
}

/** Focus mode queue: overdue first, then today, most urgent first. */
export function focusQueue(tasks: readonly TaskSummary[], today: IsoDate = todayIso()): TaskSummary[] {
  return tasks
    .filter((task) => !isDone(task) && task.dueDate !== null && task.dueDate <= today)
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
}

/** Case-insensitive filter on title, key and project name. */
export function matchesText(task: TaskSummary, text: string, projectName: (id: string) => string = () => ''): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || task.key.toLowerCase().includes(q) || projectName(task.projectId).toLowerCase().includes(q);
}

/* Builds (docs/programs/SPEC.md 5.17) ------------------------------------------------------------ */

export interface BuildRunGroup {
  /** `${programKey}|${runId}` */
  readonly key: string;
  readonly programKey: string;
  readonly runId: string;
  readonly date: IsoDate;
  readonly overdue: boolean;
  readonly tasks: readonly TaskSummary[];
}

/** Open builds dated today or earlier, grouped by program and run: today first, then older days newest first. */
export function groupBuildsByRun(builds: readonly TaskSummary[], today: IsoDate): BuildRunGroup[] {
  const groups = new Map<string, { programKey: string; runId: string; date: IsoDate; tasks: TaskSummary[] }>();
  for (const task of builds) {
    const build = task.build as (TaskSummary['build'] & { readonly runId?: string }) | null | undefined;
    if (task.kind !== 'build' || !build || isDone(task) || build.buildDate > today) continue;
    const runId = build.runId ?? `run:manual:${build.buildDate}`;
    const key = `${task.projectKey}|${runId}`;
    const group = groups.get(key) ?? { programKey: task.projectKey, runId, date: build.buildDate, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...group, overdue: group.date < today, tasks: [...group.tasks].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })) }))
    .sort((a, b) => (a.date === b.date ? a.programKey.localeCompare(b.programKey) : b.date.localeCompare(a.date)));
}
