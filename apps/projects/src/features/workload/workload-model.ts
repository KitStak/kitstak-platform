/**
 * Workload math, pure for tests. Each open task's effort is spread over the work days (Monday to Friday)
 * between its start and due date, then added up per person per week and compared with that
 * person's weekly capacity.
 */
import { addDaysIso, diffDays, parseIsoDate, startOfWeekIso, type IsoDate } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';

export type LoadUnit = 'tasks' | 'points' | 'hours';

/** Capacity for one unit, resolved from the project's settings. */
export interface WorkloadSettings {
  readonly unit: LoadUnit;
  /** Default weekly capacity per person, in `unit`. */
  readonly perWeek: number;
  /** Per-person overrides (user id → capacity in `unit`). */
  readonly perPerson: Readonly<Record<string, number>>;
}

export const DEFAULT_CAPACITY: Readonly<Record<LoadUnit, number>> = { tasks: 8, points: 13, hours: 40 };

export const UNIT_LABELS: Readonly<Record<LoadUnit, { one: string; many: string; short: string }>> = {
  tasks: { one: 'task', many: 'tasks', short: '' },
  points: { one: 'point', many: 'points', short: 'pts' },
  hours: { one: 'hour', many: 'hours', short: 'h' },
};

function validCapacity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1000;
}

function unitBlock(settings: Readonly<Record<string, unknown>> | null | undefined, unit: LoadUnit): Record<string, unknown> {
  const workload = settings?.workload;
  if (!workload || typeof workload !== 'object' || Array.isArray(workload)) return {};
  const capacity = (workload as Record<string, unknown>).capacity;
  if (!capacity || typeof capacity !== 'object' || Array.isArray(capacity)) return {};
  const block = (capacity as Record<string, unknown>)[unit];
  return block && typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>) : {};
}

/**
 * Capacity for `unit` from `project.settings.workload` (free-form JSON, read defensively):
 * `{ capacity: { tasks: { perWeek, perPerson: { [userId]: n } }, points: {...}, hours: {...} } }`.
 */
export function readWorkloadSettings(settings: Readonly<Record<string, unknown>> | null | undefined, unit: LoadUnit): WorkloadSettings {
  const block = unitBlock(settings, unit);
  const perWeek = validCapacity(block.perWeek) && block.perWeek > 0 ? block.perWeek : DEFAULT_CAPACITY[unit];
  const perPerson: Record<string, number> = {};
  if (block.perPerson && typeof block.perPerson === 'object' && !Array.isArray(block.perPerson)) {
    for (const [id, n] of Object.entries(block.perPerson as Record<string, unknown>)) if (validCapacity(n)) perPerson[id] = n;
  }
  return { unit, perWeek, perPerson };
}

/** New `project.settings` with one capacity change applied (other settings are kept). */
export function withCapacity(
  settings: Readonly<Record<string, unknown>> | null | undefined,
  unit: LoadUnit,
  change: { readonly perWeek?: number; readonly person?: { readonly id: string; readonly value: number | null } },
): Record<string, unknown> {
  const base = { ...(settings ?? {}) };
  const workload = base.workload && typeof base.workload === 'object' && !Array.isArray(base.workload) ? { ...(base.workload as Record<string, unknown>) } : {};
  const capacity = workload.capacity && typeof workload.capacity === 'object' && !Array.isArray(workload.capacity) ? { ...(workload.capacity as Record<string, unknown>) } : {};
  const current = readWorkloadSettings(settings, unit);
  const perPerson = { ...current.perPerson };
  if (change.person) {
    if (change.person.value === null) delete perPerson[change.person.id];
    else perPerson[change.person.id] = change.person.value;
  }
  capacity[unit] = { perWeek: change.perWeek ?? current.perWeek, perPerson };
  workload.capacity = capacity;
  base.workload = workload;
  return base;
}

export function capacityFor(settings: WorkloadSettings, userId: string): number {
  return settings.perPerson[userId] ?? settings.perWeek;
}

/** Effort of one task in `unit`. Tasks without an estimate count as zero points/hours. */
export function taskLoad(task: Pick<TaskSummary, 'estimatePoints' | 'estimateMinutes'>, unit: LoadUnit): number {
  if (unit === 'tasks') return 1;
  if (unit === 'points') return task.estimatePoints ?? 0;
  return (task.estimateMinutes ?? 0) / 60;
}

export function hasEstimate(task: Pick<TaskSummary, 'estimatePoints' | 'estimateMinutes'>, unit: LoadUnit): boolean {
  if (unit === 'tasks') return true;
  return unit === 'points' ? task.estimatePoints !== null : task.estimateMinutes !== null;
}

export function weekStarts(anchor: IsoDate, count: number): IsoDate[] {
  const first = startOfWeekIso(anchor);
  return Array.from({ length: count }, (_, i) => addDaysIso(first, i * 7));
}

function isWorkday(day: IsoDate): boolean {
  const n = parseIsoDate(day).getDay();
  return n !== 0 && n !== 6;
}

