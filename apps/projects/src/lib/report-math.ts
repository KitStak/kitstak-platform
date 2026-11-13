/**
 * Pure report math for Dashboards (portfolio + per-project reports). The domain layer
 * (`src/server/domain/reports.ts`) loads `ReportTaskRow`s and calls `buildReport`; everything
 * here is deterministic for a given `today`, so it is unit tested in report-math.test.ts.
 *
 * Plain-language definitions used in the UI:
 * - Scope: tasks that exist (not cancelled) on a day.          - Done: tasks finished by that day.
 * - Velocity: tasks (and points) finished per Monday-start week.
 * - Cycle time: days from first "in progress" (or creation when it never was) to done.
 */
import type { StatusCategory } from './constants';
import { addDaysIso, diffDays, parseIsoDate, startOfWeekIso, toIsoDate, type IsoDate } from './dates';

export interface ReportTaskRow {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly title: string;
  readonly statusId: string;
  readonly category: StatusCategory;
  readonly assigneeId: string | null;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** ISO timestamp when the task reached done/cancelled (null while open). */
  readonly completedAt: string | null;
  /** ISO timestamp of the first move into an in-progress status (null if never). */
  readonly startedAt: string | null;
  readonly dueDate: IsoDate | null;
  readonly points: number | null;
}

export interface ReportStatusSlice {
  /** Status id (project report) or category (portfolio report). */
  readonly id: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly color: string;
  readonly count: number;
}

export interface ReportBurnPoint {
  readonly date: IsoDate;
  /** Tasks that exist by this day (null for future days). */
  readonly scope: number | null;
  /** Tasks finished by this day (null for future days). */
  readonly done: number | null;
  /** Scope minus done (null for future days). */
  readonly remaining: number | null;
  /** Straight-line plan from the starting scope to zero on the due date (null without a due date). */
  readonly ideal: number | null;
}

export interface ReportWeek {
  /** Monday of the week. */
  readonly weekStart: IsoDate;
  readonly completed: number;
  readonly points: number;
  readonly created: number;
  /** Median cycle time (days) of the tasks finished that week; null when none. */
  readonly medianCycleDays: number | null;
}

export interface ReportPersonRow {
  readonly assigneeId: string | null;
  readonly open: number;
  readonly inProgress: number;
  readonly overdue: number;
  readonly dueThisWeek: number;
  readonly points: number;
}

export interface ReportCompletedTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly assigneeId: string | null;
  readonly completedAt: string;
}

export interface ReportTotals {
  readonly total: number;
  readonly open: number;
  readonly inProgress: number;
  readonly done: number;
  readonly overdue: number;
  readonly unassigned: number;
  readonly completedThisWeek: number;
  readonly completedLastWeek: number;
  readonly createdThisWeek: number;
  /** Median days to finish over the report window (null when nothing finished). */
  readonly medianCycleDays: number | null;
  /** Average tasks finished per week over the full weeks of the window. */
  readonly averageVelocity: number;
}

export interface ReportData {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly today: IsoDate;
  readonly dueDate: IsoDate | null;
  readonly totals: ReportTotals;
  readonly statusDistribution: readonly ReportStatusSlice[];
  readonly burn: readonly ReportBurnPoint[];
  readonly weeks: readonly ReportWeek[];
  readonly people: readonly ReportPersonRow[];
  readonly completedThisWeek: readonly ReportCompletedTask[];
}

export interface StatusMeta {
  readonly id: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly color: string;
  readonly position?: string;
}

/** Category slices for portfolio reports (statuses differ per project). */
export const CATEGORY_SLICES: readonly StatusMeta[] = [
  { id: 'todo', name: 'To do', category: 'todo', color: 'gray' },
  { id: 'in_progress', name: 'In progress', category: 'in_progress', color: 'blue' },
  { id: 'done', name: 'Done', category: 'done', color: 'green' },
  { id: 'cancelled', name: 'Cancelled', category: 'cancelled', color: 'brown' },
];

const isClosed = (category: StatusCategory) => category === 'done' || category === 'cancelled';

/** Local calendar day of an ISO timestamp. */
export function dayOf(timestamp: string): IsoDate {
  return toIsoDate(new Date(timestamp));
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return Math.round(value * 10) / 10;
}

