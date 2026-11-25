/**
 * Month charges (docs/programs/SPEC.md 3.5). One pure function turns a program month's inputs
 * (output snapshots, finished builds, time, one time charges and the published card versions)
 * into every line item of the month, with one rounding step per line. The ledger (A13), the
 * statement, the rollups and the Pulse sync all read what this returns, so every app shows the
 * same cents.
 */
import { accrueDay, minutesToHours } from './accrual';
import { activeRange, daysInMonth, eachDay, isPausedOn, isRealDate, isRealMonth, lastDayOfMonth, maxDate, monthOf } from './calendar';
import { formatQty, formatUnitPrice } from './format';
import { type Cents, ZERO, allocate, divRound, fromScaled, mulHoursRate, quantityToScaled, toCents } from './money';
import { isUsableLine, resolveHourRate, resolveOrderCharge, versionFor } from './price';
import { type DayRollup, type VariantRollup, rollupByDay, rollupByVariant } from './rollup';
import type { CardLine, CardVersion, ChargeKind, FinishedBuild, IsoDate, IsoMonth, LedgerKind, LedgerRow, OneTimeCharge, OutputRow, ProgramCalendar, TimeDay } from './types';

const HUNDRED = BigInt(100);

export interface MonthInput {
  readonly programId: string;
  readonly month: IsoMonth;
  /** Today in the program time zone. */
  readonly asOf: IsoDate;
  readonly calendar: ProgramCalendar;
  /** Published only. */
  readonly versions: readonly CardVersion[];
  /** Live rows of live builds with `work_date` in the month. */
  readonly output: readonly OutputRow[];
  /** Live, not cancelled builds with `finished_on` in the month. */
  readonly finished: readonly FinishedBuild[];
  /** Minutes per day per task in the program time zone (filters in 3.14). */
  readonly time: readonly TimeDay[];
  /** Live setup fees and adjustments with `charge_on` in the month. */
  readonly oneTime: readonly OneTimeCharge[];
}

export interface Charge {
  /** Stable, 3.6. */
  readonly ref: string;
  readonly kind: ChargeKind;
  readonly date: IsoDate;
  readonly cents: Cents;
  /** Units, hours or null. */
  readonly quantity: string | null;
  /** Dollars, 4 decimals. */
  readonly unitPrice: string | null;
  readonly variantId: string | null;
  readonly buildId: string | null;
  readonly versionId: string | null;
  readonly lineId: string | null;
  readonly oneTimeId: string | null;
  /** Statement text. */
  readonly label: string;
  readonly countsTowardMinimum: boolean;
  /** False only for the current month's minimum preview. */
  readonly posted: boolean;
}

/** One variant's share of one day's per hour charge (null variant is program level time). */
export interface HourSplit {
  readonly date: IsoDate;
  readonly variantId: string | null;
  readonly minutes: number;
  readonly cents: Cents;
}

export type MinimumStatus = 'none' | 'met' | 'short' | 'pending';

export interface MonthResult {
  readonly month: IsoMonth;
  /** Sum of qty, 3 decimals. */
  readonly units: string;
  readonly work: { readonly perUnitCents: Cents; readonly perOrderCents: Cents; readonly perHourCents: Cents; readonly totalCents: Cents };
  readonly fixed: { readonly monthlyFeeCents: Cents; readonly setupCents: Cents; readonly totalCents: Cents };
  readonly adjustments: { readonly totalCents: Cents; readonly towardMinimumCents: Cents };
  readonly minimum: { readonly minimumCents: Cents; readonly gapSoFarCents: Cents; readonly topUpCents: Cents; readonly status: MinimumStatus };
  /** Work + fixed + adjustments + posted top up. */
  readonly totalCents: Cents;
  /** Every line item, per unit charges one per build day. */
  readonly charges: readonly Charge[];
  /** Each day's per hour charge split over variants by minutes (largest remainder), so the split adds back exactly. */
  readonly hourSplits: readonly HourSplit[];
  readonly byVariant: readonly VariantRollup[];
  readonly byDay: readonly DayRollup[];
  /** Units with price source `none`. */
  readonly unpricedUnits: string;
}

/* ------------------------------------------------------------------------------------------ */
/* Stable refs (3.6)                                                                          */
/* ------------------------------------------------------------------------------------------ */

