/**
 * Timeline (Gantt) math, kept pure so it can be unit tested: the visible date range, day ↔ pixel
 * mapping, the two-tier header, drag results, dependency arrow routing, conflicts and the
 * critical path.
 */
import { addDaysIso, diffDays, parseIsoDate, startOfWeekIso, type IsoDate } from '@/lib/dates';

export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter';
export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['day', 'week', 'month', 'quarter'];

export const PX_PER_DAY: Readonly<Record<TimelineZoom, number>> = { day: 40, week: 20, month: 6, quarter: 2.5 };

export const ZOOM_LABELS: Readonly<Record<TimelineZoom, string>> = { day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters' };

/** How long a bar is when a task is dropped from the "No dates" tray, per zoom level. */
export const DROP_LENGTH_DAYS: Readonly<Record<TimelineZoom, number>> = { day: 3, week: 5, month: 14, quarter: 30 };

export interface Span {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

export interface TimelineRange extends Span {
  readonly days: number;
}

/** A task's bar: start → due. A task with only one of the two dates is a one-day bar. */
export function taskSpan(task: { readonly startDate: IsoDate | null; readonly dueDate: IsoDate | null }): Span | null {
  const { startDate, dueDate } = task;
  if (startDate && dueDate) return startDate <= dueDate ? { start: startDate, end: dueDate } : { start: dueDate, end: startDate };
  if (dueDate) return { start: dueDate, end: dueDate };
  if (startDate) return { start: startDate, end: startDate };
  return null;
}

/** Inclusive length in days. */
export function spanDays(span: Span): number {
  return diffDays(span.start, span.end) + 1;
}

export function startOfMonthIso(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

export function addMonthsIso(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(startOfMonthIso(value));
  date.setMonth(date.getMonth() + months);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** Range covering every bar, today and extra dates (project start/due, milestones), padded to whole months. */
export function computeRange(spans: Iterable<Span>, today: IsoDate, extra: readonly (IsoDate | null | undefined)[] = []): TimelineRange {
  let min = today;
  let max = today;
  for (const span of spans) {
    if (span.start < min) min = span.start;
    if (span.end > max) max = span.end;
  }
  for (const date of extra) {
    if (!date) continue;
    if (date < min) min = date;
    if (date > max) max = date;
  }
  const start = startOfMonthIso(addMonthsIso(min, -1));
  const end = addDaysIso(addMonthsIso(max, 3), -1);
  return { start, end, days: diffDays(start, end) + 1 };
}

export function dayToX(range: Span, day: IsoDate, pxPerDay: number): number {
  return diffDays(range.start, day) * pxPerDay;
}

/** The day under an x offset (px from the start of the track). */
export function xToDay(range: Span, x: number, pxPerDay: number): IsoDate {
  return addDaysIso(range.start, Math.floor(x / pxPerDay));
}

export interface Tick {
  readonly key: string;
  readonly label: string;
  readonly x: number;
  readonly width: number;
  readonly weekend?: boolean;
}

const MONTH_LONG = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short' });
const DAY_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const WEEKDAY_LETTER = new Intl.DateTimeFormat('en-US', { weekday: 'narrow' });

function quarterOf(value: IsoDate): number {
  return Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1;
}

function isWeekend(value: IsoDate): boolean {
  const day = parseIsoDate(value).getDay();
  return day === 0 || day === 6;
}

/** Two-tier header: major (months / quarters / years) and minor (days / weeks / months). */
export function buildTicks(range: TimelineRange, zoom: TimelineZoom): { major: Tick[]; minor: Tick[] } {
  const px = PX_PER_DAY[zoom];
  const major: Tick[] = [];
  const minor: Tick[] = [];
  const push = (list: Tick[], from: IsoDate, to: IsoDate, label: string, weekend?: boolean) => {
    const a = from < range.start ? range.start : from;
    const b = to > range.end ? range.end : to;
    if (a > b) return;
    list.push({ key: from, label, x: dayToX(range, a, px), width: (diffDays(a, b) + 1) * px, ...(weekend ? { weekend } : {}) });
  };

  if (zoom === 'quarter') {
    for (let cursor = `${range.start.slice(0, 4)}-01-01`; cursor <= range.end; cursor = addMonthsIso(cursor, 12)) {
      push(major, cursor, addDaysIso(addMonthsIso(cursor, 12), -1), cursor.slice(0, 4));
    }
  } else if (zoom === 'month') {
    const q = quarterOf(range.start);
    for (let cursor = `${range.start.slice(0, 4)}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`; cursor <= range.end; cursor = addMonthsIso(cursor, 3)) {
      push(major, cursor, addDaysIso(addMonthsIso(cursor, 3), -1), `Q${quarterOf(cursor)} ${cursor.slice(0, 4)}`);
    }
  } else {
    for (let cursor = startOfMonthIso(range.start); cursor <= range.end; cursor = addMonthsIso(cursor, 1)) {
      push(major, cursor, addDaysIso(addMonthsIso(cursor, 1), -1), MONTH_LONG.format(parseIsoDate(cursor)));
    }
  }

  if (zoom === 'day') {
    for (let cursor = range.start; cursor <= range.end; cursor = addDaysIso(cursor, 1)) {
      push(minor, cursor, cursor, `${WEEKDAY_LETTER.format(parseIsoDate(cursor))} ${Number(cursor.slice(8, 10))}`, isWeekend(cursor));
    }
  } else if (zoom === 'week') {
    for (let cursor = startOfWeekIso(range.start); cursor <= range.end; cursor = addDaysIso(cursor, 7)) {
      push(minor, cursor, addDaysIso(cursor, 6), DAY_SHORT.format(parseIsoDate(cursor < range.start ? range.start : cursor)));
    }
  } else {
    for (let cursor = startOfMonthIso(range.start); cursor <= range.end; cursor = addMonthsIso(cursor, 1)) {
      const label = MONTH_SHORT.format(parseIsoDate(cursor));
      push(minor, cursor, addDaysIso(addMonthsIso(cursor, 1), -1), zoom === 'month' ? label : label.charAt(0));
    }
  }
  return { major, minor };
}

/** Weekend day columns to shade (only where a day is wide enough to see). */
export function weekendBands(range: TimelineRange, zoom: TimelineZoom): Tick[] {
  if (zoom !== 'day' && zoom !== 'week') return [];
  const px = PX_PER_DAY[zoom];
  const out: Tick[] = [];
  // First Saturday on or after the start.
  let cursor = range.start;
  while (parseIsoDate(cursor).getDay() !== 6) cursor = addDaysIso(cursor, 1);
  for (; cursor <= range.end; cursor = addDaysIso(cursor, 7)) {
    const sundayInRange = addDaysIso(cursor, 1) <= range.end;
    out.push({ key: cursor, label: '', x: dayToX(range, cursor, px), width: (sundayInRange ? 2 : 1) * px, weekend: true });
  }
  return out;
}

export type DragMode = 'move' | 'start' | 'end';

/** Bar after dragging by `delta` days in `mode`. Never inverts; a bar is at least one day long. */
export function dragSpan(span: Span, mode: DragMode, delta: number): Span {
  if (mode === 'move') return { start: addDaysIso(span.start, delta), end: addDaysIso(span.end, delta) };
  if (mode === 'start') {
    const start = addDaysIso(span.start, delta);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDaysIso(span.end, delta);
  return { start: span.start, end: end < span.start ? span.start : end };
}

/** Normalized range between two days picked by dragging (either direction). */
export function rangeBetween(a: IsoDate, b: IsoDate): Span {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * Task patch for a new span. Keeps the task's shape: a task that only had a due date (or is a
 * milestone) keeps only a due date unless it was stretched into a multi-day bar.
 */
export function spanPatch(
  task: { readonly startDate: IsoDate | null; readonly dueDate: IsoDate | null; readonly isMilestone?: boolean },
  next: Span,
): { startDate?: IsoDate | null; dueDate?: IsoDate | null } {
  if (task.isMilestone) return { dueDate: next.end, ...(task.startDate ? { startDate: next.end } : {}) };
  if (!task.startDate && next.start === next.end) return { dueDate: next.end };
  if (!task.dueDate && task.startDate && next.start === next.end) return { startDate: next.start };
  return { startDate: next.start, dueDate: next.end };
}

/** Smallest zoom that fits `days` into `width` px. */
export function fitZoom(days: number, width: number): TimelineZoom {
  return TIMELINE_ZOOMS.find((zoom) => days * PX_PER_DAY[zoom] <= width) ?? 'quarter';
}

// --- Dependencies -----------------------------------------------------------------------------

export interface DependencyEdge {
  readonly id: string;
  readonly blockingTaskId: string;
  readonly blockedTaskId: string;
  readonly lagDays: number;
}

/** True when the waiting task starts before the task it waits on is finished (plus lag). */
export function isConflict(blocking: Span, blocked: Span, lagDays = 0): boolean {
  return diffDays(blocking.end, blocked.start) <= lagDays;
}

/**
 * Critical path by the classic backward pass over the real schedule: the project ends on the
 * latest due date; each task must finish before its waiting tasks need to start. A task with no
 * room to slip (slack ≤ 0) is critical, and so is a link between two critical tasks that leaves
 * no gap.
 */
export function criticalPath(spans: ReadonlyMap<string, Span>, edges: readonly DependencyEdge[]): { tasks: Set<string>; edges: Set<string> } {
  const tasks = new Set<string>();
  const critEdges = new Set<string>();
  if (spans.size === 0) return { tasks, edges: critEdges };
  let projectEnd: IsoDate | null = null;
  for (const span of spans.values()) if (!projectEnd || span.end > projectEnd) projectEnd = span.end;
  const end = projectEnd as IsoDate;

  const successors = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    if (!spans.has(edge.blockingTaskId) || !spans.has(edge.blockedTaskId)) continue;
    successors.set(edge.blockingTaskId, [...(successors.get(edge.blockingTaskId) ?? []), edge]);
  }

  const lateFinish = new Map<string, IsoDate>();
  const visiting = new Set<string>();
  const lf = (id: string): IsoDate => {
    const known = lateFinish.get(id);
    if (known) return known;
    if (visiting.has(id)) return end; // Defensive: the server rejects loops.
    visiting.add(id);
    let finish = end;
    for (const edge of successors.get(id) ?? []) {
      const next = spans.get(edge.blockedTaskId) as Span;
      const lateStart = addDaysIso(lf(edge.blockedTaskId), -(spanDays(next) - 1));
      const latest = addDaysIso(lateStart, -1 - edge.lagDays);
      if (latest < finish) finish = latest;
    }
    visiting.delete(id);
    lateFinish.set(id, finish);
    return finish;
  };

  for (const [id, span] of spans) {
    if (diffDays(span.end, lf(id)) <= 0) tasks.add(id);
  }
  for (const list of successors.values()) {
    for (const edge of list) {
      if (!tasks.has(edge.blockingTaskId) || !tasks.has(edge.blockedTaskId)) continue;
      const a = spans.get(edge.blockingTaskId) as Span;
      const b = spans.get(edge.blockedTaskId) as Span;
      if (diffDays(a.end, b.start) - 1 - edge.lagDays <= 0) critEdges.add(edge.id);
    }
  }
  return { tasks, edges: critEdges };
}

/**
 * SVG path for a finish → start arrow between two bars. (x1, y1) is the right end of the first
 * bar, (x2, y2) the left end of the second. Routes around bars with rounded elbows.
 */
export function arrowPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  const gap = 10;
  const r = 4;
  if (Math.abs(y2 - y1) < 1) return `M ${x1} ${y1} H ${x2 - 2}`;
  const down = y2 > y1 ? 1 : -1;
  if (x2 - gap >= x1 + gap) {
    // Room to drop straight down between the bars.
    const xm = Math.max(x1 + gap, Math.min(x2 - gap, x1 + gap));
    return [
      `M ${x1} ${y1}`,
      `H ${xm - r}`,
      `Q ${xm} ${y1} ${xm} ${y1 + down * r}`,
      `V ${y2 - down * r}`,
      `Q ${xm} ${y2} ${xm + r} ${y2}`,
      `H ${x2 - 2}`,
    ].join(' ');
  }
  // The second bar starts before the first ends: go out, around through the row gap, and back in.
  const xa = x1 + gap;
  const xb = x2 - gap;
  const ym = y2 - down * (rowHeight / 2);
  return [
    `M ${x1} ${y1}`,
    `H ${xa - r}`,
    `Q ${xa} ${y1} ${xa} ${y1 + down * r}`,
    `V ${ym - down * r}`,
    `Q ${xa} ${ym} ${xa - r} ${ym}`,
    `H ${xb + r}`,
    `Q ${xb} ${ym} ${xb} ${ym + down * r}`,
    `V ${y2 - down * r}`,
    `Q ${xb} ${y2} ${xb + r} ${y2}`,
    `H ${x2 - 2}`,
  ].join(' ');
}

/**
 * Waiting tasks that now start too early after `taskId` moved, and how far each must shift
 * (cascading down the chain). Returns task id → new span.
 */
export function cascadeShifts(spans: ReadonlyMap<string, Span>, edges: readonly DependencyEdge[], taskId: string): Map<string, Span> {
  const out = new Map<string, Span>();
  const current = (id: string) => out.get(id) ?? spans.get(id);
  const queue = [taskId];
  let guard = 0;
  while (queue.length && guard < 10_000) {
    guard += 1;
    const id = queue.shift() as string;
    const from = current(id);
    if (!from) continue;
    for (const edge of edges) {
      if (edge.blockingTaskId !== id) continue;
      const to = current(edge.blockedTaskId);
      if (!to) continue;
      const needed = diffDays(to.start, addDaysIso(from.end, 1 + edge.lagDays));
      if (needed <= 0) continue;
      out.set(edge.blockedTaskId, dragSpan(to, 'move', needed));
      queue.push(edge.blockedTaskId);
    }
  }
  out.delete(taskId);
  return out;
}
