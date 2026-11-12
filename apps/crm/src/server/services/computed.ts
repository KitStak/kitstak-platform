/**
 * Read-time values for computed columns (progress, formula, mirror, last_updated,
 * creation_log, item_id, button). Pure: callers pre-load linked items for mirrors.
 */
import type { ColumnType, Label } from '@/server/db/schema/cell-values';
import type { ComputedValues } from './contracts/dto';
import { evaluateFormula, type FormulaScalar } from './formula';

export interface ComputeColumn {
  readonly key: string;
  readonly type: ColumnType;
  readonly settings: unknown;
}

export interface ComputeItem {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly values: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
}

/** Linked item values for mirror columns: itemId → connect column key → linked items. */
export type LinkedItemsIndex = ReadonlyMap<string, ReadonlyMap<string, readonly ComputeItem[]>>;
/** Columns of other boards (for mirror display conversions): boardId → columns. */
export type ForeignColumnsIndex = ReadonlyMap<string, readonly ComputeColumn[]>;

const COMPUTED_TYPES = new Set<ColumnType>([
  'progress',
  'formula',
  'mirror',
  'last_updated',
  'creation_log',
  'item_id',
  'button',
]);

export function hasComputedColumns(columns: readonly ComputeColumn[]): boolean {
  return columns.some((column) => COMPUTED_TYPES.has(column.type));
}

