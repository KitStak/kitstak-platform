/**
 * Client-side evaluation of a view's saved filters + the temporary search / person filter.
 * Mirrors the `viewConfigSchema` filter model so every view shows the same rows as the table.
 */
import { compileFilterTree, matchFilterTree, treeHasRules } from '@/lib/filter-tree';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { cellOf, dateRangeOf, dropdownLabelIds, numericValue, peopleIds, statusLabelId } from './values';

export interface FilterRule {
  readonly columnKey: string;
  readonly operator: string;
  readonly value?: unknown;
}

export interface ViewFilterInput {
  readonly filters?: {
    readonly conjunction?: 'and' | 'or';
    readonly rules?: readonly FilterRule[];
    readonly groups?: readonly NonNullable<ViewFilterInput['filters']>[];
  } | null;
  readonly search?: string | null;
  readonly personFilter?: string | null;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

/** Comparable tokens of a cell: label ids, people ids, text. */
function tokensOf(column: ColumnDto | undefined, item: ItemDto, columnKey: string): string[] {
  if (columnKey === 'name') return [item.name];
  if (columnKey === 'group') return [item.groupId];
  const raw = cellOf(item, columnKey);
  if (raw === undefined || raw === null) return [];
  switch (column?.type) {
    case 'status':
      return asList(statusLabelId(raw));
    case 'dropdown':
      return dropdownLabelIds(raw);
    case 'people':
      return peopleIds(raw);
    case 'checkbox':
      return raw === true ? ['true'] : [];
    default:
      break;
  }
  if (typeof raw === 'string' || typeof raw === 'number') return [String(raw)];
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['email', 'phone', 'url', 'address', 'display', 'date', 'labelId']) {
      if (typeof record[key] === 'string') return [record[key] as string];
    }
    if (Array.isArray(record.tags)) return record.tags.map(String);
  }
  return [];
}

function matchRule(rule: FilterRule, item: ItemDto, columns: ReadonlyMap<string, ColumnDto>): boolean {
  const column = columns.get(rule.columnKey);
  const tokens = tokensOf(column, item, rule.columnKey);
  const wanted = asList(rule.value);
  const raw = rule.columnKey === 'name' ? item.name : cellOf(item, rule.columnKey);
  switch (rule.operator) {
    case 'is_empty':
      return tokens.length === 0 && numericValue(raw) === null;
    case 'is_not_empty':
      return tokens.length > 0 || numericValue(raw) !== null;
    case 'is':
    case 'any_of':
      return wanted.length === 0 || tokens.some((token) => wanted.includes(token));
    case 'is_not':
    case 'none_of':
      return !tokens.some((token) => wanted.includes(token));
    case 'contains':
    case 'not_contains': {
      const needle = String(rule.value ?? '').toLowerCase();
      const hit = tokens.some((token) => token.toLowerCase().includes(needle));
      return rule.operator === 'contains' ? hit : !hit;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const number = numericValue(raw);
      const target = Number(rule.value);
      if (number === null || !Number.isFinite(target)) return false;
      if (rule.operator === 'gt') return number > target;
      if (rule.operator === 'gte') return number >= target;
      if (rule.operator === 'lt') return number < target;
      return number <= target;
    }
    case 'before':
    case 'after': {
      const range = dateRangeOf(raw);
      const target = typeof rule.value === 'string' ? rule.value.slice(0, 10) : null;
      if (!range || !target) return false;
      return rule.operator === 'before' ? range.start < target : range.end > target;
    }
    case 'between': {
      const [low, high] = Array.isArray(rule.value) ? rule.value : [];
      const number = numericValue(raw);
      if (number !== null) return number >= Number(low) && number <= Number(high);
      const range = dateRangeOf(raw);
      return Boolean(range && typeof low === 'string' && typeof high === 'string' && range.start >= low && range.start <= high);
    }
    default:
      return true;
  }
}

function searchable(item: ItemDto): string {
  const parts: string[] = [item.name];
  for (const value of Object.values(item.values)) {
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of ['email', 'phone', 'url', 'text', 'address']) {
        if (typeof record[key] === 'string') parts.push(record[key] as string);
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

/** Items that pass the view's saved filters, search and person filter. Order is preserved. */
export function applyViewFilters(
  items: readonly ItemDto[],
  columns: readonly ColumnDto[],
  input: ViewFilterInput,
): ItemDto[] {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  // Nested groups + rich operators (number equals, relative dates): see `@/lib/filter-tree`.
  const tree = compileFilterTree(input.filters);
  const hasRules = treeHasRules(tree);
  const needle = input.search?.trim().toLowerCase() ?? '';
  const person = input.personFilter ?? null;
  const peopleColumns = columns.filter((column) => column.type === 'people');
  return items.filter((item) => {
    if (item.parentItemId) return false;
    if (hasRules && !matchFilterTree(tree, (rule) => matchRule(rule, item, byKey))) return false;
    if (person && !peopleColumns.some((column) => peopleIds(cellOf(item, column.key)).includes(person))) return false;
    if (needle && !searchable(item).includes(needle)) return false;
    return true;
  });
}