/** Days (one decimal, at least 0) between start and finish of a finished task. */
export function cycleDays(row: Pick<ReportTaskRow, 'createdAt' | 'startedAt' | 'completedAt'>): number | null {
  if (!row.completedAt) return null;
  const start = new Date(row.startedAt ?? row.createdAt).getTime();
  const end = new Date(row.completedAt).getTime();
  return Math.max(0, Math.round(((end - start) / 86_400_000) * 10) / 10);
}

/** Inclusive list of days from `from` to `to`, sampled every `step` days (always includes `to`). */
export function dayRange(from: IsoDate, to: IsoDate, step = 1): IsoDate[] {
  const days: IsoDate[] = [];
  if (from > to) return [to];
  for (let day = from; day <= to; day = addDaysIso(day, step)) days.push(day);
  if (days[days.length - 1] !== to) days.push(to);
  return days;
}

export interface BuildReportInput {
  readonly rows: readonly ReportTaskRow[];
  readonly statuses: readonly StatusMeta[];
  /** Group the donut by category (portfolio) instead of by status id (project). */
  readonly byCategory: boolean;
  readonly today: IsoDate;
  /** First day of the burn chart (clamped to at most `maxDays` before `today`). */
  readonly from: IsoDate;
  /** Project due date: extends the chart and anchors the ideal line. */
  readonly dueDate: IsoDate | null;
  /** Weeks of velocity / cycle-time history (default 8). */
  readonly weeks?: number;
  readonly maxDays?: number;
}

