/** Pure Home logic: greeting, task buckets, summary stats and the getting-started checklist. */
import { addDaysIso, startOfWeekIso, todayIso, type IsoDate } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';
import type { ProgramListItemDTO, RunDTO } from '@/lib/program-types';

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

export type GettingStartedStepId = 'project' | 'task' | 'due' | 'done' | 'search' | 'team' | 'program';

export interface GettingStartedInput {
  readonly projectCount: number;
  readonly createdTaskCount: number;
  readonly tasks: readonly TaskSummary[];
  readonly usedSearch: boolean;
  readonly peopleCount: number;
  /** Programs the org has (any status). The optional "Set up a program" step shows only at 0. */
  readonly programCount?: number;
  /** The person can create projects (and so programs). */
  readonly canCreateProgram?: boolean;
}

export interface GettingStartedStep {
  readonly id: GettingStartedStepId;
  readonly title: string;
  readonly description: string;
  readonly done: boolean;
  /** Optional steps never count toward finishing the checklist. */
  readonly optional?: boolean;
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
    ...(input.programCount === 0 && input.canCreateProgram
      ? [
          {
            id: 'program' as const,
            title: 'Set up a program',
            description: 'For kits you build again and again for one customer, with one price card.',
            done: false,
            optional: true,
          },
        ]
      : []),
  ];
}

/** Steps that count toward finishing the checklist (optional ones never do). */
export function requiredSteps(steps: readonly GettingStartedStep[]): GettingStartedStep[] {
  return steps.filter((step) => !step.optional);
}

/* Programs on Home ------------------------------------------------------------------------------ */

export type CustomerProgram = Pick<ProgramListItemDTO, 'id' | 'key' | 'name' | 'icon' | 'color' | 'today'>;

/** "Glove kits · 5 of 8 builds done today", or "Glove kits · No builds today". */
export function customerProgramText(program: Pick<ProgramListItemDTO, 'name' | 'today'>): string {
  const { builds, done } = program.today;
  if (builds === 0) return `${program.name} · No builds today`;
  return `${program.name} · ${done} of ${builds} ${builds === 1 ? 'build' : 'builds'} done today`;
}

/** Running programs per customer row: by CRM account id (the row key) or, failing that, by name. */
export function programsByCustomer(programs: readonly ProgramListItemDTO[]): ReadonlyMap<string, readonly CustomerProgram[]> {
  const map = new Map<string, CustomerProgram[]>();
  for (const program of programs) {
    if (!program.customer || program.archivedAt || (program.status !== 'active' && program.status !== 'on_hold')) continue;
    for (const key of [program.customer.id, `name:${program.customer.name.toLowerCase()}`]) {
      const list = map.get(key) ?? [];
      list.push(program);
      map.set(key, list);
    }
  }
  return map;
}

/** One run that holds the whole day: its counts would only repeat the day line above it. */
export function sameAsDay(run: Pick<RunDTO, 'builds' | 'plannedUnits' | 'builtUnits'>, builds: number, plannedUnits: string, builtUnits: string): boolean {
  return run.builds === builds && run.plannedUnits === plannedUnits && run.builtUnits === builtUnits;
}
