/**
 * Applies a board view config (filters, search, person filter, sort, hidden columns, column
 * order) to items and columns, so exports contain exactly what the user is looking at.
 */
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { isEmptyCellValue } from '@/server/db/schema/cell-values';
import { compileFilterTree, matchFilterTree, treeHasRules } from '@/lib/filter-tree';
import { cellText, exportCell, type ExportContext } from './export-format';

export interface ExportFilterRule {
  readonly columnKey: string;
  readonly operator: string;
  readonly value?: unknown;
}

export interface ExportViewConfig {
  readonly filters?: {
    readonly conjunction?: 'and' | 'or';
    readonly rules?: readonly ExportFilterRule[];
    readonly groups?: readonly NonNullable<ExportViewConfig['filters']>[];
  };
  readonly sort?: readonly { readonly columnKey: string; readonly direction: 'asc' | 'desc' }[];
  readonly hiddenColumnKeys?: readonly string[];
  readonly columnOrder?: readonly string[];
  readonly search?: string;
  readonly personFilter?: string | null;
}

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

function idsOf(column: ColumnDto | undefined, item: ItemDto): string[] {
  if (!column) return [];
  const value: unknown = item.values[column.key];
  if (!isRecord(value)) return [];
  const pick = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]).map(String) : []);
  if (column.type === 'status') return typeof value.labelId === 'string' ? [value.labelId] : [];
  if (column.type === 'dropdown') return pick('labelIds');
  if (column.type === 'people') return pick('ids');
  if (column.type === 'tags') return pick('tags');
  if (column.type === 'connect_boards') return pick('itemIds');
  if (column.type === 'country') return typeof value.code === 'string' ? [value.code] : [];
  return [];
}

function numberOf(column: ColumnDto | undefined, item: ItemDto): number | null {
  if (!column) return null;
  const raw: unknown = column.key in item.computed ? item.computed[column.key] : item.values[column.key];
  if (typeof raw === 'number') return raw;
  if (isRecord(raw)) {
    if (typeof raw.amount === 'number') return raw.amount;
    if (typeof raw.result === 'number') return raw.result;
    if (typeof raw.value === 'number') return raw.value;
  }
  return null;
}

function dateOf(column: ColumnDto | undefined, item: ItemDto): string | null {
  if (!column) return null;
  const raw: unknown = column.key in item.computed ? item.computed[column.key] : item.values[column.key];
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (isRecord(raw)) {
    for (const key of ['date', 'from', 'at']) {
      const entry = raw[key];
      if (typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry)) return entry.slice(0, 10);
    }
  }
  return null;
}

function resolveDate(value: unknown, today: Date): string | null {
  if (typeof value === 'string') {
    const day = 86_400_000;
    const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const relative: Record<string, number> = { today: 0, yesterday: -1, tomorrow: 1 };
    if (value in relative) return new Date(base + (relative[value] as number) * day).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  }
  if (isRecord(value) && typeof value.date === 'string') return value.date.slice(0, 10);
  return null;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

export function matchesRule(
  rule: ExportFilterRule,
  item: ItemDto,
  byKey: ReadonlyMap<string, ColumnDto>,
  ctx: ExportContext,
  today = new Date(),
): boolean {
  const column = byKey.get(rule.columnKey);
  const isName = rule.columnKey === 'name' || column?.type === 'name';
  const text = isName ? item.name : column ? cellText(exportCell(column, item, ctx)) : '';
  const empty = isName
    ? !item.name.trim()
    : column
      ? column.key in item.computed
        ? text === ''
        : isEmptyCellValue(item.values[column.key])
      : true;
  const ids = idsOf(column, item);
  const wanted = asList(rule.value);
  const lowered = text.toLowerCase();
  const textMatch = (entry: string) => ids.includes(entry) || lowered === entry.toLowerCase();
  switch (rule.operator) {
    case 'is_empty':
      return empty;
    case 'is_not_empty':
      return !empty;
    case 'is':
    case 'any_of':
      return wanted.length === 0 ? true : wanted.some(textMatch);
    case 'is_not':
    case 'none_of':
      return wanted.length === 0 ? true : !wanted.some(textMatch);
    case 'contains':
      return wanted.every((entry) => lowered.includes(entry.toLowerCase()));
    case 'not_contains':
      return wanted.every((entry) => !lowered.includes(entry.toLowerCase()));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const number = numberOf(column, item);
      const target = Number(Array.isArray(rule.value) ? rule.value[0] : rule.value);
      if (number === null || !Number.isFinite(target)) return false;
      if (rule.operator === 'gt') return number > target;
      if (rule.operator === 'gte') return number >= target;
      if (rule.operator === 'lt') return number < target;
      return number <= target;
    }
    case 'before':
    case 'after': {
      const date = dateOf(column, item);
      const target = resolveDate(Array.isArray(rule.value) ? rule.value[0] : rule.value, today);
      if (!date || !target) return false;
      return rule.operator === 'before' ? date < target : date > target;
    }
    case 'between': {
      const range = Array.isArray(rule.value) ? rule.value : [];
      const date = dateOf(column, item);
      if (date) {
        const from = resolveDate(range[0], today);
        const to = resolveDate(range[1], today);
        return Boolean(from && to && date >= from && date <= to);
      }
      const number = numberOf(column, item);
      const low = Number(range[0]);
      const high = Number(range[1]);
      return number !== null && Number.isFinite(low) && Number.isFinite(high) && number >= low && number <= high;
    }
    default:
      return true;
  }
}

