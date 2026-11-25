/**
 * Pure helpers for the Schedule tab (docs/programs/SPEC.md 5.13): saved schedules to editor values
 * and back, the lines summary ("8 variants · 800 kits each time", "... Mon to Fri, 400 on Sat"),
 * and the month preview grid.
 */
import { addDays, endOfMonth, firstDayOfMonth, formatQty, isWorkDay, occursOn, qtyFor, startOfWeek, unitLabel, weekday, type ProgramCalendar } from '@kitstak/programs-engine';
import type { IsoDate, IsoMonth, ScheduleDTO, ScheduleInput, UnitLabel, VariantDTO } from '@/lib/program-types';
import { linesFor, toSchedulePayload, type ScheduleEditorValue } from '../editors/schedule-model';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function plain(qty: string): string {
  return qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty;
}

/** The editor value for a saved schedule; active variants not on it come in switched off. */
export function editorValueFor(schedule: ScheduleDTO, variants: readonly VariantDTO[]): ScheduleEditorValue {
  const active = variants.filter((variant) => variant.status === 'active');
  const lineByVariant = new Map(schedule.lines.map((line) => [line.variantId, line]));
  const lines = active.map((variant) => {
    const line = lineByVariant.get(variant.id);
    if (!line) return { variantKey: variant.key, include: false, qty: variant.defaultQty ? plain(variant.defaultQty) : '100', qtyByWeekday: null, assigneeId: null };
    const byDay = line.qtyByWeekday ? Object.fromEntries(Object.entries(line.qtyByWeekday).map(([day, qty]) => [day, plain(qty)])) : null;
    return { variantKey: variant.key, include: true, qty: plain(line.qty), qtyByWeekday: byDay, assigneeId: line.assigneeId };
  });
  return { enabled: true, name: schedule.name, pattern: schedule.pattern, days: [...schedule.days], intervalWeeks: schedule.intervalWeeks, startsOn: schedule.startsOn, endsOn: schedule.endsOn, leadDays: schedule.leadDays, skipHolidays: schedule.skipHolidays, lines };
}

/** A new schedule: every weekday from the next work day, every active variant at its default qty. */
export function newEditorValue(variants: readonly VariantDTO[], startsOn: IsoDate, count: number): ScheduleEditorValue {
  return {
    enabled: true,
    name: count === 0 ? 'Weekday run' : `Run ${count + 1}`,
    pattern: 'weekdays',
    days: [1, 2, 3, 4, 5],
    intervalWeeks: 1,
    startsOn,
    endsOn: null,
    leadDays: 7,
    skipHolidays: true,
    lines: linesFor(variants.filter((variant) => variant.status === 'active')),
  };
}

/** The create and update payload (lines by variant key; the server resolves them). */
export function toScheduleInput(value: ScheduleEditorValue, extra: { readonly skipDates: readonly IsoDate[]; readonly defaultAssigneeId: string | null; readonly defaultStatusId: string | null }): ScheduleInput {
  const payload = toSchedulePayload(value);
  return {
    name: payload.name,
    pattern: payload.pattern,
    days: payload.days,
    intervalWeeks: payload.intervalWeeks,
    startsOn: payload.startsOn,
    endsOn: payload.endsOn,
    leadDays: payload.leadDays,
    skipHolidays: value.skipHolidays,
    skipDates: [...extra.skipDates],
    defaultAssigneeId: extra.defaultAssigneeId,
    defaultStatusId: extra.defaultStatusId,
    lines: payload.lines.map((line) => ({ variantKey: line.variantKey, qty: line.qty, qtyByWeekday: line.qtyByWeekday ?? null, assigneeId: line.assigneeId ?? null })),
  };
}

/** The engine rule for a saved schedule. */
export function ruleOf(schedule: ScheduleDTO) {
  return { pattern: schedule.pattern, days: schedule.days, intervalWeeks: schedule.intervalWeeks, startsOn: schedule.startsOn, endsOn: schedule.endsOn, skipHolidays: schedule.skipHolidays, skipDates: schedule.skipDates };
}

