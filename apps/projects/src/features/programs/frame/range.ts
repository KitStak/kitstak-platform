/**
 * The builds `range` URL param (docs/programs/SPEC.md 5.7). One param drives the server window,
 * the range bar and every builds view:
 *
 *   range=today | yesterday | this-week | next-7 | last-7 | this-month    (presets)
 *   range=2026-11-25                                                        (one day)
 *   range=2026-11-23..2026-11-29                                            (custom range)
 *
 * Missing or bad values fall back to the view default (Today for Board, This week elsewhere).
 * Pure: unit tested in `range.test.ts`.
 */
import { addDays, daysBetween, endOfMonth, isRealDate, startOfMonth, startOfWeek } from '@kitstak/programs-engine';
import type { BuildView, IsoDate } from '@/lib/program-types';
import { rangeLabel } from '../kit/format';

export const RANGE_PARAM = 'range';

export const RANGE_PRESETS = ['today', 'yesterday', 'this-week', 'next-7', 'last-7', 'this-month'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Readonly<Record<RangePreset, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'next-7': 'Next 7 days',
  'last-7': 'Last 7 days',
  'this-month': 'This month',
};

export interface BuildRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** The preset the range came from, or null for a typed day or range. */
  readonly preset: RangePreset | null;
}

/** The default range of a builds view. */
export function defaultPreset(view: BuildView | null | undefined): RangePreset {
  return view === 'board' ? 'today' : 'this-week';
}

export function presetRange(preset: RangePreset, today: IsoDate): BuildRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today, preset };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day, preset };
    }
    case 'this-week': {
      const start = startOfWeek(today, 1);
      return { from: start, to: addDays(start, 6), preset };
    }
    case 'next-7':
      return { from: today, to: addDays(today, 6), preset };
    case 'last-7':
      return { from: addDays(today, -6), to: today, preset };
    case 'this-month':
      return { from: startOfMonth(today), to: endOfMonth(today), preset };
  }
}

/** Longest custom range (the builds API caps a window at about two months of builds). */
export const MAX_RANGE_DAYS = 92;

/** Reads the `range` param. Bad or reversed values fall back to the view default. */
export function parseRange(value: string | null | undefined, today: IsoDate, view?: BuildView | null): BuildRange {
  const fallback = presetRange(defaultPreset(view), today);
  if (!value) return fallback;
  if ((RANGE_PRESETS as readonly string[]).includes(value)) return presetRange(value as RangePreset, today);
  const [from, to = from] = value.split('..');
  if (!from || !isRealDate(from) || !isRealDate(to) || to < from) return fallback;
  if (dayCount(from, to) > MAX_RANGE_DAYS) return { from, to: addDays(from, MAX_RANGE_DAYS - 1), preset: null };
  return { from, to, preset: null };
}

/** The param value for a range: the preset name when it came from one, else dates. */
export function formatRange(range: Pick<BuildRange, 'from' | 'to' | 'preset'>): string {
  if (range.preset) return range.preset;
  return range.from === range.to ? range.from : `${range.from}..${range.to}`;
}

export function isOneDay(range: Pick<BuildRange, 'from' | 'to'>): boolean {
  return range.from === range.to;
}

/** Moves a one day range by `days` (the day strip arrows). Presets become typed days. */
export function shiftDay(range: Pick<BuildRange, 'from'>, days: number): BuildRange {
  const day = addDays(range.from, days);
  return { from: day, to: day, preset: null };
}

/** Moves a longer range by its own length (keeps the same number of days). */
export function shiftRange(range: Pick<BuildRange, 'from' | 'to'>, direction: 1 | -1): BuildRange {
  const days = dayCount(range.from, range.to);
  return { from: addDays(range.from, days * direction), to: addDays(range.to, days * direction), preset: null };
}

/** Days in a range, both ends counted. */
export function dayCount(from: IsoDate, to: IsoDate): number {
  return daysBetween(from, to) + 1;
}

/** "Today", "This week", or "Nov 23 to Nov 29" for the range control button. */
export function rangeButtonLabel(range: BuildRange): string {
  return range.preset ? RANGE_PRESET_LABELS[range.preset] : rangeLabel(range.from, range.to);
}
