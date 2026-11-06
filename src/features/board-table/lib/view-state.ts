/**
 * Table view state: what the board table applies on top of the raw board payload (filters,
 * sort, hidden / collapsed columns, widths, search, person filter, density). Persisted in the
 * view's `config` jsonb (see `viewConfigSchema`); `search` is transient.
 *
 * Pure and client-safe.
 */
import type { CellDensity } from '@/features/cells';
import { treeHasRules } from '@/lib/filter-tree';

export const FILTER_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'before',
  'after',
  'any_of',
  'none_of',
  // Compiled by `@/lib/filter-tree` (number equals / not equals / range, relative dates).
  'eq',
  'neq',
  'range',
  'within',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterRule {
  readonly columnKey: string;
  readonly operator: FilterOperator;
  readonly value?: unknown;
}

export interface FilterGroup {
  readonly conjunction: 'and' | 'or';
  readonly rules: readonly FilterRule[];
  /** Nested condition groups (see `@/lib/filter-tree`). */
  readonly groups?: readonly FilterGroup[];
}

export interface SortRule {
  readonly columnKey: string;
  readonly direction: 'asc' | 'desc';
}

export interface TableViewState {
  readonly filters: FilterGroup;
  readonly sort: readonly SortRule[];
  readonly hiddenColumnKeys: readonly string[];
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly collapsedColumnKeys: readonly string[];
  readonly search: string;
  readonly personFilter: string | null;
  readonly density: CellDensity;
}

export const EMPTY_FILTERS: FilterGroup = { conjunction: 'and', rules: [] };

export const DEFAULT_VIEW_STATE: TableViewState = {
  filters: EMPTY_FILTERS,
  sort: [],
  hiddenColumnKeys: [],
  columnWidths: {},
  collapsedColumnKeys: [],
  search: '',
  personFilter: null,
  density: 'default',
};

const OPERATOR_SET: ReadonlySet<string> = new Set(FILTER_OPERATORS);
const MIN_WIDTH = 40;
const MAX_WIDTH = 1_200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseFilters(value: unknown, depth = 0): FilterGroup {
  if (!isRecord(value)) return EMPTY_FILTERS;
  const rules = Array.isArray(value.rules)
    ? value.rules.flatMap((rule): FilterRule[] => {
        if (!isRecord(rule) || typeof rule.columnKey !== 'string' || !OPERATOR_SET.has(String(rule.operator)))
          return [];
        return [{ columnKey: rule.columnKey, operator: rule.operator as FilterOperator, value: rule.value }];
      })
    : [];
  const conjunction = value.conjunction === 'or' ? 'or' : 'and';
  const groups =
    depth < 2 && Array.isArray(value.groups) ? value.groups.filter(isRecord).map((entry) => parseFilters(entry, depth + 1)) : [];
  return groups.length ? { conjunction, rules, groups } : { conjunction, rules };
}

function parseSort(value: unknown): SortRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rule): SortRule[] =>
    isRecord(rule) && typeof rule.columnKey === 'string'
      ? [{ columnKey: rule.columnKey, direction: rule.direction === 'desc' ? 'desc' : 'asc' }]
      : [],
  );
}

function parseWidths(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, width] of Object.entries(value)) {
    if (typeof width === 'number' && Number.isFinite(width)) out[key] = clampWidth(width);
  }
  return out;
}

function parseDensity(value: unknown): CellDensity {
  return value === 'compact' || value === 'comfortable' ? value : 'default';
}

export function clampWidth(width: number, min = MIN_WIDTH): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(min, width)));
}

/** Read a (possibly malformed) view config into a complete, safe state object. */
export function parseViewConfig(config: unknown, transient: { search?: string } = {}): TableViewState {
  const source = isRecord(config) ? config : {};
  return {
    filters: parseFilters(source.filters),
    sort: parseSort(source.sort),
    hiddenColumnKeys: stringArray(source.hiddenColumnKeys),
    columnWidths: parseWidths(source.columnWidths),
    collapsedColumnKeys: stringArray(source.collapsedColumnKeys),
    search: transient.search ?? (typeof source.search === 'string' ? source.search : ''),
    personFilter: typeof source.personFilter === 'string' ? source.personFilter : null,
    density: parseDensity(source.density),
  };
}

/** True when anything narrows the visible items (drives filtered-empty states). */
export function hasActiveFilters(
  state: Pick<TableViewState, 'filters' | 'search' | 'personFilter'>,
): boolean {
  return treeHasRules(state.filters) || state.search.trim().length > 0 || Boolean(state.personFilter);
}

/** Toggle a single-label quick filter (battery click). Returns the new filter group. */
export function toggleLabelFilter(
  filters: FilterGroup,
  columnKey: string,
  labelId: string | null,
): FilterGroup {
  const operator: FilterOperator = labelId === null ? 'is_empty' : 'any_of';
  const existing = filters.rules.find((rule) => rule.columnKey === columnKey);
  const others = filters.rules.filter((rule) => rule.columnKey !== columnKey);
  if (existing && existing.operator === operator) {
    if (labelId === null) return { ...filters, rules: others };
    const current = stringArray(existing.value);
    const next = current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId];
    return { ...filters, rules: next.length ? [...others, { columnKey, operator, value: next }] : others };
  }
  return {
    ...filters,
    rules: [...others, { columnKey, operator, value: labelId === null ? undefined : [labelId] }],
  };
}

/** Replace the sort with a single rule on `columnKey` (header menu one-click sort). */
export function sortBy(columnKey: string, direction: 'asc' | 'desc'): SortRule[] {
  return [{ columnKey, direction }];
}

export function toggleKey(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}
