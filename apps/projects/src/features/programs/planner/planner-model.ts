/**
 * Pure model of the Build planner (docs/programs/SPEC.md 5.10): the days shown, cell keys, the
 * fill actions (copy yesterday, copy last week, apply a schedule, default qty, suggest from
 * history), block selection edits (fill right, fill down, set, add 10 percent, clear), paste,
 * totals and the rows sent to `createBuildsAction`. No React; unit tested in
 * `planner-model.test.ts`. Quantities are 3 decimal strings summed as scaled bigints.
 */
import { addDays, divRound, fromScaled, isWorkDay, mulQuantityPrice, quantityToScaled, startOfWeek, weekday } from '@kitstak/programs-engine';
import type { IsoDate } from '@/lib/program-types';
import { readQty, trimQty } from '../kit/qty-input';

export type PlanMode = 'day' | 'week' | '2weeks';

export interface PlannerVariant {
  readonly id: string;
  readonly name: string;
  readonly defaultQty: string | null;
  readonly unitPrice: string | null;
  readonly stdMinutesPerUnit: string | null;
}

export interface DayInfo {
  readonly date: IsoDate;
  readonly work: boolean;
  /** Holiday or day off name ("Thanksgiving"), or "Day off". */
  readonly offName: string | null;
  readonly locked: boolean;
}

export interface ExistingBuild {
  readonly id: string;
  readonly key: string;
  readonly variantId: string | null;
  readonly date: IsoDate;
  readonly plannedQty: string;
  readonly builtQty: string;
  readonly cancelled: boolean;
}

export type Cells = ReadonlyMap<string, string>;

export const cellKey = (variantId: string, date: IsoDate) => `${variantId}|${date}`;

const ZERO = BigInt(0);
const q = (value: string | null | undefined): bigint => {
  if (!value) return ZERO;
  const read = readQty(value);
  return read.ok && read.qty ? quantityToScaled(read.qty) : ZERO;
};
const text = (scaled: bigint) => trimQty(fromScaled(scaled, 3));