/** Ref of one build day (`pm.build_output`, Pulse `production_entries`). */
export function buildDayRef(buildId: string, workDate: IsoDate): string {
  return `pmb:${buildId}:${workDate}`;
}

/** Refs of program fees in the ledger (and Pulse `revenue_entries`). */
export const feeRef = {
  order: (programId: string, buildId: string): string => `pmf:${programId}:order:${buildId}`,
  hours: (programId: string, workDate: IsoDate): string => `pmf:${programId}:hours:${workDate}`,
  monthly: (programId: string, month: IsoMonth): string => `pmf:${programId}:monthly:${month}`,
  setup: (programId: string, chargeId: string): string => `pmf:${programId}:setup:${chargeId}`,
  adjustment: (programId: string, chargeId: string): string => `pmf:${programId}:adj:${chargeId}`,
  minimum: (programId: string, month: IsoMonth): string => `pmf:${programId}:minimum:${month}`,
} as const;

/** Refs of program labor rows in Pulse (hours only, never money). */
export const laborRef = {
  task: (programId: string, taskId: string, workDate: IsoDate): string => `pmt:${programId}:${taskId}:${workDate}`,
  program: (programId: string, workDate: IsoDate): string => `pmt:${programId}:program:${workDate}`,
} as const;

/** What a ref points at. Null for anything that is not a program ref. */
export type ParsedRef =
  | { readonly kind: 'build_day'; readonly buildId: string; readonly date: IsoDate }
  | { readonly kind: 'order'; readonly programId: string; readonly buildId: string }
  | { readonly kind: 'hours'; readonly programId: string; readonly date: IsoDate }
  | { readonly kind: 'monthly'; readonly programId: string; readonly month: IsoMonth }
  | { readonly kind: 'setup'; readonly programId: string; readonly chargeId: string }
  | { readonly kind: 'adjustment'; readonly programId: string; readonly chargeId: string }
  | { readonly kind: 'minimum'; readonly programId: string; readonly month: IsoMonth }
  | { readonly kind: 'labor'; readonly programId: string; readonly taskId: string | null; readonly date: IsoDate };

