/**
 * Filter builder model: which operators each column type offers, what kind of value editor an
 * operator needs, quick-filter facets with counts, and human-readable rule summaries for the
 * chips under the toolbar. Pure and client-safe.
 */
import { cellText, filterItems, type FilterGroup, type FilterOperator, type FilterRule } from '@/features/board-table';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { countRules } from './draft';
import { RELATIVE_DATE_LABELS, isRelativeDatePreset, type RelativeDatePreset } from '@/lib/filter-tree';

export type ValueKind =
  | 'labels'
  | 'people'
  | 'text'
  | 'number'
  | 'number-range'
  | 'date'
  | 'date-range'
  | 'relative-date'
  | 'checkbox'
  | 'none';

export interface OperatorOption {
  readonly value: FilterOperator;
  readonly label: string;
}

const LABEL_TYPES: ReadonlySet<ColumnType> = new Set(['status', 'dropdown']);
const NUMBER_TYPES: ReadonlySet<ColumnType> = new Set(['number', 'currency', 'rating', 'progress', 'formula']);
const DATE_TYPES: ReadonlySet<ColumnType> = new Set(['date', 'timeline', 'last_updated', 'creation_log']);
/** Computed or opaque columns the filter engine can't evaluate meaningfully. */
const UNFILTERABLE: ReadonlySet<ColumnType> = new Set(['button', 'files', 'mirror', 'item_id']);

const LABELS: Readonly<Record<FilterOperator, string>> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  any_of: 'is',
  none_of: 'is not',
  eq: 'equals',
  neq: "doesn't equal",
  range: 'is between',
  within: 'is',
};

/** Relative date presets offered in the advanced editor, in menu order. */
export const RELATIVE_DATE_OPTIONS: readonly { value: RelativeDatePreset; label: string }[] = (
  [
    'overdue',
    'today',
    'yesterday',
    'tomorrow',
    'this_week',
    'last_week',
    'next_week',
    'this_month',
    'last_month',
    'next_month',
    'past_7_days',
    'next_7_days',
    'past_30_days',
    'next_30_days',
  ] as const
).map((value) => ({ value, label: RELATIVE_DATE_LABELS[value] }));

/** Date facets in the Quick tab (plus "No date"). */
export const DATE_FACETS: readonly RelativeDatePreset[] = ['overdue', 'today', 'this_week', 'next_week', 'this_month'];

export function operatorLabel(operator: FilterOperator): string {
  return LABELS[operator];
}

export function isFilterable(column: Pick<ColumnDto, 'type'>): boolean {
  return !UNFILTERABLE.has(column.type);
}

export function operatorsFor(column: Pick<ColumnDto, 'type'>): OperatorOption[] {
  const ops = (list: FilterOperator[]) => list.map((value) => ({ value, label: LABELS[value] }));
  if (LABEL_TYPES.has(column.type) || column.type === 'people')
    return ops(['any_of', 'none_of', 'is_empty', 'is_not_empty']);
  if (NUMBER_TYPES.has(column.type))
    return ops(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'range', 'is_empty', 'is_not_empty']);
  if (DATE_TYPES.has(column.type)) return ops(['within', 'before', 'after', 'between', 'is_empty', 'is_not_empty']);
  if (column.type === 'checkbox') return ops(['is']);
  return ops(['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty']);
}

export function defaultOperator(column: Pick<ColumnDto, 'type'>): FilterOperator {
  return operatorsFor(column)[0]?.value ?? 'contains';
}

export function valueKind(column: Pick<ColumnDto, 'type'>, operator: FilterOperator): ValueKind {
  if (operator === 'is_empty' || operator === 'is_not_empty') return 'none';
  if (LABEL_TYPES.has(column.type)) return 'labels';
  if (column.type === 'people') return 'people';
  if (column.type === 'checkbox') return 'checkbox';
  if (NUMBER_TYPES.has(column.type)) return operator === 'range' ? 'number-range' : 'number';
  if (DATE_TYPES.has(column.type))
    return operator === 'within' ? 'relative-date' : operator === 'between' ? 'date-range' : 'date';
  return 'text';
}

