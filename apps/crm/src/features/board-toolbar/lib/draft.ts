/**
 * The toolbar's "working" view state versus what the view has saved.
 *
 * monday distinguishes temporary toolbar state (filters, sort, hidden columns, group by)
 * from the view's saved state: changes apply instantly, and "Save to this view" persists them.
 * Layout tweaks (column widths, row height, collapsed columns) are saved automatically.
 *
 * Pure and client-safe.
 */
import {
  parseViewConfig,
  type FilterGroup,
  type SortRule,
  type TableViewState,
} from '@/features/board-table';

export const DATE_BUCKETS = ['week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export interface GroupBySpec {
  readonly columnKey: string;
  /** Only for date-like columns. */
  readonly bucket?: DateBucket;
}

/** Keys that are temporary until "Save to this view". */
export const DRAFT_KEYS = ['filters', 'sort', 'personFilter', 'hiddenColumnKeys', 'groupBy'] as const;
export type DraftKey = (typeof DRAFT_KEYS)[number];

export interface ToolbarDraft {
  readonly filters: FilterGroup;
  readonly sort: readonly SortRule[];
  readonly personFilter: string | null;
  readonly hiddenColumnKeys: readonly string[];
  readonly groupBy: GroupBySpec | null;
}

export type DraftOverlay = Partial<ToolbarDraft>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBucket(value: unknown): DateBucket | undefined {
  return typeof value === 'string' && (DATE_BUCKETS as readonly string[]).includes(value)
    ? (value as DateBucket)
    : undefined;
}

/** `groupBy` is stored as a column key (+ `groupByBucket`) in the view config. */
export function parseGroupBy(config: Record<string, unknown>): GroupBySpec | null {
  const key = config.groupBy;
  if (typeof key !== 'string' || !key || key === 'none') return null;
  const bucket = parseBucket(config.groupByBucket);
  return bucket ? { columnKey: key, bucket } : { columnKey: key };
}

/** The draft-able part of a (possibly malformed) saved view config. */
export function draftFromConfig(config: unknown): ToolbarDraft {
  const source = isRecord(config) ? config : {};
  const state = parseViewConfig(source);
  return {
    filters: state.filters,
    sort: state.sort,
    personFilter: state.personFilter,
    hiddenColumnKeys: state.hiddenColumnKeys,
    groupBy: parseGroupBy(source),
  };
}

export function draftFromState(state: TableViewState, groupBy: GroupBySpec | null): ToolbarDraft {
  return {
    filters: state.filters,
    sort: state.sort,
    personFilter: state.personFilter,
    hiddenColumnKeys: state.hiddenColumnKeys,
    groupBy,
  };
}

/** A filter tree as stored in the view config (nested groups only when present). */
export function filtersForConfig(filters: FilterGroup): FilterGroup {
  const groups = (filters.groups ?? []).map(filtersForConfig);
  return groups.length
    ? { conjunction: filters.conjunction, rules: [...filters.rules], groups }
    : { conjunction: filters.conjunction, rules: [...filters.rules] };
}

/** Total rules in a filter tree (Filter button badge, chips). */
export function countRules(filters: FilterGroup): number {
  return filters.rules.length + (filters.groups ?? []).reduce((sum, group) => sum + countRules(group), 0);
}

/** Deterministic JSON (sorted object keys) for structural comparison. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalize(key: DraftKey, value: ToolbarDraft[DraftKey]): unknown {
  // Hidden columns are a set: order never makes a view dirty.
  if (key === 'hiddenColumnKeys') return [...(value as readonly string[])].sort();
  return value;
}

export function sameValue(key: DraftKey, a: ToolbarDraft[DraftKey], b: ToolbarDraft[DraftKey]): boolean {
  return stableStringify(normalize(key, a)) === stableStringify(normalize(key, b));
}

/** Keys whose working value differs from the saved one. */
export function dirtyKeys(working: ToolbarDraft, saved: ToolbarDraft): DraftKey[] {
  return DRAFT_KEYS.filter((key) => !sameValue(key, working[key], saved[key]));
}

/** Every draft key equal? */
export function sameDraft(a: ToolbarDraft, b: ToolbarDraft): boolean {
  return DRAFT_KEYS.every((key) => sameValue(key, a[key], b[key]));
}

/**
 * The saved config changed from `before` to `saved` (someone saved the view elsewhere): which
 * keys should the working state adopt? Only keys that changed and that we haven't touched.
 *
 * `pendingFrom` is the saved state at the moment *we* started a save. If `saved` returns to it
 * while that save is in flight or just failed, it's the optimistic update being rolled back,
 * not someone else's save: adopt nothing, so the user's unsaved changes survive the failure.
 */
export function externalAdoptions(
  before: ToolbarDraft,
  saved: ToolbarDraft,
  working: ToolbarDraft,
  pendingFrom: ToolbarDraft | null,
): DraftKey[] {
  if (pendingFrom && sameDraft(saved, pendingFrom)) return [];
  return DRAFT_KEYS.filter(
    (key) => !sameValue(key, before[key], saved[key]) && sameValue(key, working[key], before[key]),
  );
}

/** Only the keys that differ from `saved` (what the URL carries). */
export function overlayOf(working: ToolbarDraft, saved: ToolbarDraft): DraftOverlay {
  const out: Record<string, unknown> = {};
  for (const key of dirtyKeys(working, saved)) out[key] = working[key];
  return out as DraftOverlay;
}

export function applyOverlay(saved: ToolbarDraft, overlay: DraftOverlay | null | undefined): ToolbarDraft {
  return overlay ? { ...saved, ...overlay } : saved;
}

/** The view-config patch that saves `keys` of `working` (shallow-merged by the API). */
export function configPatch(working: ToolbarDraft, keys: readonly DraftKey[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'groupBy') {
      patch.groupBy = working.groupBy?.columnKey ?? null;
      patch.groupByBucket = working.groupBy?.bucket ?? null;
    } else if (key === 'filters') {
      patch.filters = filtersForConfig(working.filters);
    } else if (key === 'sort') {
      patch.sort = [...working.sort];
    } else if (key === 'hiddenColumnKeys') {
      patch.hiddenColumnKeys = [...working.hiddenColumnKeys];
    } else {
      patch.personFilter = working.personFilter;
    }
  }
  return patch;
}

/** Number of things narrowing the board (Filter button badge). */
export function activeFilterCount(draft: Pick<ToolbarDraft, 'filters' | 'personFilter'>): number {
  return countRules(draft.filters) + (draft.personFilter ? 1 : 0);
}

/** Auto-saved layout keys: returns the config patch, or null when nothing changed. */
export function layoutPatch(
  working: Pick<TableViewState, 'columnWidths' | 'density' | 'collapsedColumnKeys'>,
  saved: Pick<TableViewState, 'columnWidths' | 'density' | 'collapsedColumnKeys'>,
  defaultWidths: Readonly<Record<string, number>>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const widths: Record<string, number> = { ...saved.columnWidths };
  let widthsChanged = false;
  for (const [key, width] of Object.entries(working.columnWidths)) {
    const baseline = saved.columnWidths[key] ?? defaultWidths[key];
    if (baseline !== width) {
      widths[key] = width;
      widthsChanged = true;
    }
  }
  if (widthsChanged) patch.columnWidths = widths;
  if (working.density !== saved.density) patch.density = working.density;
  if (stableStringify([...working.collapsedColumnKeys].sort()) !== stableStringify([...saved.collapsedColumnKeys].sort()))
    patch.collapsedColumnKeys = [...working.collapsedColumnKeys];
  return Object.keys(patch).length ? patch : null;
}