export function buildReport(input: BuildReportInput): ReportData {
  const { rows, today } = input;
  const weeksBack = Math.max(1, input.weeks ?? 8);
  const maxDays = input.maxDays ?? 182;
  const earliest = addDaysIso(today, -maxDays);
  let from = input.from > today ? today : input.from;
  if (from < earliest) from = earliest;
  const dueDate = input.dueDate && input.dueDate >= from ? input.dueDate : null;
  const to = dueDate && dueDate > today ? dueDate : today;
  const thisWeek = startOfWeekIso(today);
  const lastWeek = addDaysIso(thisWeek, -7);

  const live = rows.filter((row) => row.category !== 'cancelled');

  // --- totals
  let open = 0;
  let inProgress = 0;
  let done = 0;
  let overdue = 0;
  let unassigned = 0;
  let completedThisWeek = 0;
  let completedLastWeek = 0;
  let createdThisWeek = 0;
  for (const row of live) {
    const closed = isClosed(row.category);
    if (closed) done += 1;
    else {
      open += 1;
      if (row.category === 'in_progress') inProgress += 1;
      if (row.dueDate && row.dueDate < today) overdue += 1;
      if (!row.assigneeId) unassigned += 1;
    }
    if (row.completedAt && row.category === 'done') {
      const day = dayOf(row.completedAt);
      if (day >= thisWeek && day <= today) completedThisWeek += 1;
      else if (day >= lastWeek && day < thisWeek) completedLastWeek += 1;
    }
    if (dayOf(row.createdAt) >= thisWeek) createdThisWeek += 1;
  }

  // --- status distribution
  const slices = new Map<string, ReportStatusSlice>();
  const metas = input.byCategory ? CATEGORY_SLICES : input.statuses;
  for (const meta of metas) slices.set(meta.id, { id: meta.id, name: meta.name, category: meta.category, color: meta.color, count: 0 });
  for (const row of rows) {
    const id = input.byCategory ? row.category : row.statusId;
    const slice = slices.get(id);
    if (slice) slices.set(id, { ...slice, count: slice.count + 1 });
  }
  const statusDistribution = [...slices.values()];

  // --- burn up / down (daily up to ~10 weeks, then every few days to stay light)
  const span = diffDays(from, to);
  const step = span > 120 ? 7 : span > 60 ? 3 : 1;
  const createdDays = live.map((row) => dayOf(row.createdAt)).sort();
  const doneDays = live
    .filter((row) => row.category === 'done' && row.completedAt)
    .map((row) => dayOf(row.completedAt as string))
    .sort();
  const countUpTo = (sorted: readonly IsoDate[], day: IsoDate) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] as IsoDate) <= day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Plan line starts at the open scope on day one; when work was added later, at today's scope.
  const startScope = countUpTo(createdDays, from) - countUpTo(doneDays, from);
  const baseline = startScope > 0 ? startScope : live.length;
  const idealSpan = dueDate ? Math.max(1, diffDays(from, dueDate)) : 0;
  const burn: ReportBurnPoint[] = dayRange(from, to, step).map((day) => {
    const future = day > today;
    const scope = future ? null : countUpTo(createdDays, day);
    const finished = future ? null : countUpTo(doneDays, day);
    const ideal = dueDate ? Math.max(0, Math.round(baseline * (1 - Math.min(1, diffDays(from, day) / idealSpan)) * 10) / 10) : null;
    return { date: day, scope, done: finished, remaining: scope === null || finished === null ? null : scope - finished, ideal };
  });

  // --- weekly velocity + cycle time
  const weeks: ReportWeek[] = [];
  for (let index = weeksBack - 1; index >= 0; index -= 1) {
    const weekStart = addDaysIso(thisWeek, -7 * index);
    const weekEnd = addDaysIso(weekStart, 6);
    const finished = live.filter((row) => {
      if (row.category !== 'done' || !row.completedAt) return false;
      const day = dayOf(row.completedAt);
      return day >= weekStart && day <= weekEnd;
    });
    const created = live.filter((row) => {
      const day = dayOf(row.createdAt);
      return day >= weekStart && day <= weekEnd;
    }).length;
    weeks.push({
      weekStart,
      completed: finished.length,
      points: finished.reduce((sum, row) => sum + (row.points ?? 0), 0),
      created,
      medianCycleDays: median(finished.map((row) => cycleDays(row)).filter((value): value is number => value !== null)),
    });
  }
  const fullWeeks = weeks.slice(0, -1);
  const averageVelocity = fullWeeks.length ? Math.round((fullWeeks.reduce((sum, week) => sum + week.completed, 0) / fullWeeks.length) * 10) / 10 : 0;
  const windowStart = weeks[0]?.weekStart ?? thisWeek;
  const medianCycle = median(
    live
      .filter((row) => row.category === 'done' && row.completedAt && dayOf(row.completedAt) >= windowStart)
      .map((row) => cycleDays(row))
      .filter((value): value is number => value !== null),
  );

  // --- people (open work per assignee)
  const endOfWeek = addDaysIso(thisWeek, 6);
  const people = new Map<string, ReportPersonRow>();
  for (const row of live) {
    if (isClosed(row.category)) continue;
    const key = row.assigneeId ?? '';
    const current = people.get(key) ?? { assigneeId: row.assigneeId, open: 0, inProgress: 0, overdue: 0, dueThisWeek: 0, points: 0 };
    people.set(key, {
      ...current,
      open: current.open + 1,
      inProgress: current.inProgress + (row.category === 'in_progress' ? 1 : 0),
      overdue: current.overdue + (row.dueDate && row.dueDate < today ? 1 : 0),
      dueThisWeek: current.dueThisWeek + (row.dueDate && row.dueDate >= today && row.dueDate <= endOfWeek ? 1 : 0),
      points: current.points + (row.points ?? 0),
    });
  }
  const peopleRows = [...people.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue);

  const completedList: ReportCompletedTask[] = live
    .filter((row) => row.category === 'done' && row.completedAt && dayOf(row.completedAt) >= thisWeek)
    .sort((a, b) => (b.completedAt as string).localeCompare(a.completedAt as string))
    .slice(0, 25)
    .map((row) => ({ id: row.id, key: row.key, title: row.title, assigneeId: row.assigneeId, completedAt: row.completedAt as string }));

  return {
    from,
    to,
    today,
    dueDate,
    totals: {
      total: live.length,
      open,
      inProgress,
      done,
      overdue,
      unassigned,
      completedThisWeek,
      completedLastWeek,
      createdThisWeek,
      medianCycleDays: medianCycle,
      averageVelocity,
    },
    statusDistribution,
    burn,
    weeks,
    people: peopleRows,
    completedThisWeek: completedList,
  };
}

/** "Nov 3" style label for chart axes. */
export function shortDate(value: IsoDate): string {
  return parseIsoDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Round a max up to a friendly axis bound (1, 2, 2.5, 5 × 10^n). Same rule as CRM charts. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * A ceiling just above `value` for line charts (burn-up): 105 gives 120, not 200, so the lines use
 * the full height. Halves stay readable tick labels (60, 120).
 */
export function tightNiceMax(value: number): number {
  if (value <= 0) return 1;
  if (value <= 4) return Math.ceil(value);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => normalized <= candidate) ?? 10;
  return Math.round(step * magnitude * 100) / 100;
}
