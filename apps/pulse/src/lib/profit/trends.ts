/**
 * Period over period comparison and trend helpers for tiles, sparklines and reports. Pure
 * functions. Money stays in whole cents; trend math on plain numbers is for drawing only.
 */
import { type Cents, ZERO, changeBp, marginBp } from '../money';
import type { Tone } from '../format';
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth, startOfWeek } from './calendar';
import type { IsoDate, MoneyBuckets } from './types';

export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/**
 * The range right before this one, for "vs the period before". A range that is one or more whole
 * calendar months compares with the same number of whole months before it. Any other range
 * compares with the same number of days before it.
 */
export function previousPeriod(range: DateRange): DateRange {
  const wholeMonths = range.from === startOfMonth(range.from) && range.to === endOfMonth(range.to);
  if (wholeMonths) {
    const months = (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 + Number(range.to.slice(5, 7)) - Number(range.from.slice(5, 7)) + 1;
    const from = addMonths(range.from, -months);
    return { from, to: addDays(range.from, -1) };
  }
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

/** The same range one year earlier. */
export function samePeriodLastYear(range: DateRange): DateRange {
  const wholeMonths = range.from === startOfMonth(range.from) && range.to === endOfMonth(range.to);
  const from = addMonths(range.from, -12);
  return { from, to: wholeMonths ? endOfMonth(addMonths(range.to, -12)) : addMonths(range.to, -12) };
}

/** A money number now and before. */
export interface MoneyChange {
  readonly currentCents: Cents;
  readonly previousCents: Cents | null;
  readonly deltaCents: Cents | null;
  /** Change as a share of the earlier number, in basis points. `null` when there is no earlier number or it is 0. */
  readonly changeBp: number | null;
  readonly direction: 'up' | 'down' | 'flat';
  readonly tone: Tone;
}

/** Compares a money number with the period before. `goodWhen` says which way is good. */
export function compareMoney(currentCents: Cents, previousCents: Cents | null, goodWhen: 'up' | 'down'): MoneyChange {
  if (previousCents === null) return { currentCents, previousCents: null, deltaCents: null, changeBp: null, direction: 'flat', tone: 'neutral' };
  const deltaCents = currentCents - previousCents;
  const direction = deltaCents > ZERO ? 'up' : deltaCents < ZERO ? 'down' : 'flat';
  return {
    currentCents,
    previousCents,
    deltaCents,
    changeBp: changeBp(currentCents, previousCents),
    direction,
    tone: direction === 'flat' ? 'neutral' : (direction === 'up') === (goodWhen === 'up') ? 'good' : 'bad',
  };
}

/** A plain number now and before (units, hours, pace, or a margin in basis points). */
export interface NumberChange {
  readonly current: number | null;
  readonly previous: number | null;
  readonly delta: number | null;
  /** Change as a share of the earlier number, in basis points. `null` when it cannot be worked out. */
  readonly changeBp: number | null;
  readonly direction: 'up' | 'down' | 'flat';
  readonly tone: Tone;
}

/** Compares a plain number with the period before. For margins, read `delta` as points x 100. */
export function compareNumber(current: number | null, previous: number | null, goodWhen: 'up' | 'down'): NumberChange {
  if (current === null || previous === null) return { current, previous, delta: null, changeBp: null, direction: 'flat', tone: 'neutral' };
  const delta = current - previous;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const ratio = previous === 0 ? null : Math.round((delta / Math.abs(previous)) * 10000);
  return {
    current,
    previous,
    delta,
    changeBp: ratio === null || Math.abs(ratio) > 1_000_000 ? null : ratio,
    direction,
    tone: direction === 'flat' ? 'neutral' : (direction === 'up') === (goodWhen === 'up') ? 'good' : 'bad',
  };
}

export interface PeriodComparison {
  readonly revenue: MoneyChange;
  readonly cost: MoneyChange;
  readonly labor: MoneyChange;
  readonly material: MoneyChange;
  readonly other: MoneyChange;
  readonly shared: MoneyChange;
  readonly profit: MoneyChange;
  /** Margin in basis points. `delta` is the change in points x 100. */
  readonly margin: NumberChange;
}

function costOf(buckets: MoneyBuckets): Cents {
  return buckets.laborCents + buckets.materialCents + buckets.otherCents + buckets.sharedCents;
}

/** Compares the money of one period with the period before, line by line, with a tone for each. */
export function comparePeriods(current: MoneyBuckets, previous: MoneyBuckets | null): PeriodComparison {
  const currentCost = costOf(current);
  const previousCost = previous ? costOf(previous) : null;
  const currentProfit = current.revenueCents - currentCost;
  const previousProfit = previous && previousCost !== null ? previous.revenueCents - previousCost : null;
  return {
    revenue: compareMoney(current.revenueCents, previous ? previous.revenueCents : null, 'up'),
    cost: compareMoney(currentCost, previousCost, 'down'),
    labor: compareMoney(current.laborCents, previous ? previous.laborCents : null, 'down'),
    material: compareMoney(current.materialCents, previous ? previous.materialCents : null, 'down'),
    other: compareMoney(current.otherCents, previous ? previous.otherCents : null, 'down'),
    shared: compareMoney(current.sharedCents, previous ? previous.sharedCents : null, 'down'),
    profit: compareMoney(currentProfit, previousProfit, 'up'),
    margin: compareNumber(marginBp(currentProfit, current.revenueCents), previous && previousProfit !== null ? marginBp(previousProfit, previous.revenueCents) : null, 'up'),
  };
}

export type TrendBucket = 'day' | 'week' | 'month';

/** The first day of the day, week or month that holds a date. */
export function bucketStart(date: IsoDate, bucket: TrendBucket, weekStart = 1): IsoDate {
  if (bucket === 'day') return date;
  return bucket === 'week' ? startOfWeek(date, weekStart) : startOfMonth(date);
}

/** Every bucket start from `from` to `to`, oldest first, so a chart has no holes. */
export function bucketStarts(range: DateRange, bucket: TrendBucket, weekStart = 1): IsoDate[] {
  const out: IsoDate[] = [];
  let cursor = bucketStart(range.from, bucket, weekStart);
  while (cursor <= range.to) {
    out.push(cursor);
    cursor = bucket === 'day' ? addDays(cursor, 1) : bucket === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1);
  }
  return out;
}

/** Picks a bucket size that keeps a chart readable: days up to 31 days, weeks up to 26 weeks, months after that. */
export function suggestBucket(range: DateRange): TrendBucket {
  const days = daysBetween(range.from, range.to) + 1;
  return days <= 31 ? 'day' : days <= 182 ? 'week' : 'month';
}

/**
 * Sums dated money rows into buckets, with a zero for every bucket that has no row.
 * The bucket totals add up to the row total to the cent.
 */
export function moneySeries<T>(rows: readonly T[], range: DateRange, bucket: TrendBucket, pick: (row: T) => { date: IsoDate; cents: Cents }, weekStart = 1): { start: IsoDate; cents: Cents }[] {
  const starts = bucketStarts(range, bucket, weekStart);
  const totals = new Map<string, Cents>(starts.map((start) => [start, ZERO]));
  for (const row of rows) {
    const { date, cents } = pick(row);
    if (date < range.from || date > range.to) continue;
    const key = bucketStart(date, bucket, weekStart);
    totals.set(key, (totals.get(key) ?? ZERO) + cents);
  }
  return starts.map((start) => ({ start, cents: totals.get(start) ?? ZERO }));
}

/** Running total of a money series. */
export function runningTotal(values: readonly Cents[]): Cents[] {
  let total = ZERO;
  return values.map((value) => {
    total += value;
    return total;
  });
}

/** Moving average over the last `size` points. Early points average what exists so far. `null` points are skipped. */
export function movingAverage(values: readonly (number | null)[], size: number): (number | null)[] {
  const span = Math.max(1, Math.trunc(size));
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - span + 1); i <= index; i += 1) {
      const value = values[i];
      if (value !== null && value !== undefined) {
        sum += value;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  });
}

