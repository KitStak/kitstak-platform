'use client';
/** Date range and site picker shared by the Labor and Target pace screens. */
import { useCallback, useMemo } from 'react';
import { IsoDatePicker, Select, ToggleGroup } from '@/components/ui';
import { useUrlState } from '@/features/views/use-url-state';
import { addDays, addMonths, endOfMonth, startOfMonth } from '@/lib/profit';
import type { SiteDTO } from '@/lib/types';

export type RangePreset = 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'custom';

export interface RangeState {
  readonly preset: RangePreset;
  readonly from: string;
  readonly to: string;
  readonly siteId: string | null;
}

export function presetRange(
  preset: Exclude<RangePreset, 'custom'>,
  today: string,
): { from: string; to: string } {
  if (preset === 'this_month') return { from: startOfMonth(today), to: today };
  if (preset === 'last_month') {
    const start = addMonths(startOfMonth(today), -1);
    return { from: start, to: endOfMonth(start) };
  }
  return { from: addDays(today, preset === 'last_30' ? -29 : -89), to: today };
}

const PRESET_VALUES: readonly RangePreset[] = ['this_month', 'last_month', 'last_30', 'last_90', 'custom'];
const isDay = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The picked days and site. They live in the address bar (`range`, `from`, `to`, `site`), so a
 * screen can be shared, bookmarked and kept as a saved view.
 */
export function useRange(today: string, initial: Exclude<RangePreset, 'custom'> = 'last_30') {
  const url = useUrlState();
  const rangeParam = url.get('range');
  const fromParam = url.get('from');
  const toParam = url.get('to');
  const siteId = url.get('site');
  const state = useMemo<RangeState>(() => {
    const preset = PRESET_VALUES.includes(rangeParam as RangePreset) ? (rangeParam as RangePreset) : initial;
    if (preset === 'custom') {
      const fallback = presetRange(initial, today);
      const from = isDay(fromParam) ? fromParam : fallback.from;
      const to = isDay(toParam) && toParam >= from ? toParam : from > fallback.to ? from : fallback.to;
      return { preset, from, to, siteId };
    }
    return { preset, ...presetRange(preset, today), siteId };
  }, [rangeParam, fromParam, toParam, siteId, initial, today]);
  const setState = useCallback(
    (next: RangeState) =>
      url.set({
        range: next.preset === initial ? null : next.preset,
        from: next.preset === 'custom' ? next.from : null,
        to: next.preset === 'custom' ? next.to : null,
        site: next.siteId,
      }),
    [url, initial],
  );
  return useMemo(() => ({ state, setState }), [state, setState]);
}

const PRESETS: readonly { value: RangePreset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: '30 days' },
  { value: 'last_90', label: '90 days' },
  { value: 'custom', label: 'Pick days' },
];

export function RangeBar({
  state,
  onChange,
  sites,
  today,
}: {
  readonly state: RangeState;
  readonly onChange: (next: RangeState) => void;
  readonly sites: readonly SiteDTO[];
  readonly today: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="range-bar">
      <ToggleGroup
        label="Days to show"
        value={state.preset}
        onValueChange={(preset) =>
          onChange(
            preset === 'custom' ? { ...state, preset } : { ...state, preset, ...presetRange(preset, today) },
          )
        }
        options={PRESETS}
      />
      {state.preset === 'custom' ? (
        <>
          <IsoDatePicker
            aria-label="From day"
            value={state.from}
            clearable={false}
            onChange={(value) => value && onChange({ ...state, from: value > state.to ? state.to : value })}
          />
          <span className="text-sm text-fg-muted">to</span>
          <IsoDatePicker
            aria-label="To day"
            value={state.to}
            clearable={false}
            onChange={(value) => value && onChange({ ...state, to: value < state.from ? state.from : value })}
          />
        </>
      ) : null}
      {sites.length > 1 ? (
        <Select
          aria-label="Site"
          className="w-52"
          value={state.siteId ?? 'all'}
          onValueChange={(value) => onChange({ ...state, siteId: value === 'all' ? null : value })}
          options={[
            { value: 'all', label: 'All sites' },
            ...sites.map((site) => ({ value: site.id, label: site.name })),
          ]}
        />
      ) : null}
    </div>
  );
}