function compare(a: ItemDto, b: ItemDto, column: ColumnDto | undefined, ctx: ExportContext): number {
  const numA = numberOf(column, a);
  const numB = numberOf(column, b);
  if (numA !== null || numB !== null) {
    if (numA === null) return 1;
    if (numB === null) return -1;
    return numA - numB;
  }
  const textA = column ? cellText(exportCell(column, a, ctx)) : a.name;
  const textB = column ? cellText(exportCell(column, b, ctx)) : b.name;
  if (!textA && textB) return 1;
  if (textA && !textB) return -1;
  return textA.localeCompare(textB, 'en', { numeric: true, sensitivity: 'base' });
}

export function applyViewToItems(
  items: readonly ItemDto[],
  columns: readonly ColumnDto[],
  config: ExportViewConfig | undefined,
  ctx: ExportContext,
): ItemDto[] {
  if (!config) return [...items];
  const byKey = new Map(columns.map((column) => [column.key, column]));
  // Nested groups + rich operators (number equals, relative dates): see `@/lib/filter-tree`.
  const tree = compileFilterTree(config.filters);
  const hasRules = treeHasRules(tree);
  const search = config.search?.trim().toLowerCase();
  const people = columns.filter((column) => column.type === 'people');
  const filtered = items.filter((item) => {
    if (hasRules && !matchFilterTree(tree, (rule) => matchesRule(rule, item, byKey, ctx))) return false;
    if (config.personFilter) {
      if (!people.some((column) => idsOf(column, item).includes(config.personFilter as string))) return false;
    }
    if (search) {
      const haystack = [item.name, ...columns.map((column) => cellText(exportCell(column, item, ctx)))]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  const sort = config.sort ?? [];
  if (sort.length === 0) return filtered;
  return filtered
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      for (const entry of sort) {
        const column = entry.columnKey === 'name' ? undefined : byKey.get(entry.columnKey);
        const result = compare(left.item, right.item, column, ctx);
        if (result !== 0) return entry.direction === 'desc' ? -result : result;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

/** Visible columns in view order (the name column always stays first). */
export function visibleColumns(columns: readonly ColumnDto[], config: ExportViewConfig | undefined): ColumnDto[] {
  const hidden = new Set(config?.hiddenColumnKeys ?? []);
  const visible = columns.filter((column) => column.type === 'name' || (!column.hidden && !hidden.has(column.key)));
  const order = config?.columnOrder ?? [];
  if (order.length === 0) return visible;
  const rank = new Map(order.map((key, index) => [key, index]));
  return visible
    .map((column, index) => ({ column, index }))
    .sort((a, b) => {
      if (a.column.type === 'name') return -1;
      if (b.column.type === 'name') return 1;
      const ra = rank.get(a.column.key) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.column.key) ?? Number.MAX_SAFE_INTEGER;
      return ra === rb ? a.index - b.index : ra - rb;
    })
    .map((entry) => entry.column);
}