/** Reads a `pmb:`, `pmf:` or `pmt:` ref back into its parts. */
export function parseRef(ref: string): ParsedRef | null {
  const parts = ref.split(':');
  const [head, a, b, c] = parts;
  if (head === 'pmb' && parts.length === 3 && a && b) return { kind: 'build_day', buildId: a, date: b };
  if (head === 'pmt' && parts.length === 4 && a && b && c) return { kind: 'labor', programId: a, taskId: b === 'program' ? null : b, date: c };
  if (head !== 'pmf' || parts.length !== 4 || !a || !c) return null;
  switch (b) {
    case 'order':
      return { kind: 'order', programId: a, buildId: c };
    case 'hours':
      return { kind: 'hours', programId: a, date: c };
    case 'monthly':
      return { kind: 'monthly', programId: a, month: c };
    case 'setup':
      return { kind: 'setup', programId: a, chargeId: c };
    case 'adj':
      return { kind: 'adjustment', programId: a, chargeId: c };
    case 'minimum':
      return { kind: 'minimum', programId: a, month: c };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Fixed lines                                                                                */
/* ------------------------------------------------------------------------------------------ */

export interface FixedSegment {
  readonly versionId: string;
  readonly lineId: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Days of the segment that charge (a paused day counts only when the line charges while paused). */
  readonly days: number;
  readonly cents: Cents;
}

function fixedLineOf(version: CardVersion, kind: 'flat_monthly' | 'monthly_minimum'): CardLine | null {
  return version.lines.find((line) => line.kind === kind && isUsableLine(line)) ?? null;
}

/**
 * True when a fixed line in force on `date` charges that day: always on a day the program is not
 * paused, and on a paused day only when the line has "Charge while paused" on. A day with no
 * line charges when it is not paused (it still holds its place in the month, so a fee that
 * starts on the 16th charges half a month).
 */
function chargesOn(calendar: ProgramCalendar, date: IsoDate, line: CardLine | null): boolean {
  if (!isPausedOn(calendar, date)) return true;
  return line !== null && line.chargeWhilePaused;
}

/**
 * A monthly fee or monthly minimum for one month (3.5 step 5, A6). The active days of the month
 * are cut into segments where the same version is in force and has the line. A segment's `d` is
 * the days of it that charge (`chargesOn`). Its exact share of a month is `a * d / D` when its
 * line charges part of a partial month (`prorate`, `D` the days of the month) and `a * d / N`
 * when it does not, where `N` is one frame for every such segment: the active days that charge
 * under the line in force that day. Every charged day belongs to one segment only, and
 * `N <= D`, so the shares can never add up to more than one month of the largest amount.
 *
 * The month is rounded once (`divRound` of the exact sum), then split over the segments by the
 * largest remainder (`money.allocate`), so the segments add back to the month to the cent. One
 * version all month, or any number of versions at the same amount over a whole month, gives
 * exactly `a`; mixed amounts and options give at most the largest amount.
 */
export function fixedLineForMonth(input: { readonly month: IsoMonth; readonly calendar: ProgramCalendar; readonly versions: readonly CardVersion[]; readonly kind: 'flat_monthly' | 'monthly_minimum' }): { cents: Cents; segments: readonly FixedSegment[] } {
  const range = activeRange(input.calendar, input.month);
  if (!range) return { cents: ZERO, segments: [] };
  const monthDays = BigInt(daysInMonth(input.month));

  interface Run {
    version: CardVersion;
    line: CardLine;
    from: IsoDate;
    to: IsoDate;
    days: number;
  }
  const runs: Run[] = [];
  let current: Run | null = null;
  /** The frame `N` of every segment whose line does not charge part of a partial month. */
  let chargedDays = 0;
  for (const date of eachDay(range.from, range.to)) {
    const version = versionFor(input.versions, date);
    const line = version ? fixedLineOf(version, input.kind) : null;
    const charges = chargesOn(input.calendar, date, line);
    if (charges) chargedDays += 1;
    if (!version || !line) {
      current = null;
      continue;
    }
    if (!current || current.version.id !== version.id || current.line.id !== line.id) {
      current = { version, line, from: date, to: date, days: 0 };
      runs.push(current);
    }
    current.to = date;
    if (charges) current.days += 1;
  }

  const kept = runs.filter((run) => run.days > 0);
  if (kept.length === 0) return { cents: ZERO, segments: [] };
  // Exact shares over one common denominator: a * d / D is a * d * N / (D * N), and a * d / N is a * d * D / (D * N).
  const frame = BigInt(chargedDays);
  const denominator = monthDays * frame;
  const weights = kept.map((run) => toCents(run.line.amountCents as string) * BigInt(run.days) * (run.line.prorate ? frame : monthDays));
  const exact = weights.reduce((total, weight) => total + weight, ZERO);
  const cents = divRound(exact, denominator);
  const parts = allocate(cents, weights);
  const segments: FixedSegment[] = kept.map((run, index) => ({ versionId: run.version.id, lineId: run.line.id, from: run.from, to: run.to, days: run.days, cents: parts[index] as Cents }));
  return { cents, segments };
}

/* ------------------------------------------------------------------------------------------ */
/* Month charges                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** The per unit revenue of an output row from its own qty and price. Equal to the snapshot (asserted in tests and the Pulse parity check). */
export function accrueRow(row: Pick<OutputRow, 'qty' | 'unitPrice'>): Cents {
  return accrueDay(row.qty, row.unitPrice);
}

/** Whole cents to a 4 decimal dollar string: 4500 becomes "45.0000". */
function centsAsPrice(cents: Cents): string {
  return fromScaled(cents * HUNDRED, 4);
}

function sumQty(values: Iterable<string>): bigint {
  let total = ZERO;
  for (const value of values) total += quantityToScaled(value);
  return total;
}

/**
 * Refuses a clock or a period that is not a real date or month before any math, so a bad
 * `asOf` can never mark a month over (and post a minimum top up) by string comparison.
 */
export function assertMonthClock(input: { readonly month: unknown; readonly asOf: unknown }): void {
  if (!isRealDate(input.asOf)) throw new RangeError(`Not a YYYY-MM-DD date: "${String(input.asOf)}"`);
  if (!isRealMonth(input.month)) throw new RangeError(`Not a YYYY-MM month: "${String(input.month)}"`);
}

/**
 * Checks that no two input rows of a month would make the same ref: one output row per build
 * per work date, one finished row per build, one one time charge per id. The ledger keys rows
 * by ref, so a repeat would double the cents or break the write. Throws a RangeError naming the ref.
 */
function assertUniqueInputs(input: MonthInput): void {
  const seen = new Set<string>();
  const once = (ref: string): void => {
    if (seen.has(ref)) throw new RangeError(`Duplicate charge ref ${ref}`);
    seen.add(ref);
  };
  for (const row of input.output) once(buildDayRef(row.buildId, row.workDate));
  for (const build of input.finished) once(feeRef.order(input.programId, build.buildId));
  for (const charge of input.oneTime) once(charge.kind === 'setup' ? feeRef.setup(input.programId, charge.id) : feeRef.adjustment(input.programId, charge.id));
  // A setup fee and an adjustment can never share one charge id either.
  const ids = new Set<string>();
  for (const charge of input.oneTime) {
    if (ids.has(charge.id)) throw new RangeError(`Duplicate charge ref ${feeRef.setup(input.programId, charge.id)}`);
    ids.add(charge.id);
  }
}

/**
 * Every charge of one program month (3.5). Throws a RangeError when `asOf` is not a real date,
 * `month` is not a real month, or two inputs would make the same ref.
 */
export function monthCharges(input: MonthInput): MonthResult {
  assertMonthClock(input);
  assertUniqueInputs(input);
  const { programId, month, asOf, calendar, versions } = input;
  const monthEnd = lastDayOfMonth(month);
  const range = activeRange(calendar, month);
  const inMonth = (date: IsoDate): boolean => monthOf(date) === month;
  const charges: Charge[] = [];

  // 2. Per unit: the stored snapshot of each build day.
  const output = input.output.filter((row) => inMonth(row.workDate));
  let perUnitCents = ZERO;
  for (const row of output) {
    const cents = toCents(row.revenueCents);
    perUnitCents += cents;
    charges.push({
      ref: buildDayRef(row.buildId, row.workDate),
      kind: 'per_unit',
      date: row.workDate,
      cents,
      quantity: row.qty,
      unitPrice: row.unitPrice,
      variantId: row.variantId,
      buildId: row.buildId,
      versionId: row.versionId,
      lineId: null,
      oneTimeId: null,
      label: row.priceSource === 'none' ? `Built ${formatQty(row.qty)} · No price` : `Built ${formatQty(row.qty)} at ${formatUnitPrice(row.unitPrice)}`,
      countsTowardMinimum: true,
      posted: true,
    });
  }
  const units = fromScaled(sumQty(output.map((row) => row.qty)), 3);
  const unpricedUnits = fromScaled(sumQty(output.filter((row) => row.priceSource === 'none').map((row) => row.qty)), 3);

  // 3. Per batch: once per finished build that has output.
  let perOrderCents = ZERO;
  for (const build of input.finished) {
    if (!inMonth(build.finishedOn) || build.finishedOn > asOf) continue;
    if (quantityToScaled(build.builtQty) <= ZERO) continue;
    const order = resolveOrderCharge(versions, build.variantId, build.finishedOn);
    // A $0 batch line charges nothing, so it makes no line on the statement or in Pulse.
    if (!order || order.amountCents === ZERO) continue;
    const line = versionFor(versions, build.finishedOn)?.lines.find((row) => row.id === order.lineId);
    perOrderCents += order.amountCents;
    charges.push({
      ref: feeRef.order(programId, build.buildId),
      kind: 'per_order',
      date: build.finishedOn,
      cents: order.amountCents,
      quantity: '1',
      unitPrice: centsAsPrice(order.amountCents),
      variantId: build.variantId,
      buildId: build.buildId,
      versionId: order.versionId,
      lineId: order.lineId,
      oneTimeId: null,
      label: `${line?.label?.trim() || 'Batch fee'} · ${build.buildKey}`,
      countsTowardMinimum: true,
      posted: true,
    });
  }

  // 4. Per hour: hours rounded once per day, then split over variants by minutes.
  const minutesByDay = new Map<IsoDate, Map<string | null, number>>();
  for (const entry of input.time) {
    if (!inMonth(entry.workDate) || entry.workDate > asOf || !(entry.minutes > 0)) continue;
    let day = minutesByDay.get(entry.workDate);
    if (!day) {
      day = new Map();
      minutesByDay.set(entry.workDate, day);
    }
    day.set(entry.variantId, (day.get(entry.variantId) ?? 0) + entry.minutes);
  }
  let perHourCents = ZERO;
  const hourSplits: HourSplit[] = [];
  for (const date of [...minutesByDay.keys()].sort()) {
    const day = minutesByDay.get(date) as Map<string | null, number>;
    const variants = [...day.entries()].sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1));
    const dayMinutes = variants.reduce((sum, [, minutes]) => sum + minutes, 0);
    if (dayMinutes <= 0) continue;
    const rate = resolveHourRate(versions, date);
    if (!rate) continue;
    const hours = minutesToHours(dayMinutes);
    const cents = mulHoursRate(hours, rate.rateCents);
    // A $0 hourly rate (or hours that round to 0) charges nothing: no line, no split.
    if (cents === ZERO) continue;
    perHourCents += cents;
    const parts = allocate(cents, variants.map(([, minutes]) => BigInt(minutes)));
    variants.forEach(([variantId, minutes], index) => hourSplits.push({ date, variantId, minutes, cents: parts[index] as Cents }));
    const only = variants.length === 1 ? (variants[0] as [string | null, number])[0] : null;
    const line = versionFor(versions, date)?.lines.find((row) => row.id === rate.lineId);
    charges.push({
      ref: feeRef.hours(programId, date),
      kind: 'per_hour',
      date,
      cents,
      quantity: hours,
      unitPrice: centsAsPrice(BigInt(rate.rateCents)),
      variantId: only,
      buildId: null,
      versionId: rate.versionId,
      lineId: rate.lineId,
      oneTimeId: null,
      label: `${line?.label?.trim() || 'Hourly work'} · ${hours} h`,
      countsTowardMinimum: true,
      posted: true,
    });
  }

  // 5. Monthly fee, dated the first day a fee version is in force (the first active day when
  // one is in force on the 1st), and posted once that day has come, so month to date never
  // counts a fee from a version that is not in force yet (M3).
  const fee = fixedLineForMonth({ month, calendar, versions, kind: 'flat_monthly' });
  let monthlyFeeCents = ZERO;
  const first = fee.segments[0];
  const feeDate = range && first ? maxDate(range.from, first.from) : null;
  if (feeDate && first && fee.cents !== ZERO && asOf >= feeDate) {
    monthlyFeeCents = fee.cents;
    const line = versions.find((version) => version.id === first.versionId)?.lines.find((row) => row.id === first.lineId);
    charges.push({
      ref: feeRef.monthly(programId, month),
      kind: 'flat_monthly',
      date: feeDate,
      cents: fee.cents,
      quantity: null,
      unitPrice: null,
      variantId: null,
      buildId: null,
      versionId: first.versionId,
      lineId: first.lineId,
      oneTimeId: null,
      label: line?.label?.trim() || 'Monthly fee',
      countsTowardMinimum: false,
      posted: true,
    });
  }

  // 6. One time charges: setup fees and adjustments, once each, on their own date.
  let setupCents = ZERO;
  let adjustmentCents = ZERO;
  let towardMinimumCents = ZERO;
  for (const charge of input.oneTime) {
    if (!inMonth(charge.chargeOn) || charge.chargeOn > asOf) continue;
    const cents = toCents(charge.amountCents);
    // A $0 setup fee or adjustment changes nothing, so it makes no line.
    if (cents === ZERO) continue;
    const setup = charge.kind === 'setup';
    if (setup) setupCents += cents;
    else {
      adjustmentCents += cents;
      if (charge.countsTowardMinimum) towardMinimumCents += cents;
    }
    charges.push({
      ref: setup ? feeRef.setup(programId, charge.id) : feeRef.adjustment(programId, charge.id),
      kind: setup ? 'setup' : 'adjustment',
      date: charge.chargeOn,
      cents,
      quantity: null,
      unitPrice: null,
      variantId: charge.variantId,
      buildId: null,
      versionId: null,
      lineId: null,
      oneTimeId: charge.id,
      label: charge.label.trim() || (setup ? 'Setup fee' : 'Adjustment'),
      countsTowardMinimum: setup ? false : charge.countsTowardMinimum,
      posted: true,
    });
  }

  // 7. Minimum: the gap so far during the month, the top up once the month is over.
  const minimum = fixedLineForMonth({ month, calendar, versions, kind: 'monthly_minimum' });
  const workTotal = perUnitCents + perOrderCents + perHourCents;
  let status: MinimumStatus = 'none';
  let gapSoFarCents = ZERO;
  let topUpCents = ZERO;
  if (range && minimum.segments.length > 0) {
    const forMinimum = workTotal + towardMinimumCents;
    gapSoFarCents = minimum.cents > forMinimum ? minimum.cents - forMinimum : ZERO;
    const over = asOf > monthEnd;
    if (over) {
      topUpCents = gapSoFarCents;
      status = topUpCents > ZERO ? 'short' : 'met';
    } else status = 'pending';
    if (gapSoFarCents > ZERO) {
      const last = minimum.segments[minimum.segments.length - 1] as FixedSegment;
      charges.push({
        ref: feeRef.minimum(programId, month),
        kind: 'minimum_top_up',
        date: range.to,
        cents: gapSoFarCents,
        quantity: null,
        unitPrice: null,
        variantId: null,
        buildId: null,
        versionId: last.versionId,
        lineId: last.lineId,
        oneTimeId: null,
        label: 'Minimum top up',
        countsTowardMinimum: false,
        posted: over,
      });
    }
  }

  const refs = new Set<string>();
  for (const charge of charges) {
    if (refs.has(charge.ref)) throw new RangeError(`Duplicate charge ref ${charge.ref}`);
    refs.add(charge.ref);
  }

  const fixedTotal = monthlyFeeCents + setupCents;
  const base: Omit<MonthResult, 'byVariant' | 'byDay'> = {
    month,
    units,
    work: { perUnitCents, perOrderCents, perHourCents, totalCents: workTotal },
    fixed: { monthlyFeeCents, setupCents, totalCents: fixedTotal },
    adjustments: { totalCents: adjustmentCents, towardMinimumCents },
    minimum: { minimumCents: minimum.cents, gapSoFarCents, topUpCents, status },
    totalCents: workTotal + fixedTotal + adjustmentCents + topUpCents,
    charges: sortCharges(charges),
    hourSplits,
    unpricedUnits,
  };
  return { ...base, byVariant: rollupByVariant(base), byDay: rollupByDay(base, []) };
}