/** A rule is "complete" when the engine can apply it (incomplete rows are kept but ignored). */
export function isRuleComplete(rule: FilterRule, column: Pick<ColumnDto, 'type'> | undefined): boolean {
  if (!column) return false;
  const kind = valueKind(column, rule.operator);
  if (kind === 'none') return true;
  const value = rule.value;
  if (kind === 'labels' || kind === 'people') return Array.isArray(value) && value.length > 0;
  if (kind === 'date-range') return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry);
  if (kind === 'number-range')
    return Array.isArray(value) && value.some((entry) => entry !== null && entry !== undefined && String(entry).trim() !== '');
  if (kind === 'relative-date') return isRelativeDatePreset(value);
  if (kind === 'checkbox') return Array.isArray(value) ? value.length > 0 : value === 'true' || value === 'false';
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/** Value to reset to when the operator changes (keeps compatible values). */
export function coerceValue(column: Pick<ColumnDto, 'type'>, operator: FilterOperator, value: unknown): unknown {
  const kind = valueKind(column, operator);
  if (kind === 'none') return undefined;
  if (kind === 'labels' || kind === 'people') return Array.isArray(value) ? value : [];
  if (kind === 'date-range' || kind === 'number-range') return Array.isArray(value) ? value : ['', ''];
  if (kind === 'relative-date') return isRelativeDatePreset(value) ? value : 'this_week';
  if (kind === 'checkbox') return Array.isArray(value) ? value : ['true'];
  if (Array.isArray(value)) return '';
  return value ?? '';
}

export function labelsOf(column: Pick<ColumnDto, 'settings'>): { id: string; name: string; color: string; isDefault?: boolean }[] {
  const raw = (column.settings as { labels?: unknown } | null)?.labels;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const label = entry as Record<string, unknown>;
    if (typeof label.id !== 'string') return [];
    return [
      {
        id: label.id,
        name: typeof label.name === 'string' && label.name ? label.name : 'Blank',
        color: typeof label.color === 'string' ? label.color : 'gray',
        isDefault: label.isDefault === true,
      },
    ];
  });
}

// Quick filters -----------------------------------------------------------------------------

export interface FacetValue {
  /** Label id / user id / relative date preset. `null` = "empty" bucket. */
  readonly id: string | null;
  readonly name: string;
  /** Label palette token name, or null for people. */
  readonly color: string | null;
  readonly userId?: string;
  readonly count: number;
}

export interface Facet {
  readonly column: ColumnDto;
  readonly kind: 'labels' | 'people' | 'date';
  readonly values: readonly FacetValue[];
}

/** Columns that get date facets (Overdue / Today / This week…). */
export function isDateFacetColumn(column: Pick<ColumnDto, 'type' | 'scope'>): boolean {
  return column.scope === 'item' && (column.type === 'date' || column.type === 'timeline');
}

export function quickFilterColumns(columns: readonly ColumnDto[]): ColumnDto[] {
  return columns.filter(
    (column) =>
      column.scope === 'item' && (LABEL_TYPES.has(column.type) || column.type === 'people' || isDateFacetColumn(column)),
  );
}

function idsOf(column: ColumnDto, item: ItemDto): string[] {
  const raw = item.values[column.key] as unknown;
  if (typeof raw !== 'object' || raw === null) return [];
  const record = raw as Record<string, unknown>;
  if (typeof record.labelId === 'string') return [record.labelId];
  const list = record.labelIds ?? record.ids;
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [];
}

export interface FacetContext {
  readonly columns: readonly ColumnDto[];
  readonly users: readonly UserSummaryDto[];
  readonly search: string;
  readonly personFilter: string | null;
  readonly filters: FilterGroup;
}

/**
 * Faceted counts per value: each count applies every other active filter (but not this
 * column's own rule), so chips show how many items you'd see if you picked them.
 */
