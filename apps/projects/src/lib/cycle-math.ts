/**
 * Pure cycle math: state by dates, the next cycle's dates, and the cycle report (burndown with
 * an ideal line, plus scope changes over time) from the membership history in pm.cycle_tasks.
 * Days are local `YYYY-MM-DD`; timestamps are turned into local days with `toIsoDate`.
 */
import { addDaysIso, diffDays, toIsoDate, type IsoDate } from './dates';

export type CycleState = 'upcoming' | 'current' | 'done';

export function cycleState(cycle: { readonly startDate: IsoDate; readonly endDate: IsoDate; readonly completedAt: string | null }, today: IsoDate): CycleState {
  if (cycle.completedAt) return 'done';
  if (today < cycle.startDate) return 'upcoming';
  if (today > cycle.endDate) return 'done';
  return 'current';
}

/** Whole days left including today (0 once the end date has passed). */
export function cycleDaysLeft(endDate: IsoDate, today: IsoDate): number {
  return Math.max(0, diffDays(today, endDate) + 1);
}

/** Next cycle starts the day after `endDate` and has the same length. */
export function nextCycleDates(previous: { readonly startDate: IsoDate; readonly endDate: IsoDate }): { startDate: IsoDate; endDate: IsoDate } {
  const length = diffDays(previous.startDate, previous.endDate);
  const startDate = addDaysIso(previous.endDate, 1);
  return { startDate, endDate: addDaysIso(startDate, length) };
}

export interface CycleMember {
  readonly taskId: string;
  /** ISO timestamps. */
  readonly addedAt: string;
  readonly removedAt: string | null;
  readonly removedReason: 'removed' | 'moved' | 'rolled_over' | null;
  /** When the task reached done (null while open or cancelled). */
  readonly completedAt: string | null;
  readonly cancelled?: boolean;
  readonly points: number | null;
}

export interface CycleDay {
  readonly date: IsoDate;
  /** Tasks in the cycle at the end of the day. */
  readonly scope: number;
  readonly done: number;
  /** Open tasks left (scope minus done). */
  readonly remaining: number;
  /** Straight line from the scope on day one to zero on the last day. */
  readonly ideal: number;
  readonly added: number;
  readonly removed: number;
  /** Day is in the future (no actuals yet). */
  readonly future: boolean;
}

export interface CycleReport {
  readonly days: readonly CycleDay[];
  /** Scope on the first day of the cycle. */
  readonly plannedScope: number;
  readonly scope: number;
  readonly done: number;
  readonly remaining: number;
  /** Tasks added after day one. */
  readonly addedAfterStart: number;
  /** Tasks taken out after day one (not counting rollover on close). */
  readonly removedAfterStart: number;
  readonly rolledOver: number;
  readonly points: number;
  readonly donePoints: number;
  /** 0-100. */
  readonly percent: number;
}

const dayOfTs = (value: string): IsoDate => toIsoDate(new Date(value));

export function buildCycleReport(input: {
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly today: IsoDate;
  readonly members: readonly CycleMember[];
}): CycleReport {
  const { startDate, endDate, today, members } = input;
  const length = Math.max(0, diffDays(startDate, endDate));
  // Membership as day ranges. Rolled-over tasks count as in scope until the end of the cycle.
  const ranges = members.map((m) => {
    const from = dayOfTs(m.addedAt) < startDate ? startDate : dayOfTs(m.addedAt);
    const to = m.removedAt ? (m.removedReason === 'rolled_over' ? endDate : addDaysIso(dayOfTs(m.removedAt), -1)) : null;
    return { member: m, from, to };
  });
  const inScope = (day: IsoDate) => ranges.filter((r) => r.from <= day && (r.to === null || r.to >= day) && !(r.member.cancelled && !r.member.completedAt));
  const isDone = (m: CycleMember, day: IsoDate) => Boolean(m.completedAt && dayOfTs(m.completedAt) <= day);

  const firstScope = inScope(startDate).length;
  const days: CycleDay[] = [];
  for (let i = 0; i <= length; i += 1) {
    const date = addDaysIso(startDate, i);
    const future = date > today;
    const list = inScope(date);
    const done = list.filter((r) => isDone(r.member, date)).length;
    const added = i === 0 ? 0 : ranges.filter((r) => r.from === date).length;
    const removed = i === 0 ? 0 : ranges.filter((r) => r.to !== null && r.member.removedReason !== 'rolled_over' && addDaysIso(r.to, 1) === date).length;
    const ideal = length === 0 ? 0 : Math.round(firstScope * (1 - i / length) * 10) / 10;
    days.push({ date, scope: list.length, done, remaining: list.length - done, ideal, added, removed, future });
  }

  const active = members.filter((m) => m.removedAt === null || m.removedReason === 'rolled_over');
  const counted = active.filter((m) => !(m.cancelled && !m.completedAt));
  const done = counted.filter((m) => m.completedAt).length;
  const points = counted.reduce((sum, m) => sum + (m.points ?? 0), 0);
  const donePoints = counted.filter((m) => m.completedAt).reduce((sum, m) => sum + (m.points ?? 0), 0);
  return {
    days,
    plannedScope: firstScope,
    scope: counted.length,
    done,
    remaining: counted.length - done,
    addedAfterStart: days.reduce((sum, d) => sum + d.added, 0),
    removedAfterStart: days.reduce((sum, d) => sum + d.removed, 0),
    rolledOver: members.filter((m) => m.removedReason === 'rolled_over').length,
    points,
    donePoints,
    percent: counted.length ? Math.round((done / counted.length) * 100) : 0,
  };
}