function labelsOf(settings: unknown): readonly Label[] {
  const list = (settings as { labels?: unknown } | null)?.labels;
  return Array.isArray(list) ? (list as Label[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Convert a stored cell to a scalar usable in formulas / mirror aggregation. */
export function cellToScalar(column: ComputeColumn, value: unknown): FormulaScalar {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case 'number':
    case 'rating':
      return typeof value === 'number' ? value : null;
    case 'currency':
      return isRecord(value) && typeof value.amount === 'number' ? value.amount : null;
    case 'checkbox':
      return value === true;
    case 'status': {
      const labelId = isRecord(value) ? value.labelId : undefined;
      return labelsOf(column.settings).find((label) => label.id === labelId)?.name ?? null;
    }
    case 'dropdown': {
      const ids = isRecord(value) && Array.isArray(value.labelIds) ? value.labelIds : [];
      const labels = labelsOf(column.settings);
      return ids
        .map((id) => labels.find((label) => label.id === id)?.name ?? '')
        .filter(Boolean)
        .join(', ');
    }
    case 'date':
      return isRecord(value) && typeof value.date === 'string' ? value.date : null;
    case 'timeline':
      return isRecord(value) && typeof value.from === 'string' ? `${value.from} - ${String(value.to)}` : null;
    case 'people':
      return isRecord(value) && Array.isArray(value.ids) ? value.ids.length : 0;
    case 'email':
      return isRecord(value) && typeof value.email === 'string' ? value.email : null;
    case 'phone':
      return isRecord(value) && typeof value.phone === 'string' ? value.phone : null;
    case 'link':
      return isRecord(value) && typeof value.url === 'string'
        ? typeof value.text === 'string'
          ? value.text
          : value.url
        : null;
    case 'tags':
      return isRecord(value) && Array.isArray(value.tags) ? value.tags.join(', ') : null;
    case 'location':
      return isRecord(value) && typeof value.address === 'string' ? value.address : null;
    case 'country':
      return isRecord(value) && typeof value.code === 'string' ? value.code : null;
    case 'connect_boards':
    case 'files': {
      const list = isRecord(value) ? (value.itemIds ?? value.fileIds) : undefined;
      return Array.isArray(list) ? list.length : 0;
    }
    case 'text':
    case 'long_text':
    case 'name':
      return typeof value === 'string' ? value : null;
    default:
      return null;
  }
}

function progressFor(item: ComputeItem, column: ComputeColumn, columns: readonly ComputeColumn[]): number {
  const configured = (column.settings as { sourceColumnKeys?: string[] } | null)?.sourceColumnKeys ?? [];
  const sources = columns.filter(
    (candidate) =>
      (candidate.type === 'status' || candidate.type === 'checkbox') &&
      (configured.length === 0 || configured.includes(candidate.key)),
  );
  if (sources.length === 0) return 0;
  let done = 0;
  for (const source of sources) {
    const value = item.values[source.key];
    if (source.type === 'checkbox') {
      if (value === true) done += 1;
      continue;
    }
    const labelId = isRecord(value) ? value.labelId : undefined;
    if (labelsOf(source.settings).some((label) => label.id === labelId && label.isDone)) done += 1;
  }
  return Math.round((done / sources.length) * 100);
}

type MirrorAggregate = 'list' | 'sum' | 'average' | 'min' | 'max' | 'count' | 'earliest' | 'latest';

function mirrorFor(
  item: ComputeItem,
  column: ComputeColumn,
  linked: LinkedItemsIndex,
  foreignColumns: ForeignColumnsIndex,
): { display: string; values: FormulaScalar[]; value: number | null } {
  const settings = (column.settings ?? {}) as {
    connectColumnKey?: string;
    mirroredColumnKeys?: Record<string, string>;
    aggregate?: MirrorAggregate;
  };
  const targets = settings.connectColumnKey
    ? (linked.get(item.id)?.get(settings.connectColumnKey) ?? [])
    : [];
  const values: FormulaScalar[] = [];
  for (const target of targets) {
    const key = settings.mirroredColumnKeys?.[target.boardId];
    if (!key) continue;
    const targetColumn = foreignColumns.get(target.boardId)?.find((candidate) => candidate.key === key);
    if (key === 'name') values.push(target.name);
    else if (targetColumn) values.push(cellToScalar(targetColumn, target.values[key]));
  }
  const present = values.filter((value) => value !== null && value !== '');
  const numbers = present.filter((value): value is number => typeof value === 'number');
  const aggregate = settings.aggregate ?? 'list';
  let value: number | null = null;
  switch (aggregate) {
    case 'sum':
      value = numbers.reduce((sum, entry) => sum + entry, 0);
      break;
    case 'average':
      value = numbers.length ? numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length : null;
      break;
    case 'min':
      value = numbers.length ? Math.min(...numbers) : null;
      break;
    case 'max':
      value = numbers.length ? Math.max(...numbers) : null;
      break;
    case 'count':
      value = present.length;
      break;
    default:
      break;
  }
  let display: string;
  if (aggregate === 'earliest' || aggregate === 'latest') {
    const sorted = present.map(String).sort();
    display = (aggregate === 'earliest' ? sorted[0] : sorted.at(-1)) ?? '';
  } else if (value !== null) {
    display = String(Math.round(value * 100) / 100);
  } else {
    display = present.map(String).join(', ');
  }
  return { display, values, value };
}

export interface ComputeOptions {
  readonly linked?: LinkedItemsIndex;
  readonly foreignColumns?: ForeignColumnsIndex;
}

/** Computed values for one item. Mirrors resolve before formulas so formulas can use them. */
export function computeItemValues(
  item: ComputeItem,
  columns: readonly ComputeColumn[],
  options: ComputeOptions = {},
): ComputedValues {
  const out: Record<string, unknown> = {};
  const linked = options.linked ?? new Map();
  const foreign = options.foreignColumns ?? new Map();
  const mirrorScalars = new Map<string, FormulaScalar>();

  for (const column of columns) {
    switch (column.type) {
      case 'item_id':
        out[column.key] = item.id;
        break;
      case 'last_updated':
        out[column.key] = { at: item.updatedAt.toISOString(), userId: item.updatedBy };
        break;
      case 'creation_log':
        out[column.key] = { at: item.createdAt.toISOString(), userId: item.createdBy };
        break;
      case 'progress':
        out[column.key] = progressFor(item, column, columns);
        break;
      case 'button':
        out[column.key] = null;
        break;
      case 'mirror': {
        const mirror = mirrorFor(item, column, linked, foreign);
        out[column.key] = { display: mirror.display, values: mirror.values };
        mirrorScalars.set(column.key, mirror.value ?? (mirror.display || null));
        break;
      }
      default:
        break;
    }
  }

  const byKey = new Map(columns.map((column) => [column.key, column]));
  const resolving = new Set<string>();
  const resolve = (key: string): FormulaScalar => {
    if (key === 'name') return item.name;
    const column = byKey.get(key);
    if (!column) return null;
    if (column.type === 'mirror') return mirrorScalars.get(key) ?? null;
    if (column.type === 'progress') return (out[key] as number | undefined) ?? 0;
    if (column.type === 'formula') {
      if (resolving.has(key)) return null; // circular reference
      resolving.add(key);
      const nested = evaluateFormula(
        (column.settings as { expression?: string } | null)?.expression ?? '',
        resolve,
      );
      resolving.delete(key);
      return nested.result;
    }
    return cellToScalar(column, item.values[key]);
  };

  for (const column of columns) {
    if (column.type !== 'formula') continue;
    const expression = (column.settings as { expression?: string } | null)?.expression ?? '';
    resolving.add(column.key);
    const result = evaluateFormula(expression, resolve);
    resolving.delete(column.key);
    out[column.key] = result.error ? { result: null, error: result.error } : { result: result.result };
  }
  return out;
}