export function buildFacets(items: readonly ItemDto[], context: FacetContext): Facet[] {
  const usersById = new Map(context.users.map((user) => [user.id, user]));
  return quickFilterColumns(context.columns).map((column) => {
    const others: FilterGroup = {
      ...context.filters,
      rules: context.filters.rules.filter((rule) => rule.columnKey !== column.key),
    };
    const ctx = { columns: context.columns, users: usersById };
    const pool = filterItems(items, { filters: others, search: context.search, personFilter: context.personFilter }, ctx);
    if (isDateFacetColumn(column)) {
      const count = (rule: FilterRule) =>
        filterItems(pool, { filters: { conjunction: 'and', rules: [rule] }, search: '', personFilter: null }, ctx).length;
      const values: FacetValue[] = DATE_FACETS.map((preset) => ({
        id: preset,
        name: RELATIVE_DATE_LABELS[preset],
        color: preset === 'overdue' ? 'red' : 'blue',
        count: count({ columnKey: column.key, operator: 'within', value: preset }),
      }));
      const empty = count({ columnKey: column.key, operator: 'is_empty' });
      return {
        column,
        kind: 'date' as const,
        values: empty ? [...values, { id: null, name: 'No date', color: null, count: empty }] : values,
      };
    }
    const counts = new Map<string | null, number>();
    const defaults = new Set(labelsOf(column).filter((label) => label.isDefault).map((label) => label.id));
    for (const item of pool) {
      const ids = idsOf(column, item).filter((id) => !defaults.has(id));
      if (ids.length === 0) counts.set(null, (counts.get(null) ?? 0) + 1);
      for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const values: FacetValue[] =
      column.type === 'people'
        ? [...counts.entries()]
            .filter((entry): entry is [string, number] => entry[0] !== null && usersById.has(entry[0]))
            .map(([id, count]) => ({ id, name: usersById.get(id)?.name ?? 'Unknown', color: null, userId: id, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        : labelsOf(column)
            .filter((label) => !label.isDefault)
            .map((label) => ({ id: label.id, name: label.name, color: label.color, count: counts.get(label.id) ?? 0 }));
    const empty = counts.get(null) ?? 0;
    return {
      column,
      kind: column.type === 'people' ? ('people' as const) : ('labels' as const),
      values: empty ? [...values, { id: null, name: 'Empty', color: null, count: empty }] : values,
    };
  });
}

/** Is `valueId` (null = empty) selected in the quick filter for `columnKey`? */
export function isFacetSelected(filters: FilterGroup, columnKey: string, valueId: string | null): boolean {
  const rule = filters.rules.find((entry) => entry.columnKey === columnKey);
  if (!rule) return false;
  if (valueId === null) return rule.operator === 'is_empty';
  if (rule.operator === 'within') return rule.value === valueId;
  return rule.operator === 'any_of' && Array.isArray(rule.value) && rule.value.includes(valueId);
}

/** Date facets are single-choice: pick a preset (or "No date"), pick it again to clear. */
export function toggleDateFacet(filters: FilterGroup, columnKey: string, preset: string | null): FilterGroup {
  const others = filters.rules.filter((rule) => rule.columnKey !== columnKey);
  if (isFacetSelected(filters, columnKey, preset)) return { ...filters, rules: others };
  const rule: FilterRule =
    preset === null ? { columnKey, operator: 'is_empty' } : { columnKey, operator: 'within', value: preset };
  return { ...filters, rules: [...others, rule] };
}

// Nested groups (advanced editor) --------------------------------------------------------

export { countRules };

/** Keep only complete rules and non-empty groups: what the engine should apply. */
export function applicableFilters(
  filters: FilterGroup,
  byKey: ReadonlyMap<string, Pick<ColumnDto, 'type'>>,
): FilterGroup {
  const rules = filters.rules.filter((rule) => isRuleComplete(rule, byKey.get(rule.columnKey)));
  const groups = (filters.groups ?? [])
    .map((group) => applicableFilters(group, byKey))
    .filter((group) => countRules(group) > 0);
  return groups.length ? { conjunction: filters.conjunction, rules, groups } : { conjunction: filters.conjunction, rules };
}

// Chips -------------------------------------------------------------------------------------

function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

/** "Stage is Won, Lost" · "Deal value greater than 5000" · "Owner is empty". */
export function ruleSummary(rule: FilterRule, column: ColumnDto | undefined, users: readonly UserSummaryDto[]): string {
  const title = column?.title ?? rule.columnKey;
  const op = LABELS[rule.operator];
  if (!column) return `${title} ${op}`;
  const kind = valueKind(column, rule.operator);
  const values = Array.isArray(rule.value) ? rule.value.map(String) : rule.value === undefined ? [] : [String(rule.value)];
  switch (kind) {
    case 'none':
      return `${title} ${op}`;
    case 'labels': {
      const labels = labelsOf(column);
      return `${title} ${op} ${joinNames(values.map((id) => labels.find((label) => label.id === id)?.name ?? 'Unknown'))}`;
    }
    case 'people':
      return `${title} ${op} ${joinNames(values.map((id) => users.find((user) => user.id === id)?.name ?? 'Unknown'))}`;
    case 'checkbox':
      return `${title} ${values[0] === 'false' ? 'is unchecked' : 'is checked'}`;
    case 'date-range':
    case 'number-range':
      return `${title} ${op} ${values[0] || '…'} and ${values[1] || '…'}`;
    case 'relative-date':
      if (!isRelativeDatePreset(rule.value)) return `${title} ${op}`;
      return rule.value === 'overdue'
        ? `${title} is overdue`
        : `${title} is ${RELATIVE_DATE_LABELS[rule.value].toLowerCase()}`;
    default:
      return `${title} ${op} ${values[0] ?? ''}`.trim();
  }
}

/** Every distinct text value of a column (for text-filter suggestions), most common first. */
export function textSuggestions(items: readonly ItemDto[], column: ColumnDto, users: readonly UserSummaryDto[], limit = 8): string[] {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = cellText(column, item, usersById).trim();
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text]) => text);
}
