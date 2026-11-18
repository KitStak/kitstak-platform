/**
 * The period a profit screen shows, as it lives in the URL: `?range=last_month`, or
 * `?range=custom&from=&to=`, plus `?compare=prior|last_year`. Pure: the server page and the
 * client view parse the same query the same way, so a bookmarked link opens the same numbers.
 */
import { COMPARE_MODES, RANGE_PRESETS, compareRange, resolveRange, type CompareMode, type RangePreset } from '@/lib/reports';

export interface Period {
  readonly preset: RangePreset;
  readonly from: string;
  readonly to: string;
  readonly compare: CompareMode;
  /** The days the period is compared with, or null. */
  readonly compareTo: { readonly from: string; readonly to: string } | null;
}

type Getter = (name: string) => string | null | undefined;

export interface PeriodDefaults {
  readonly preset?: RangePreset;
  readonly compare?: CompareMode;
}

/** Reads the period from a query. A `from` and `to` with no `range` count as a custom range. */
export function parsePeriod(get: Getter, today: string, weekStart: number, defaults: PeriodDefaults = {}): Period {
  const rawPreset = get('range');
  const from = get('from');
  const to = get('to');
  const preset: RangePreset = (RANGE_PRESETS as readonly string[]).includes(rawPreset ?? '') ? (rawPreset as RangePreset) : from || to ? 'custom' : (defaults.preset ?? 'this_month');
  const range = resolveRange(preset, today, weekStart, { from, to });
  const rawCompare = get('compare');
  const compare: CompareMode = (COMPARE_MODES as readonly string[]).includes(rawCompare ?? '') ? (rawCompare as CompareMode) : (defaults.compare ?? 'none');
  return { preset, from: range.from, to: range.to, compare, compareTo: compareRange(compare, range) };
}

/** The query keys of a period. Defaults are left out so plain links stay short. */
export function periodQuery(period: Pick<Period, 'preset' | 'from' | 'to' | 'compare'>, defaults: PeriodDefaults = {}): Record<string, string | undefined> {
  const custom = period.preset === 'custom';
  return {
    range: period.preset === (defaults.preset ?? 'this_month') ? undefined : period.preset,
    from: custom ? period.from : undefined,
    to: custom ? period.to : undefined,
    compare: period.compare === (defaults.compare ?? 'none') ? undefined : period.compare,
  };
}

export function searchGetter(params: Record<string, string | string[] | undefined>): Getter {
  return (name) => {
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };
}
