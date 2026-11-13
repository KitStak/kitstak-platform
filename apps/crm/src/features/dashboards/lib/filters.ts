/**
 * Dashboard-level filter state: date range presets, people, search. Serialised to the URL so a
 * filtered dashboard can be shared by link (`?range=this_quarter&people=a,b&q=acme`).
 */
import type { InsightFilters } from '@/server/services/contracts/dashboard-insights';

export const RANGE_PRESETS = [
  'all',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'next_quarter',
  'last_30',
  'last_90',
  'next_90',
  'ytd',
  'custom',
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Readonly<Record<RangePreset, string>> = {
  all: 'All time',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  next_quarter: 'Next quarter',
  last_30: 'Last 30 days',
  last_90: 'Last 90 days',
  next_90: 'Next 90 days',
  ytd: 'Year to date',
  custom: 'Custom range',
};

export interface DashboardFilterState {
  readonly range: RangePreset;
  readonly from?: string;
  readonly to?: string;
  readonly personIds: readonly string[];
  readonly search: string;
}

export const EMPTY_FILTERS: DashboardFilterState = { range: 'all', personIds: [], search: '' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Concrete `from`/`to` (inclusive, `YYYY-MM-DD`) for a preset relative to `today`. */
export function resolveRange(state: Pick<DashboardFilterState, 'range' | 'from' | 'to'>, today: Date = new Date()): {
  from?: string;
  to?: string;
} {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const q = Math.floor(m / 3) * 3;
  const todayIso = iso(today);
  const minus = (days: number) => iso(new Date(today.getTime() - days * DAY_MS));
  const plus = (days: number) => iso(new Date(today.getTime() + days * DAY_MS));
  switch (state.range) {
    case 'all':
      return {};
    case 'this_month':
      return { from: iso(utc(y, m)), to: iso(utc(y, m + 1, 0)) };
    case 'last_month':
      return { from: iso(utc(y, m - 1)), to: iso(utc(y, m, 0)) };
    case 'this_quarter':
      return { from: iso(utc(y, q)), to: iso(utc(y, q + 3, 0)) };
    case 'last_quarter':
      return { from: iso(utc(y, q - 3)), to: iso(utc(y, q, 0)) };
    case 'next_quarter':
      return { from: iso(utc(y, q + 3)), to: iso(utc(y, q + 6, 0)) };
    case 'last_30':
      return { from: minus(29), to: todayIso };
    case 'last_90':
      return { from: minus(89), to: todayIso };
    case 'next_90':
      return { from: todayIso, to: plus(89) };
    case 'ytd':
      return { from: iso(utc(y, 0)), to: todayIso };
    case 'custom':
      return {
        ...(state.from && ISO.test(state.from) ? { from: state.from } : {}),
        ...(state.to && ISO.test(state.to) ? { to: state.to } : {}),
      };
  }
}

/** API payload for the insight endpoint. */
export function toInsightFilters(state: DashboardFilterState, today?: Date): InsightFilters {
  const range = resolveRange(state, today);
  const search = state.search.trim();
  return { ...range, personIds: [...state.personIds], ...(search ? { search } : {}) };
}

export function isFiltered(state: DashboardFilterState): boolean {
  return state.range !== 'all' || state.personIds.length > 0 || state.search.trim() !== '';
}

export function activeFilterCount(state: DashboardFilterState): number {
  return (state.range !== 'all' ? 1 : 0) + (state.personIds.length > 0 ? 1 : 0) + (state.search.trim() ? 1 : 0);
}

/** Parse URL search params (unknown values fall back to defaults). */
export function parseFilterParams(params: URLSearchParams): DashboardFilterState {
  const rawRange = params.get('range');
  const range = (RANGE_PRESETS as readonly string[]).includes(rawRange ?? '') ? (rawRange as RangePreset) : 'all';
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const personIds = (params.get('people') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
    .slice(0, 50);
  const search = (params.get('q') ?? '').slice(0, 200);
  return {
    range,
    ...(range === 'custom' && from && ISO.test(from) ? { from } : {}),
    ...(range === 'custom' && to && ISO.test(to) ? { to } : {}),
    personIds,
    search,
  };
}

/** Write filter state into existing params (other keys are preserved). */
export function writeFilterParams(state: DashboardFilterState, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of ['range', 'from', 'to', 'people', 'q']) next.delete(key);
  if (state.range !== 'all') next.set('range', state.range);
  if (state.range === 'custom') {
    if (state.from) next.set('from', state.from);
    if (state.to) next.set('to', state.to);
  }
  if (state.personIds.length > 0) next.set('people', state.personIds.join(','));
  if (state.search.trim()) next.set('q', state.search.trim());
  return next;
}

/** Human summary of the active range ("Oct 1 – Dec 31, 2026"). */
export function describeRange(state: DashboardFilterState, today?: Date): string {
  if (state.range !== 'custom') return RANGE_LABELS[state.range];
  const { from, to } = resolveRange(state, today);
  const fmt = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  if (to) return `Until ${fmt(to)}`;
  return RANGE_LABELS.custom;
}
