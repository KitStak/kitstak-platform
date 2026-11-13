/** Pure Home logic: greeting, task buckets, summary stats and the getting-started checklist. */
import { addDaysIso, startOfWeekIso, todayIso, type IsoDate } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';

/** The shared KitStak greeting (same boundaries as CRM). */
export { greetingFor } from '@kitstak/ui/text';

export const isOpenTask = (task: TaskSummary) => task.statusCategory !== 'done' && task.statusCategory !== 'cancelled';

export interface HomeBuckets {
  readonly overdue: readonly TaskSummary[];
  readonly today: readonly TaskSummary[];
  readonly week: readonly TaskSummary[];
}

export interface HomeStats {
  readonly open: number;
  readonly dueToday: number;
  readonly overdue: number;
  readonly doneThisWeek: number;
}

const byDueThenPriority = (a: TaskSummary, b: TaskSummary) => {
  const due = (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
  if (due) return due;
  const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 } as const;
  return order[a.priority] - order[b.priority];
};

/**
 * Today / Overdue / This week (the next 7 days after today). Tasks finished in `keepDoneIds`
 * (completed during this visit) stay in their bucket so the check-off is visible.
 */
export function homeBuckets(tasks: readonly TaskSummary[], today: IsoDate = todayIso(), keepDoneIds: ReadonlySet<string> = new Set()): HomeBuckets {
  const weekEnd = addDaysIso(today, 7);
  const visible = tasks.filter((task) => isOpenTask(task) || keepDoneIds.has(task.id));
  return {
    overdue: visible.filter((t) => t.dueDate !== null && t.dueDate < today).sort(byDueThenPriority),
    today: visible.filter((t) => t.dueDate === today).sort(byDueThenPriority),
    week: visible.filter((t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= weekEnd).sort(byDueThenPriority),
  };
}

export function homeStats(tasks: readonly TaskSummary[], today: IsoDate = todayIso()): HomeStats {
  const weekStart = startOfWeekIso(today);
  const open = tasks.filter(isOpenTask);
  return {
    open: open.length,
    dueToday: open.filter((t) => t.dueDate === today).length,
    overdue: open.filter((t) => t.dueDate !== null && t.dueDate < today).length,
    doneThisWeek: tasks.filter((t) => t.statusCategory === 'done' && t.completedAt && t.completedAt.slice(0, 10) >= weekStart).length,
  };
}

/** One sentence under the greeting. */
export function summarySentence(stats: HomeStats): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (stats.overdue && stats.dueToday) return `You have ${plural(stats.overdue, 'overdue task')} and ${stats.dueToday} due today.`;
  if (stats.overdue) return `You have ${plural(stats.overdue, 'overdue task')}. Let’s get ${stats.overdue === 1 ? 'it' : 'them'} done.`;
  if (stats.dueToday) return `You have ${plural(stats.dueToday, 'task')} due today.`;
  if (stats.open) return `Nothing is due today. You have ${plural(stats.open, 'open task')} in total.`;
  return 'Your plate is clear. Add a task or start a project to get going.';
}

export type GettingStartedStepId = 'project' | 'task' | 'due' | 'done' | 'search' | 'team';

export interface GettingStartedInput {
  readonly projectCount: number;
  readonly createdTaskCount: number;
  readonly tasks: readonly TaskSummary[];
  readonly usedSearch: boolean;
  readonly peopleCount: number;
}

export interface GettingStartedStep {
  readonly id: GettingStartedStepId;
  readonly title: string;
  readonly description: string;
  readonly done: boolean;
}

export function gettingStartedSteps(input: GettingStartedInput): GettingStartedStep[] {
  return [
    {
      id: 'project',
      title: 'Start a project',
      description: 'Pick a ready-made template or start from scratch.',
      done: input.projectCount > 0,
    },
    {
      id: 'task',
      title: 'Add your first task',
      description: 'Press C anywhere. Try “Order labels tomorrow !high”.',
      done: input.createdTaskCount > 0,
    },
    {
      id: 'due',
      title: 'Give a task a due date',
      description: 'Due dates put work on your Home and My work lists.',
      done: input.tasks.some((task) => task.dueDate !== null),
    },
    {
      id: 'done',
      title: 'Check off a task',
      description: 'Click the circle next to any task to mark it done.',
      done: input.tasks.some((task) => task.statusCategory === 'done'),
    },
    {
      id: 'search',
      title: 'Find anything fast',
      description: 'Press Ctrl K (⌘K on Mac) to search and jump around.',
      done: input.usedSearch,
    },
    {
      id: 'team',
      title: 'Bring your team',
      description: 'Invite teammates from the KitStak Portal so you can assign work.',
      done: input.peopleCount > 1,
    },
  ];
}
