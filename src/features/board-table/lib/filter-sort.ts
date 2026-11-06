/**
 * Client-side filter / search / person filter / sort over the loaded items. Pure; built to
 * run on 5k+ items per keystroke (precomputed lookups, no per-item allocations beyond text).
 */
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { cellRaw, cellText, compareKeys, sortKey, type UsersById } from './cell-text';
import { compileFilterTree, matchFilterTree, pruneFilterTree, treeHasRules } from '@/lib/filter-tree';
import type { FilterRule, TableViewState } from './view-state';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** The discrete ids a cell holds (labels, people, linked items, tags) for any_of / is tests. */
export function cellIds(column: ColumnDto, item: ItemDto): string[] {
  const raw = cellRaw(column, item);
  if (raw === undefined || raw === null) return [];
  if (!isRecord(raw)) return typeof raw === 'string' ? [raw] : raw === true ? ['true'] : [];
  if (typeof raw.labelId === 'string') return [raw.labelId];
  for (const key of ['labelIds', 'ids', 'itemIds', 'tags'] as const) {
    const list = raw[key];
    if (Array.isArray(list)) return list.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function isEmptyCell(column: ColumnDto, item: ItemDto): boolean {
  if (column.type === 'checkbox') return cellRaw(column, item) !== true;
  if (column.type === 'status') {
    const ids = cellIds(column, item);
    if (ids.length === 0) return true;
    const labels = (column.settings as { labels?: { id: string; isDefault?: boolean }[] }).labels ?? [];
    return labels.some((label) => label.id === ids[0] && label.isDefault);
  }
  const key = sortKey(column, item);
  return key === null || key === '';
}

function numberOf(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function matchRule(rule: FilterRule, column: ColumnDto, item: ItemDto, users: UsersById): boolean {
  switch (rule.operator) {
    case 'is_empty':
      return isEmptyCell(column, item);
    case 'is_not_empty':
      return !isEmptyCell(column, item);
    case 'contains':
    case 'not_contains': {
      const needle = String(rule.value ?? '')
        .trim()
        .toLowerCase();
      const hit = !needle || cellText(column, item, users).toLowerCase().includes(needle);
      return rule.operator === 'contains' ? hit : !hit;
    }
    case 'is':
    case 'any_of':
    case 'is_not':
    case 'none_of': {
      const wanted = asArray(rule.value).map(String);
      if (wanted.length === 0) return true;
      const ids =
        column.type === 'checkbox'
          ? [cellRaw(column, item) === true ? 'true' : 'false']
          : cellIds(column, item);
      const values = ids.length ? ids : [cellText(column, item, users).toLowerCase()];
      const hit = wanted.some((entry) => values.includes(entry) || values.includes(entry.toLowerCase()));
      return rule.operator === 'is' || rule.operator === 'any_of' ? hit : !hit;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const key = sortKey(column, item, users);
      const target = numberOf(rule.value);
      if (typeof key !== 'number' || target === null) return false;
      if (rule.operator === 'gt') return key > target;
      if (rule.operator === 'gte') return key >= target;
      if (rule.operator === 'lt') return key < target;
      return key <= target;
    }
    case 'before':
    case 'after':
    case 'between': {
      const key = sortKey(column, item, users);
      if (key === null) return false;
      const value = String(key).slice(0, 10);
      if (rule.operator === 'before') return value < String(rule.value ?? '');
      if (rule.operator === 'after') return value > String(rule.value ?? '');
      const [from, to] = asArray(rule.value).map(String);
      return (!from || value >= from) && (!to || value <= to);
    }
    default:
      return true;
  }
}

export interface FilterContext {
  readonly columns: readonly ColumnDto[];
  readonly users: UsersById;
}

/** Items that pass search, person filter and filter rules. */
export function filterItems(
  items: readonly ItemDto[],
  state: Pick<TableViewState, 'filters' | 'search' | 'personFilter'>,
  ctx: FilterContext,
): ItemDto[] {
  const byKey = new Map(ctx.columns.map((column) => [column.key, column]));
  const tree = pruneFilterTree(compileFilterTree(state.filters), (rule) => byKey.has(rule.columnKey));
  const hasRules = treeHasRules(tree);
  const needle = state.search.trim().toLowerCase();
  const peopleColumns = ctx.columns.filter((column) => column.type === 'people');
  const searchColumns = needle ? ctx.columns.filter((column) => column.type !== 'name') : [];
  if (!hasRules && !needle && !state.personFilter) return [...items];

  return items.filter((item) => {
    if (state.personFilter) {
      const person = state.personFilter;
      if (!peopleColumns.some((column) => cellIds(column, item).includes(person))) return false;
    }
    if (needle) {
      const inName = item.name.toLowerCase().includes(needle);
      if (
        !inName &&
        !searchColumns.some((column) => cellText(column, item, ctx.users).toLowerCase().includes(needle))
      ) {
        return false;
      }
    }
    if (!hasRules) return true;
    const test = (rule: { columnKey: string; operator: string; value?: unknown }) =>
      matchRule(rule as FilterRule, byKey.get(rule.columnKey) as ColumnDto, item, ctx.users);
    return matchFilterTree(tree, test);
  });
}

const byPosition = (a: ItemDto, b: ItemDto) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** Stable multi-key sort; falls back to manual (fractional) position. */
export function sortItems(
  items: readonly ItemDto[],
  state: Pick<TableViewState, 'sort'>,
  ctx: FilterContext,
): ItemDto[] {
  const byKey = new Map(ctx.columns.map((column) => [column.key, column]));
  const rules = state.sort.filter((rule) => byKey.has(rule.columnKey));
  if (!rules.length) return [...items].sort(byPosition);
  const keyed = items.map((item) => ({
    item,
    keys: rules.map((rule) => sortKey(byKey.get(rule.columnKey) as ColumnDto, item, ctx.users)),
  }));
  keyed.sort((a, b) => {
    for (let index = 0; index < rules.length; index += 1) {
      const left = a.keys[index] ?? null;
      const right = b.keys[index] ?? null;
      // Empty values stay last regardless of direction.
      if (left === null || right === null) {
        const diff = compareKeys(left, right);
        if (diff !== 0) return diff;
        continue;
      }
      const diff = compareKeys(left, right);
      if (diff !== 0) return rules[index]?.direction === 'desc' ? -diff : diff;
    }
    return byPosition(a.item, b.item);
  });
  return keyed.map((entry) => entry.item);
}

/** Filter + sort, bucketed by group id (preserves group order of `groupIds`). */
export function itemsByGroup(
  items: readonly ItemDto[],
  groupIds: readonly string[],
  state: Pick<TableViewState, 'filters' | 'search' | 'personFilter' | 'sort'>,
  ctx: FilterContext,
): Map<string, ItemDto[]> {
  const sorted = sortItems(filterItems(items, state, ctx), state, ctx);
  const out = new Map<string, ItemDto[]>(groupIds.map((id) => [id, []]));
  for (const item of sorted) out.get(item.groupId)?.push(item);
  return out;
}
