/**
 * Cost, profit, margin and the company profit bridge (docs/pulse/SPEC.md 4.9). Pure functions.
 * Ratios are `null` when the divisor is 0 or less, never 0 and never infinity.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, marginBp, marginGap, perUnitCents, prorateCounted, prorateDays, ratioBp, toCents } from '../money';
import { DEFAULT_WORKING_DAYS, weekday } from './calendar';
import type { CompanyCostSpreadMode, IsoDate, MoneyBuckets, SharedCostRule } from './types';

/** The kinds of row in `pulse.v_facts`. */
export const FACT_KINDS = ['revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared', 'billed_memo'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Fact kinds that count in profit. `billed_memo` rows are never summed into revenue. */
export const PROFIT_KINDS: readonly FactKind[] = ['revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared'];
export const REVENUE_KINDS: readonly FactKind[] = ['revenue_base', 'revenue_vas', 'revenue_other'];
export const COST_KINDS: readonly FactKind[] = ['labor', 'material', 'other', 'shared'];

export interface FactTotals extends MoneyBuckets {
  readonly baseRevenueCents: Cents;
  readonly serviceRevenueCents: Cents;
  readonly otherRevenueCents: Cents;
  readonly billedCents: Cents;
}

/** Rolls fact rows up by kind. The answer equals the sum of the rows to the cent. */
export function sumFacts(rows: Iterable<{ kind: FactKind; amountCents: CentsLike }>): FactTotals {
  const totals: Record<FactKind, Cents> = { revenue_base: ZERO, revenue_vas: ZERO, revenue_other: ZERO, labor: ZERO, material: ZERO, other: ZERO, shared: ZERO, billed_memo: ZERO };
  for (const row of rows) totals[row.kind] += toCents(row.amountCents);
  return {
    baseRevenueCents: totals.revenue_base,
    serviceRevenueCents: totals.revenue_vas,
    otherRevenueCents: totals.revenue_other,
    revenueCents: totals.revenue_base + totals.revenue_vas + totals.revenue_other,
    laborCents: totals.labor,
    materialCents: totals.material,
    otherCents: totals.other,
    sharedCents: totals.shared,
    billedCents: totals.billed_memo,
  };
}

export interface ProfitSummary extends MoneyBuckets {
  /** Labor plus material plus other plus shared. */
  readonly costCents: Cents;
  /** Revenue minus cost. */
  readonly profitCents: Cents;
  /** "Margin after all costs", in basis points. */
  readonly marginBp: number | null;
  /** Why the margin has no number, when it has none. */
  readonly marginGap: 'no_revenue' | 'negative_revenue' | 'out_of_range' | null;
  /** Revenue minus labor, material and other. */
  readonly profitBeforeSharedCents: Cents;
  /** "Margin before shared costs", in basis points. */
  readonly marginBeforeSharedBp: number | null;
  /** Labor as a share of revenue, in basis points. */
  readonly laborPctOfRevenueBp: number | null;
  readonly costPerUnitCents: Cents | null;
  readonly profitPerUnitCents: Cents | null;
  readonly revenuePerUnitCents: Cents | null;
  readonly laborCostPerUnitCents: Cents | null;
}

/** Every headline number for a job, a client, a service or a date range, from the money buckets. */
export function profitSummary(buckets: MoneyBuckets, unitsGood: Decimal = 0): ProfitSummary {
  const costCents = buckets.laborCents + buckets.materialCents + buckets.otherCents + buckets.sharedCents;
  const profitCents = buckets.revenueCents - costCents;
  const profitBeforeSharedCents = profitCents + buckets.sharedCents;
  return {
    revenueCents: buckets.revenueCents,
    laborCents: buckets.laborCents,
    materialCents: buckets.materialCents,
    otherCents: buckets.otherCents,
    sharedCents: buckets.sharedCents,
    costCents,
    profitCents,
    marginBp: marginBp(profitCents, buckets.revenueCents),
    marginGap: marginGap(profitCents, buckets.revenueCents),
    profitBeforeSharedCents,
    marginBeforeSharedBp: marginBp(profitBeforeSharedCents, buckets.revenueCents),
    laborPctOfRevenueBp: ratioBp(buckets.laborCents, buckets.revenueCents),
    costPerUnitCents: perUnitCents(costCents, unitsGood),
    profitPerUnitCents: perUnitCents(profitCents, unitsGood),
    revenuePerUnitCents: perUnitCents(buckets.revenueCents, unitsGood),
    laborCostPerUnitCents: perUnitCents(buckets.laborCents, unitsGood),
  };
}

/** Adds money buckets together (jobs into a client, clients into a company). */
export function addBuckets(list: Iterable<MoneyBuckets>): MoneyBuckets {
  let revenueCents = ZERO;
  let laborCents = ZERO;
  let materialCents = ZERO;
  let otherCents = ZERO;
  let sharedCents = ZERO;
  for (const item of list) {
    revenueCents += item.revenueCents;
    laborCents += item.laborCents;
    materialCents += item.materialCents;
    otherCents += item.otherCents;
    sharedCents += item.sharedCents;
  }
  return { revenueCents, laborCents, materialCents, otherCents, sharedCents };
}

/** Plain words for a margin with no number. */
export function marginGapLabel(gap: ProfitSummary['marginGap']): string | null {
  if (gap === 'no_revenue') return 'No revenue yet';
  if (gap === 'negative_revenue') return 'Revenue is below zero';
  if (gap === 'out_of_range') return 'Too far off to show as a percent';
  return null;
}

export interface CompanyBridgeInput {
  /** "Profit on jobs": the sum of profit facts for jobs and client level rows. */
  readonly workProfitCents: CentsLike;
  /** "Time not on a job that no job carried" (4.5). */
  readonly sharedGapCents: CentsLike;
  /** "Paid time not on any job". Counted as 0 under the `full` rule, because it is in the pool already. */
  readonly missingCents: CentsLike;
  /** Company costs in the range: rent, utilities, salaried staff and so on. */
  readonly companyCostCents: CentsLike;
  /** Overhead cents stamped on production, service and indirect entries. */
  readonly overheadAbsorbedCents: CentsLike;
  /**
   * Whether company costs were counted for these days. Left out, it is "company costs above zero".
   * `spreadCompanyCosts` sets it, so a part month with a share that rounds to 0 still shows the step.
   */
  readonly countsOverhead?: boolean;
  readonly rule: SharedCostRule;
}

export interface CompanyBridgeLine {
  readonly key: 'work_profit' | 'shared_gap' | 'missing_time' | 'overhead_gap' | 'company_profit';
  readonly label: string;
  /** The signed effect on profit: costs are below zero. */
  readonly amountCents: Cents;
}

export interface CompanyBridge {
  readonly workProfitCents: Cents;
  readonly sharedGapCents: Cents;
  readonly missingCents: Cents;
  /** Company costs minus overhead absorbed, or 0 when no company costs were entered. */
  readonly overheadGapCents: Cents;
  /** False when no company costs were entered: Pulse trusts the hourly overhead rate and hides the line. */
  readonly showsOverheadGap: boolean;
  readonly companyProfitCents: Cents;
  /** The walk from job profit to company profit, line by line. The lines add up to company profit. */
  readonly lines: CompanyBridgeLine[];
}

/**
 * The walk from job profit to company profit.
 * Example: $48,210.00 on jobs, less a $1,150.00 shared gap, $2,360.00 of paid time on no job and a
 * $4,800.00 overhead gap, leaves $39,900.00 for the company.
 */
export function companyBridge(input: CompanyBridgeInput): CompanyBridge {
  const workProfitCents = toCents(input.workProfitCents);
  const sharedGapCents = toCents(input.sharedGapCents);
  const missingCents = input.rule === 'full' ? ZERO : toCents(input.missingCents);
  const companyCost = toCents(input.companyCostCents);
  const showsOverheadGap = input.countsOverhead ?? companyCost > ZERO;
  const overheadGapCents = showsOverheadGap ? companyCost - toCents(input.overheadAbsorbedCents) : ZERO;
  const companyProfitCents = workProfitCents - sharedGapCents - missingCents - overheadGapCents;
  const lines: CompanyBridgeLine[] = [
    { key: 'work_profit', label: 'Profit on jobs', amountCents: workProfitCents },
    { key: 'shared_gap', label: 'Time not on a job that no job carried', amountCents: -sharedGapCents },
    { key: 'missing_time', label: 'Paid time not on any job', amountCents: -missingCents },
  ];
  if (showsOverheadGap) {
    lines.push({
      key: 'overhead_gap',
      label: overheadGapCents < ZERO ? 'Your hourly rate covered more overhead than you spent' : 'Overhead your hourly rate did not cover',
      amountCents: -overheadGapCents,
    });
  }
  lines.push({ key: 'company_profit', label: 'Company profit', amountCents: companyProfitCents });
  return { workProfitCents, sharedGapCents, missingCents, overheadGapCents, showsOverheadGap, companyProfitCents, lines };
}

/** One calendar month that the range touches and that has rows in `company_days`. */
export interface CompanyCostMonthInput {
  /** First day of the month, `YYYY-MM-01`. */
  readonly month: IsoDate;
  /** Company costs dated anywhere in the whole month, not only on the days in the range. */
  readonly monthCostCents: CentsLike;
  /** Overhead the hourly rates covered on the days of this month that are in the range. */
  readonly overheadAbsorbedCents: CentsLike;
}

export interface CompanyCostPart {
  readonly month: IsoDate;
  readonly daysCounted: number;
  readonly daysInMonth: number;
  /** Working days of the month that are in the range, and in the whole month (`settings.working_days`). */
  readonly workDaysCounted: number;
  readonly workDaysInMonth: number;
  /**
   * How this month's share was counted: by calendar day, or by work day. A month with no working
   * day at all falls back to calendar days, so its costs are never lost.
   */
  readonly spread: CompanyCostSpreadMode;
  /** The whole month of company costs. */
  readonly monthCostCents: Cents;
  /** The share for the days in the range: equal to the month when the whole month is in the range. */
  readonly countedCents: Cents;
  /** Overhead the hourly rates covered on the same days. */
  readonly overheadAbsorbedCents: Cents;
}

export interface CompanyCostSpread {
  /** How a part month was shared out: by calendar day (the default) or by work day. */
  readonly spread: CompanyCostSpreadMode;
  /** Months with company costs above zero, oldest first. Only these count in the overhead step. */
  readonly parts: CompanyCostPart[];
  /** The sum of the counted shares. */
  readonly companyCostCents: Cents;
  /** Overhead covered on the days of the counted months. */
  readonly overheadAbsorbedCents: Cents;
  /** True when at least one month had company costs, so the overhead step is in the walk. */
  readonly countsOverhead: boolean;
  /** True when a counted month is only partly in the range, or a month in the range has no company costs while another has. */
  readonly partial: boolean;
  /** Plain words for the screen when the figure is partial, else null. Holds days and month names, never money. */
  readonly note: string | null;
}

const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function monthWord(month: IsoDate, withYear: boolean): string {
  const name = MONTH_WORDS[Number(month.slice(5, 7)) - 1] ?? month.slice(0, 7);
  return withYear ? `${name} ${month.slice(0, 4)}` : name;
}

/** Days in a calendar month, by plain arithmetic so the far ends of the calendar are safe. */
function daysInMonthOf(month: IsoDate): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (index === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(index) ? 30 : 31;
}

function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** How many of the days `firstDay` to `lastDay` of a month are working days. */
function workDaysIn(month: IsoDate, firstDay: number, lastDay: number, workingDays: readonly number[]): number {
  let count = 0;
  const prefix = month.slice(0, 8);
  for (let day = firstDay; day <= lastDay; day += 1) if (workingDays.includes(weekday(`${prefix}${String(day).padStart(2, '0')}`))) count += 1;
  return count;
}

export interface CompanyCostSpreadOptions {
  /** `calendar` (the default): every day of the month carries the same share. `work_days`: only working days do. */
  readonly spread?: CompanyCostSpreadMode;
  /** JS weekday numbers (0 is Sunday) from `settings.working_days`. Monday to Friday when left out. */
  readonly workingDays?: readonly number[];
}

/**
 * Company costs are monthly, so a range that is not whole calendar months gets a share (4.9).
 * For each calendar month with company costs above zero, by calendar day (the default):
 * `share = prorateDays(month costs, first day, last day, days in month)`. By work day:
 * `share = prorateCounted(month costs, work days before the range, work days through its end,
 * work days in the month)`, so a day that is not a working day gets no share even if work was
 * logged on it. Both use the same rounding, so the parts of a month add back to the month to the
 * cent, and a whole month is the same in both ways (month close never changes).
 * A month with no company costs is left out: Pulse trusts the overhead inside the hourly rates for it.
 * Example: $70,500.00 typed in for November, range Nov 1 to Nov 18: `divRound(7050000 * 18, 30) = 4230000`,
 * and the screen says "Company costs for 18 of 30 days." By work day, Monday to Friday, the same
 * range is 13 of 21 work days: `divRound(7050000 * 13, 21) = 4364286`, "Company costs for 13 of 21 work days."
 */
export function spreadCompanyCosts(months: readonly CompanyCostMonthInput[], from: IsoDate, to: IsoDate, options: CompanyCostSpreadOptions = {}): CompanyCostSpread {
  const mode: CompanyCostSpreadMode = options.spread ?? 'calendar';
  const workingDays = options.workingDays && options.workingDays.length > 0 ? options.workingDays : DEFAULT_WORKING_DAYS;
  const parts: CompanyCostPart[] = [];
  for (const row of [...months].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))) {
    const monthCostCents = toCents(row.monthCostCents);
    if (monthCostCents <= ZERO) continue;
    const prefix = row.month.slice(0, 7);
    const daysInMonth = daysInMonthOf(row.month);
    const firstDay = from.slice(0, 7) === prefix ? Number(from.slice(8, 10)) : 1;
    const lastDay = to.slice(0, 7) === prefix ? Number(to.slice(8, 10)) : daysInMonth;
    if (from.slice(0, 7) > prefix || to.slice(0, 7) < prefix || lastDay < firstDay) continue;
    const workDaysInMonth = workDaysIn(row.month, 1, daysInMonth, workingDays);
    const workBefore = workDaysIn(row.month, 1, firstDay - 1, workingDays);
    const workDaysCounted = workDaysIn(row.month, firstDay, lastDay, workingDays);
    const spread: CompanyCostSpreadMode = mode === 'work_days' && workDaysInMonth > 0 ? 'work_days' : 'calendar';
    parts.push({
      month: row.month,
      daysCounted: lastDay - firstDay + 1,
      daysInMonth,
      workDaysCounted,
      workDaysInMonth,
      spread,
      monthCostCents,
      countedCents: spread === 'work_days' ? prorateCounted(monthCostCents, workBefore, workBefore + workDaysCounted, workDaysInMonth) : prorateDays(monthCostCents, firstDay, lastDay, daysInMonth),
      overheadAbsorbedCents: toCents(row.overheadAbsorbedCents),
    });
  }
  const companyCostCents = parts.reduce((sum, part) => sum + part.countedCents, ZERO);
  const overheadAbsorbedCents = parts.reduce((sum, part) => sum + part.overheadAbsorbedCents, ZERO);
  const countsOverhead = parts.length > 0;
  const monthsTouched = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  const monthsWithout = monthsTouched - parts.length;
  // A month counts in part when the range misses some of the days that carry a share of it.
  const isPart = (part: CompanyCostPart): boolean => (part.spread === 'work_days' ? part.workDaysCounted < part.workDaysInMonth : part.daysCounted < part.daysInMonth);
  const counted = (part: CompanyCostPart): string => (part.spread === 'work_days' ? `${part.workDaysCounted} of ${part.workDaysInMonth} work days` : `${part.daysCounted} of ${part.daysInMonth} days`);
  const anyPartMonth = parts.some(isPart);
  const partial = countsOverhead && (anyPartMonth || monthsWithout > 0);
  let note: string | null = null;
  if (partial) {
    const withYear = from.slice(0, 4) !== to.slice(0, 4);
    const sentences: string[] = [];
    if (anyPartMonth) {
      if (monthsTouched === 1) {
        sentences.push(`Company costs for ${counted(parts[0]!)}.`);
      } else if (parts.length <= 3) {
        const words = parts.map((part) => (isPart(part) ? `${counted(part)} in ${monthWord(part.month, withYear)}` : `all of ${monthWord(part.month, withYear)}`));
        sentences.push(`Company costs for ${joinWords(words)}.`);
      } else {
        const words = parts.filter(isPart).map((part) => `${counted(part)} in ${monthWord(part.month, withYear)}`);
        sentences.push(`Company costs for ${joinWords(words)}, and for each whole month between.`);
      }
    }
    if (monthsWithout > 0) {
      // Name the months only when the list is short. The count alone is enough for a long range.
      const names: string[] = [];
      if (monthsTouched <= 6) {
        const have = new Set(parts.map((part) => part.month.slice(0, 7)));
        let year = Number(from.slice(0, 4));
        let index = Number(from.slice(5, 7));
        for (let i = 0; i < monthsTouched; i += 1) {
          const key = `${String(year).padStart(4, '0')}-${String(index).padStart(2, '0')}`;
          if (!have.has(key)) names.push(monthWord(`${key}-01`, withYear));
          index += 1;
          if (index > 12) {
            index = 1;
            year += 1;
          }
        }
      }
      sentences.push(
        names.length > 0
          ? `No company costs are typed in for ${joinWords(names)}, so ${names.length === 1 ? 'that month trusts' : 'those months trust'} the overhead in your hourly rates.`
          : `${monthsWithout} ${monthsWithout === 1 ? 'month has' : 'months have'} no company costs typed in, so ${monthsWithout === 1 ? 'it trusts' : 'they trust'} the overhead in your hourly rates.`,
      );
    }
    note = sentences.join(' ');
  }
  return { spread: mode, parts, companyCostCents, overheadAbsorbedCents, countsOverhead, partial, note };
}