export interface TrendLine {
  /** Change for each step along the series. */
  readonly slope: number;
  readonly intercept: number;
  /** `up`, `down` or `flat`: flat when the fitted line moves less than `flatBp` of the average over the series. */
  readonly direction: 'up' | 'down' | 'flat';
  /** The fitted value for the step after the last one. */
  readonly next: number;
  readonly points: number;
}

/**
 * Least squares line through a series, for a trend arrow and a simple next step guess.
 * `null` with fewer than 2 points. `flatBp` (default 200, which is 2%) is how small a move counts as flat.
 */
export function trendLine(values: readonly (number | null)[], flatBp = 200): TrendLine | null {
  const points: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value !== null && Number.isFinite(value)) points.push({ x: index, y: value });
  });
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  let top = 0;
  let bottom = 0;
  for (const point of points) {
    top += (point.x - meanX) * (point.y - meanY);
    bottom += (point.x - meanX) ** 2;
  }
  const slope = bottom === 0 ? 0 : top / bottom;
  const intercept = meanY - slope * meanX;
  const span = (points[n - 1] as { x: number }).x - (points[0] as { x: number }).x;
  const move = slope * span;
  const scale = Math.abs(meanY) > 0 ? Math.abs(meanY) : 1;
  const direction = Math.abs(move) / scale < flatBp / 10000 ? 'flat' : move > 0 ? 'up' : 'down';
  return { slope, intercept, direction, next: intercept + slope * values.length, points: n };
}

/** A series scaled into 0 to 1 for a sparkline. A flat series sits at 0.5. `null` points stay `null`. */
export function sparkline(values: readonly (number | null)[]): (number | null)[] {
  const real = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (real.length === 0) return values.map(() => null);
  const min = Math.min(...real);
  const max = Math.max(...real);
  return values.map((value) => (value === null || !Number.isFinite(value) ? null : max === min ? 0.5 : (value - min) / (max - min)));
}

/** The best and the worst point of a series with their positions. `null` when the series is empty. */
export function bestAndWorst(values: readonly (number | null)[]): { best: { index: number; value: number }; worst: { index: number; value: number } } | null {
  let best: { index: number; value: number } | null = null;
  let worst: { index: number; value: number } | null = null;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    if (!best || value > best.value) best = { index, value };
    if (!worst || value < worst.value) worst = { index, value };
  });
  return best && worst ? { best, worst } : null;
}

/** How many points in a row, counted from the end, moved the same way. Good for "up 4 weeks in a row". */
export function streak(values: readonly number[]): { direction: 'up' | 'down' | 'flat'; length: number } {
  if (values.length < 2) return { direction: 'flat', length: 0 };
  const sign = (i: number): number => Math.sign((values[i] as number) - (values[i - 1] as number));
  const last = sign(values.length - 1);
  if (last === 0) return { direction: 'flat', length: 0 };
  let length = 0;
  for (let i = values.length - 1; i >= 1 && sign(i) === last; i -= 1) length += 1;
  return { direction: last > 0 ? 'up' : 'down', length };
}