const KIND_ORDER: Readonly<Record<ChargeKind, number>> = { per_unit: 0, per_order: 1, per_hour: 2, flat_monthly: 3, setup: 4, adjustment: 5, minimum_top_up: 6 };

/** Charges in statement order: date, then kind, then ref. */
function sortCharges(charges: Charge[]): Charge[] {
  return charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)));
}

/**
 * The posted fee rows of a month for `pm.program_ledger`: every posted charge except per unit
 * (3.5). A charge of 0 cents is never a ledger row (and so never a $0.00 Pulse revenue row).
 */
export function ledgerRows(result: Pick<MonthResult, 'charges'>): LedgerRow[] {
  return result.charges
    .filter((charge) => charge.posted && charge.kind !== 'per_unit' && charge.cents !== ZERO)
    .map((charge) => ({
      ref: charge.ref,
      kind: charge.kind as LedgerKind,
      chargeDate: charge.date,
      cents: charge.cents,
      quantity: charge.quantity,
      unitPrice: charge.unitPrice,
      variantId: charge.variantId,
      buildId: charge.buildId,
      versionId: charge.versionId,
      lineId: charge.lineId,
      oneTimeId: charge.oneTimeId,
      label: charge.label,
      countsTowardMinimum: charge.countsTowardMinimum,
    }));
}

/** The words for a minimum status (UI copy). */
export function minimumStatusLabel(status: MinimumStatus): string {
  switch (status) {
    case 'none':
      return 'No minimum';
    case 'met':
      return 'Minimum met';
    case 'short':
      return 'Below minimum';
    case 'pending':
      return 'Month still open';
  }
}