/** Units one occurrence makes on a date. */
export function unitsOn(schedule: ScheduleDTO, date: IsoDate): number {
  return schedule.lines.reduce((sum, line) => sum + Number(qtyFor({ variantId: line.variantId, qty: line.qty, qtyByWeekday: line.qtyByWeekday }, date)), 0);
}

/**
 * "8 variants · 800 kits each time", or with a line that varies by day
 * "8 variants · 800 kits Mon to Fri, 400 on Sat".
 */
export function linesSummary(schedule: Pick<ScheduleDTO, 'lines' | 'days' | 'pattern'>, unit: UnitLabel): string {
  const count = schedule.lines.length;
  const variants = count === 1 ? '1 variant' : `${count} variants`;
  if (count === 0) return 'No variants';
  const varies = schedule.lines.some((line) => line.qtyByWeekday && Object.keys(line.qtyByWeekday).length > 0);
  const days = schedule.pattern === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : schedule.pattern === 'weekdays' ? [1, 2, 3, 4, 5] : [...schedule.days];
  if (!varies || days.length === 0) {
    const total = schedule.lines.reduce((sum, line) => sum + Number(line.qty), 0);
    return `${variants} · ${unitLabel(String(total), unit)} each time`;
  }
  const byDay = new Map<number, number>();
  for (const day of days) byDay.set(day, schedule.lines.reduce((sum, line) => sum + Number(line.qtyByWeekday?.[String(day)] ?? line.qty), 0));
  const groups = new Map<number, number[]>();
  for (const day of [1, 2, 3, 4, 5, 6, 0].filter((entry) => byDay.has(entry))) {
    const total = byDay.get(day) as number;
    groups.set(total, [...(groups.get(total) ?? []), day]);
  }
  const parts = [...groups.entries()].map(([total, list], index) => {
    const span = list.length > 2 && isRun(list) ? `${WEEKDAY[list[0] as number]} to ${WEEKDAY[list[list.length - 1] as number]}` : list.map((day) => WEEKDAY[day]).join(', ');
    return index === 0 ? `${unitLabel(String(total), unit)} ${span}` : `${formatQty(String(total))} on ${span}`;
  });
  return `${variants} · ${parts.join(', ')}`;
}

function isRun(days: readonly number[]): boolean {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const positions = days.map((day) => order.indexOf(day));
  return positions.every((position, index) => index === 0 || position === (positions[index - 1] as number) + 1);
}

export interface MonthCell {
  readonly date: IsoDate;
  readonly inMonth: boolean;
  readonly workDay: boolean;
  readonly dayOff: boolean;
  readonly isToday: boolean;
  readonly runs: readonly { readonly scheduleId: string; readonly units: number; readonly skipped: boolean }[];
}

/** Six weeks, Monday first, covering `month`, with each schedule's occurrences and skipped days. */
export function monthGrid(month: IsoMonth, schedules: readonly ScheduleDTO[], calendar: ProgramCalendar, today: IsoDate): MonthCell[] {
  const first = firstDayOfMonth(month);
  const start = startOfWeek(first, 1);
  const last = endOfMonth(first);
  const cells: MonthCell[] = [];
  const weeks = Math.ceil((Number(last.slice(8, 10)) + ((weekday(first) + 6) % 7)) / 7);
  for (let index = 0; index < weeks * 7; index += 1) {
    const date = addDays(start, index);
    const runs = schedules
      .filter((schedule) => schedule.status !== 'ended')
      .flatMap((schedule) => {
        const rule = ruleOf(schedule);
        if (occursOn(rule, calendar, date)) return [{ scheduleId: schedule.id, units: unitsOn(schedule, date), skipped: schedule.status === 'paused' }];
        const loose = { ...rule, skipHolidays: false, skipDates: [] };
        if (occursOn(loose, calendar, date)) return [{ scheduleId: schedule.id, units: unitsOn(schedule, date), skipped: true }];
        return [];
      });
    cells.push({ date, inMonth: date.slice(0, 7) === month, workDay: isWorkDay(calendar, date), dayOff: calendar.daysOff.includes(date), isToday: date === today, runs });
  }
  return cells;
}
