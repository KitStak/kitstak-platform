/**
 * Wizard projection (docs/programs/SPEC.md 3.13). A synthetic month made from the schedules and
 * the card: one output row per schedule line per occurrence at the card price, one finished
 * build per row for the per batch line, then `monthCharges` with the month already over so the
 * minimum top up shows. The wizard and the price card editor call it on every change; no server.
 * Hours come from `minutesPerOccurrence` on each schedule; when the card charges per hour and no
 * minutes were given, `hoursNotProjected` is true so the UI can say "Hourly work is not in this
 * estimate."
 */
import { accrueDay } from './accrual';
import { addDays, firstDayOfMonth, isRealMonth, lastDayOfMonth, workDaysInMonth } from './calendar';
import { type MonthResult, monthCharges } from './month';
import { quantityToScaled } from './money';
import { resolveHourRate, resolveUnitPrice } from './price';
import { type ScheduleLine, type ScheduleRule, occurrences, qtyFor } from './schedule';
import type { CardVersion, FinishedBuild, IsoMonth, OneTimeCharge, OutputRow, ProgramCalendar, TimeDay } from './types';

/** The program id the projection uses in its refs. */
export const PROJECTION_PROGRAM_ID = 'projection';

export interface ProjectMonthInput {
  readonly month: IsoMonth;
  readonly calendar: ProgramCalendar;
  readonly versions: readonly CardVersion[];
  /**
   * `minutesPerOccurrence` (optional) is the floor time one occurrence of the schedule takes, in
   * whole minutes, for a card that charges per hour (MAHCO: 480 for an 8 hour day).
   */
  readonly schedules: readonly { readonly rule: ScheduleRule; readonly lines: readonly ScheduleLine[]; readonly minutesPerOccurrence?: number }[];
  /** Setup fees and adjustments to include (dated in the month). */
  readonly oneTime?: readonly OneTimeCharge[];
}

/** UI copy for a projection of an hourly card made without hours. */
export const HOURS_NOT_PROJECTED_NOTE = 'Hourly work is not in this estimate.';

export interface ProjectMonthResult {
  /** The program work days of the month. */
  readonly workDays: number;
  readonly result: MonthResult;
  /** True when the card charges per hour on an occurrence day and no schedule gave its minutes. */
  readonly hoursNotProjected: boolean;
}

/** The month a schedule and a card would make (3.13). Throws a RangeError when `month` is not a real month or minutes are not whole and 0 or more. */
export function projectMonth(input: ProjectMonthInput): ProjectMonthResult {
  if (!isRealMonth(input.month)) throw new RangeError(`Not a YYYY-MM month: "${String(input.month)}"`);
  const from = firstDayOfMonth(input.month);
  const to = lastDayOfMonth(input.month);
  const output: OutputRow[] = [];
  const finished: FinishedBuild[] = [];
  const time: TimeDay[] = [];
  let hoursNotProjected = false;
  input.schedules.forEach((schedule, scheduleIndex) => {
    const minutes = schedule.minutesPerOccurrence;
    if (minutes !== undefined && (!Number.isSafeInteger(minutes) || minutes < 0)) throw new RangeError('Minutes per occurrence must be a whole number of 0 or more.');
    for (const date of occurrences(schedule.rule, input.calendar, from, to)) {
      if (minutes !== undefined && minutes > 0) time.push({ workDate: date, buildId: null, variantId: null, minutes });
      else if (minutes === undefined && resolveHourRate(input.versions, date)) hoursNotProjected = true;
      schedule.lines.forEach((line, lineIndex) => {
        const qty = qtyFor(line, date);
        if (quantityToScaled(qty) <= BigInt(0)) return;
        const buildId = `projection-${scheduleIndex + 1}-${lineIndex + 1}-${date}`;
        const price = resolveUnitPrice({ workDate: date, variantId: line.variantId, buildOverride: null, versions: input.versions });
        output.push({
          buildId,
          variantId: line.variantId,
          workDate: date,
          qty,
          scrapQty: '0',
          unitPrice: price.unitPrice,
          priceSource: price.source,
          versionId: price.versionId,
          revenueCents: accrueDay(qty, price.unitPrice).toString(),
          posting: 'program',
          pulseJobId: null,
        });
        finished.push({ buildId, buildKey: `${scheduleIndex + 1}.${lineIndex + 1}`, variantId: line.variantId, finishedOn: date, builtQty: qty });
      });
    }
  });
  const result = monthCharges({
    programId: PROJECTION_PROGRAM_ID,
    month: input.month,
    asOf: addDays(to, 1),
    calendar: input.calendar,
    versions: input.versions,
    output,
    finished,
    time,
    oneTime: input.oneTime ?? [],
  });
  return { workDays: workDaysInMonth(input.calendar, input.month).length, result, hoursNotProjected };
}