/** Share of a task per week start (shares sum to 1). Spread over work days; weekend-only spans stay whole. */
export function weekShares(start: IsoDate, end: IsoDate): Map<IsoDate, number> {
  const counts = new Map<IsoDate, number>();
  let total = 0;
  const days = Math.min(diffDays(start, end), 730);
  for (let i = 0; i <= days; i += 1) {
    const day = addDaysIso(start, i);
    if (!isWorkday(day)) continue;
    const week = startOfWeekIso(day);
    counts.set(week, (counts.get(week) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return new Map([[startOfWeekIso(end), 1]]);
  return new Map([...counts].map(([week, n]) => [week, n / total]));
}

export const EARLIER = 'earlier';
export const NO_DATE = 'nodate';
export const UNASSIGNED = 'unassigned';

export interface WorkloadCell {
  load: number;
  readonly tasks: { task: TaskSummary; share: number }[];
}

export interface WorkloadRow {
  readonly id: string;
  readonly cells: Map<string, WorkloadCell>;
  /** Tasks counted in this row whose estimate is missing (points/hours only). */
  unestimated: number;
}

/**
 * Builds rows (one per assignee + unassigned) × buckets (EARLIER, each visible week, NO_DATE).
 * EARLIER holds open work whose dates ended before the first visible week (it's late); work that
 * starts after the last visible week is left out.
 */
export function buildWorkload(tasks: readonly TaskSummary[], weeks: readonly IsoDate[], unit: LoadUnit): Map<string, WorkloadRow> {
  const rows = new Map<string, WorkloadRow>();
  const first = weeks[0];
  const last = weeks.at(-1);
  if (!first || !last) return rows;
  const visible = new Set(weeks);
  const add = (personId: string, bucket: string, task: TaskSummary, share: number) => {
    const row = rows.get(personId) ?? { id: personId, cells: new Map(), unestimated: 0 };
    rows.set(personId, row);
    const cell = row.cells.get(bucket) ?? { load: 0, tasks: [] };
    row.cells.set(bucket, cell);
    // Counting tasks: a task counts once, in the week it is due. Points and hours are split
    // across the weeks it runs so the total stays the task's estimate.
    cell.load += unit === 'tasks' ? 1 : taskLoad(task, unit) * share;
    cell.tasks.push({ task, share });
  };
  for (const task of tasks) {
    const person = task.assigneeId ?? UNASSIGNED;
    const start = task.startDate ?? task.dueDate;
    const end = task.dueDate ?? task.startDate;
    let counted = false;
    if (!start || !end) {
      add(person, NO_DATE, task, 1);
      counted = true;
    } else {
      const [a, b] = start <= end ? [start, end] : [end, start];
      if (b < first) {
        add(person, EARLIER, task, 1);
        counted = true;
      } else if (unit === 'tasks') {
        // One task, one place: its due week. Never clamp to the last visible week, or the same
        // task would land in different weeks on a phone (one week) and a desktop (six weeks).
        const dueWeek = startOfWeekIso(b);
        if (visible.has(dueWeek)) {
          add(person, dueWeek, task, 1);
          counted = true;
        }
      } else {
        let earlierShare = 0;
        for (const [week, share] of weekShares(a, b)) {
          if (visible.has(week)) {
            add(person, week, task, share);
            counted = true;
          } else if (week < first) earlierShare += share;
        }
        // Part of a long task that should already be done counts as late work this week.
        if (earlierShare > 0 && !rows.get(person)?.cells.get(first)?.tasks.some((entry) => entry.task.id === task.id)) {
          add(person, first, task, earlierShare);
          counted = true;
        }
      }
    }
    if (counted && !hasEstimate(task, unit)) {
      const row = rows.get(person);
      if (row) row.unestimated += 1;
    }
  }
  return rows;
}

export type LoadLevel = 'empty' | 'light' | 'good' | 'full' | 'over';

/** How full a week is: under 50% light, under 85% good, up to 100% full, beyond that over. */
export function loadLevel(load: number, capacity: number): LoadLevel {
  if (load <= 0.0001) return 'empty';
  if (capacity <= 0) return 'over';
  const ratio = load / capacity;
  if (ratio > 1.0001) return 'over';
  if (ratio >= 0.85) return 'full';
  if (ratio >= 0.5) return 'good';
  return 'light';
}

/** "6", "2.5", "13": at most one decimal, no trailing zero. */
export function formatLoad(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * New dates when a task is dragged from one week bucket to another. Keeps the task's length;
 * a task with no dates gets a due date on the Friday of the target week.
 */
export function shiftToWeek(
  task: Pick<TaskSummary, 'startDate' | 'dueDate'>,
  fromBucket: string,
  toWeek: IsoDate,
): { startDate?: IsoDate | null; dueDate?: IsoDate | null } {
  const friday = addDaysIso(toWeek, 4);
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  if (!start || !end) return { dueDate: friday };
  if (fromBucket === EARLIER || fromBucket === NO_DATE) {
    const length = Math.max(0, diffDays(start, end));
    const nextStart = length >= 4 ? toWeek : addDaysIso(friday, -length);
    if (!task.dueDate) return { startDate: nextStart };
    return { ...(task.startDate ? { startDate: nextStart } : {}), dueDate: addDaysIso(nextStart, length) };
  }
  const delta = diffDays(fromBucket, toWeek);
  return {
    ...(task.startDate ? { startDate: addDaysIso(task.startDate, delta) } : {}),
    ...(task.dueDate ? { dueDate: addDaysIso(task.dueDate, delta) } : {}),
  };
}