export function daysFor(mode: PlanMode, from: IsoDate): IsoDate[] {
  if (mode === 'day') return [from];
  const start = startOfWeek(from, 1);
  const count = mode === 'week' ? 7 : 14;
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function shiftFrom(mode: PlanMode, from: IsoDate, direction: 1 | -1): IsoDate {
  return addDays(from, (mode === 'day' ? 1 : mode === 'week' ? 7 : 14) * direction);
}

export interface CalendarLike {
  readonly workingDays: readonly number[];
  readonly daysOff: readonly IsoDate[];
  readonly extraWorkDays: readonly IsoDate[];
}

export function dayInfo(date: IsoDate, calendar: CalendarLike, holidays: ReadonlyMap<IsoDate, string>, lockedThrough: IsoDate | null): DayInfo {
  const holiday = holidays.get(date) ?? null;
  const off = calendar.daysOff.includes(date);
  const work = calendar.extraWorkDays.includes(date) || (!off && !holiday && isWorkDay(date, calendar.workingDays));
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const restName = weekday === 0 || weekday === 6 ? 'Weekend' : 'Not a work day';
  return { date, work, offName: work ? null : holiday ?? (off ? 'Day off' : restName), locked: Boolean(lockedThrough && date <= lockedThrough) };
}

/** Existing builds per cell (cancelled ones do not count). */
export function existingByCell(builds: readonly ExistingBuild[]): Map<string, ExistingBuild[]> {
  const map = new Map<string, ExistingBuild[]>();
  for (const build of builds) {
    if (build.cancelled || !build.variantId) continue;
    const key = cellKey(build.variantId, build.date);
    map.set(key, [...(map.get(key) ?? []), build]);
  }
  return map;
}

function settable(day: DayInfo | undefined): boolean {
  return Boolean(day && !day.locked);
}

/** Copies each day's plan from `offset` days earlier (yesterday: -1, last week: -7). Existing builds and typed cells both count as the source. */
export function copyFrom(cells: Cells, variants: readonly PlannerVariant[], days: readonly DayInfo[], existing: ReadonlyMap<string, ExistingBuild[]>, history: ReadonlyMap<string, ExistingBuild[]>, offset: number): Map<string, string> {
  const next = new Map(cells);
  for (const day of days) {
    if (!settable(day) || !day.work) continue;
    const source = addDays(day.date, offset);
    for (const variant of variants) {
      const key = cellKey(variant.id, day.date);
      if (existing.has(key)) continue;
      const from = cellKey(variant.id, source);
      const typed = cells.get(from);
      const builds = existing.get(from) ?? history.get(from);
      const qty = typed && q(typed) > ZERO ? typed : builds ? text(builds.reduce((sum, build) => sum + quantityToScaled(build.plannedQty), ZERO)) : null;
      if (qty && q(qty) > ZERO) next.set(key, qty);
    }
  }
  return next;
}

/** Fills empty work day cells with each variant's default qty. */
export function fillDefaultQty(cells: Cells, variants: readonly PlannerVariant[], days: readonly DayInfo[], existing: ReadonlyMap<string, ExistingBuild[]>): Map<string, string> {
  const next = new Map(cells);
  for (const day of days) {
    if (!settable(day) || !day.work) continue;
    for (const variant of variants) {
      const key = cellKey(variant.id, day.date);
      if (existing.has(key) || (next.get(key) ?? '').trim()) continue;
      if (variant.defaultQty && q(variant.defaultQty) > ZERO) next.set(key, trimQty(variant.defaultQty));
    }
  }
  return next;
}

/** Schedule lines: qty per variant, with an optional qty per weekday (`qtyFor`). */
export interface ScheduleLike {
  readonly days: readonly number[];
  readonly pattern: string;
  readonly lines: readonly { readonly variantId: string; readonly qty: string; readonly qtyByWeekday: Readonly<Record<string, string>> | null }[];
}

export function scheduleRuns(schedule: ScheduleLike, date: IsoDate, calendar: CalendarLike): boolean {
  if (schedule.pattern === 'daily') return true;
  if (schedule.pattern === 'weekdays') return isWorkDay(date, calendar.workingDays);
  return schedule.days.includes(weekday(date));
}

export function applySchedule(cells: Cells, schedule: ScheduleLike, days: readonly DayInfo[], existing: ReadonlyMap<string, ExistingBuild[]>, calendar: CalendarLike): Map<string, string> {
  const next = new Map(cells);
  for (const day of days) {
    if (!settable(day) || !day.work || !scheduleRuns(schedule, day.date, calendar)) continue;
    for (const line of schedule.lines) {
      const key = cellKey(line.variantId, day.date);
      if (existing.has(key)) continue;
      const byDay = line.qtyByWeekday?.[String(weekday(day.date))];
      const qty = byDay !== undefined && byDay !== null && byDay.trim() !== '' ? byDay : line.qty;
      if (q(qty) > ZERO) next.set(key, trimQty(qty));
    }
  }
  return next;
}

/** The average built per variant per weekday over the history window, rounded to whole units. Returns the filled cells and which keys were suggested. */
export function suggestFromHistory(cells: Cells, variants: readonly PlannerVariant[], days: readonly DayInfo[], existing: ReadonlyMap<string, ExistingBuild[]>, history: readonly ExistingBuild[]): { cells: Map<string, string>; suggested: Set<string> } {
  const sums = new Map<string, { total: bigint; days: Set<IsoDate> }>();
  for (const build of history) {
    if (!build.variantId || build.cancelled) continue;
    const key = `${build.variantId}|${weekday(build.date)}`;
    const entry = sums.get(key) ?? { total: ZERO, days: new Set<IsoDate>() };
    entry.total += quantityToScaled(build.builtQty);
    entry.days.add(build.date);
    sums.set(key, entry);
  }
  const next = new Map(cells);
  const suggested = new Set<string>();
  for (const day of days) {
    if (!settable(day) || !day.work) continue;
    for (const variant of variants) {
      const key = cellKey(variant.id, day.date);
      if (existing.has(key) || (next.get(key) ?? '').trim()) continue;
      const entry = sums.get(`${variant.id}|${weekday(day.date)}`);
      if (!entry || entry.days.size === 0) continue;
      const average = divRound(entry.total, BigInt(entry.days.size));
      const whole = divRound(average, BigInt(1000)) * BigInt(1000);
      if (whole <= ZERO) continue;
      next.set(key, text(whole));
      suggested.add(key);
    }
  }
  return { cells: next, suggested };
}

/* Selection ------------------------------------------------------------------------------------ */

export interface Block {
  readonly rows: readonly string[];
  readonly days: readonly IsoDate[];
}

export function fillRight(cells: Cells, block: Block, dayInfoOf: (date: IsoDate) => DayInfo | undefined): Map<string, string> {
  const next = new Map(cells);
  const first = block.days[0];
  if (!first) return next;
  for (const row of block.rows) {
    const value = cells.get(cellKey(row, first)) ?? '';
    for (const day of block.days.slice(1)) if (settable(dayInfoOf(day))) next.set(cellKey(row, day), value);
  }
  return next;
}

export function fillDown(cells: Cells, block: Block, dayInfoOf: (date: IsoDate) => DayInfo | undefined): Map<string, string> {
  const next = new Map(cells);
  const first = block.rows[0];
  if (!first) return next;
  for (const day of block.days) {
    if (!settable(dayInfoOf(day))) continue;
    const value = cells.get(cellKey(first, day)) ?? '';
    for (const row of block.rows.slice(1)) next.set(cellKey(row, day), value);
  }
  return next;
}

export function setBlock(cells: Cells, block: Block, value: string, dayInfoOf: (date: IsoDate) => DayInfo | undefined): Map<string, string> {
  const next = new Map(cells);
  for (const row of block.rows) for (const day of block.days) if (settable(dayInfoOf(day))) next.set(cellKey(row, day), value);
  return next;
}

/** Adds 10 percent to every filled cell, rounded to whole units. */
export function addTenPercent(cells: Cells, block: Block): Map<string, string> {
  const next = new Map(cells);
  for (const row of block.rows) {
    for (const day of block.days) {
      const key = cellKey(row, day);
      const value = q(cells.get(key));
      if (value <= ZERO) continue;
      const raised = divRound(value * BigInt(110), BigInt(100));
      next.set(key, text(divRound(raised, BigInt(1000)) * BigInt(1000)));
    }
  }
  return next;
}

/* Totals and rows ------------------------------------------------------------------------------ */

export interface PlanTotals {
  readonly builds: number;
  readonly units: string;
  readonly revenueCents: string;
  /** Hours as 2 decimal text, or null when no variant has standard minutes. */
  readonly hours: string | null;
  readonly byDay: ReadonlyMap<IsoDate, bigint>;
  readonly byRow: ReadonlyMap<string, bigint>;
  readonly hoursByDay: ReadonlyMap<IsoDate, bigint>;
  readonly invalid: number;
}

export function totalsOf(cells: Cells, variants: readonly PlannerVariant[], days: readonly IsoDate[]): PlanTotals {
  let builds = 0;
  let units = ZERO;
  let cents = ZERO;
  let minutes = ZERO;
  let anyMinutes = false;
  let invalid = 0;
  const byDay = new Map<IsoDate, bigint>();
  const byRow = new Map<string, bigint>();
  const minutesByDay = new Map<IsoDate, bigint>();
  const shown = new Set(days);
  for (const variant of variants) {
    for (const day of days) {
      const raw = cells.get(cellKey(variant.id, day));
      if (!raw || !raw.trim()) continue;
      const read = readQty(raw);
      if (!read.ok) {
        invalid += 1;
        continue;
      }
      if (!read.qty || !shown.has(day)) continue;
      const qty = quantityToScaled(read.qty);
      if (qty <= ZERO) continue;
      builds += 1;
      units += qty;
      byDay.set(day, (byDay.get(day) ?? ZERO) + qty);
      byRow.set(variant.id, (byRow.get(variant.id) ?? ZERO) + qty);
      if (variant.unitPrice) cents += mulQuantityPrice(read.qty, variant.unitPrice);
      if (variant.stdMinutesPerUnit && q(variant.stdMinutesPerUnit) > ZERO) {
        anyMinutes = true;
        // minutes (3 dp) x qty (3 dp) -> scaled 6; keep as scaled 3 minutes.
        const m = divRound(qty * quantityToScaled(variant.stdMinutesPerUnit), BigInt(1000));
        minutes += m;
        minutesByDay.set(day, (minutesByDay.get(day) ?? ZERO) + m);
      }
    }
  }
  const hoursByDay = new Map<IsoDate, bigint>();
  for (const [day, m] of minutesByDay) hoursByDay.set(day, divRound(m, BigInt(600)));
  return {
    builds,
    units: fromScaled(units, 3),
    revenueCents: cents.toString(),
    hours: anyMinutes ? fromScaled(divRound(minutes, BigInt(600)), 2) : null,
    byDay,
    byRow,
    hoursByDay,
    invalid,
  };
}

export interface CreateRow {
  readonly variantId: string;
  readonly buildDate: IsoDate;
  readonly plannedQty: string;
  readonly assigneeId: string | null;
}

/** Rows for `createBuildsAction`; with one per variant per day on, cells that already have a build are skipped and counted. */
export function rowsToCreate(cells: Cells, variants: readonly PlannerVariant[], days: readonly DayInfo[], existing: ReadonlyMap<string, ExistingBuild[]>, options: { readonly onePerDay: boolean; readonly assigneeId: string | null }): { rows: CreateRow[]; alreadyExisted: number } {
  const rows: CreateRow[] = [];
  let alreadyExisted = 0;
  for (const day of days) {
    if (day.locked) continue;
    for (const variant of variants) {
      const key = cellKey(variant.id, day.date);
      const read = readQty(cells.get(key) ?? '');
      if (!read.ok || !read.qty || quantityToScaled(read.qty) <= ZERO) continue;
      if (options.onePerDay && existing.has(key)) {
        alreadyExisted += 1;
        continue;
      }
      rows.push({ variantId: variant.id, buildDate: day.date, plannedQty: read.qty, assigneeId: options.assigneeId });
    }
  }
  return { rows, alreadyExisted };
}

/** Title pattern preview: "{variant} · {date}" style patterns with the first new build. */
export function titlePreview(pattern: string, variant: string, date: string, key: string): string {
  return pattern.replace(/\{variant\}/gi, variant).replace(/\{date\}/gi, date).replace(/\{program\}/gi, key).replace(/\{sku\}/gi, variant);
}
