/**
 * "Group by" a column: bucket the (already filtered + sorted) items by a status, dropdown,
 * people, checkbox or date column. Items with several people / labels appear in each of
 * their buckets (like monday). Pure and client-safe.
 */
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { DateBucket, GroupBySpec } from './draft';
import { labelsOf } from './filter-model';

const GROUPABLE: ReadonlySet<ColumnType> = new Set([
  'status',
  'dropdown',
  'people',
  'checkbox',
  'date',
  'timeline',
  'last_updated',
  'creation_log',
]);
const DATE_LIKE: ReadonlySet<ColumnType> = new Set(['date', 'timeline', 'last_updated', 'creation_log']);

export function isGroupable(column: Pick<ColumnDto, 'type' | 'scope'>): boolean {
  return column.scope === 'item' && GROUPABLE.has(column.type);
}

export function isDateLike(column: Pick<ColumnDto, 'type'>): boolean {
  return DATE_LIKE.has(column.type);
}

export interface ItemBucket {
  readonly key: string;
  readonly title: string;
  /** Label palette token name (`green`, `blue`…). */
  readonly color: string;
  readonly userId?: string;
  readonly items: readonly ItemDto[];
}

export const EMPTY_BUCKET = '__empty__';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PERSON_COLORS = ['blue', 'purple', 'teal', 'pink', 'orange', 'indigo', 'green', 'berry', 'sky', 'brown'];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** ISO date (YYYY-MM-DD) a date-like cell represents, or null. */
export function dateOf(column: ColumnDto, item: ItemDto): string | null {
  if (column.type === 'last_updated') return item.updatedAt.slice(0, 10);
  if (column.type === 'creation_log') return item.createdAt.slice(0, 10);
  const raw = record(item.values[column.key]);
  if (!raw) return null;
  const value = column.type === 'timeline' ? raw.from : raw.date;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function parseIso(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** Sortable bucket key + display title for a date. */
export function dateBucket(date: string, bucket: DateBucket): { key: string; title: string } {
  const value = parseIso(date);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  if (bucket === 'year') return { key: `${year}`, title: `${year}` };
  if (bucket === 'quarter') {
    const quarter = Math.floor(month / 3) + 1;
    return { key: `${year}-Q${quarter}`, title: `Q${quarter} ${year}` };
  }
  if (bucket === 'month') return { key: `${year}-${String(month + 1).padStart(2, '0')}`, title: `${MONTHS[month]} ${year}` };
  // Week starting Monday.
  const day = (value.getUTCDay() + 6) % 7;
  const start = new Date(value.getTime() - day * 86_400_000);
  const key = start.toISOString().slice(0, 10);
  return { key, title: `Week of ${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}, ${start.getUTCFullYear()}` };
}

function idsOf(column: ColumnDto, item: ItemDto): string[] {
  const raw = record(item.values[column.key]);
  if (!raw) return [];
  if (typeof raw.labelId === 'string') return [raw.labelId];
  const list = raw.labelIds ?? raw.ids;
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [];
}

function push(map: Map<string, ItemDto[]>, key: string, item: ItemDto): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

export function bucketItems(
  items: readonly ItemDto[],
  column: ColumnDto,
  spec: Pick<GroupBySpec, 'bucket'>,
  users: readonly UserSummaryDto[],
): ItemBucket[] {
  const map = new Map<string, ItemDto[]>();
  const emptyTitle = isDateLike(column) ? 'No date' : column.type === 'people' ? 'Unassigned' : 'No value';

  if (column.type === 'checkbox') {
    for (const item of items) push(map, item.values[column.key] === true ? 'true' : 'false', item);
    return [
      { key: 'true', title: 'Checked', color: 'green', items: map.get('true') ?? [] },
      { key: 'false', title: 'Not checked', color: 'gray', items: map.get('false') ?? [] },
    ].filter((entry) => entry.items.length > 0);
  }

  if (isDateLike(column)) {
    const bucket = spec.bucket ?? 'month';
    const titles = new Map<string, string>();
    for (const item of items) {
      const date = dateOf(column, item);
      if (!date) {
        push(map, EMPTY_BUCKET, item);
        continue;
      }
      const entry = dateBucket(date, bucket);
      titles.set(entry.key, entry.title);
      push(map, entry.key, item);
    }
    const keys = [...titles.keys()].sort();
    const out: ItemBucket[] = keys.map((key) => ({ key, title: titles.get(key) ?? key, color: 'blue', items: map.get(key) ?? [] }));
    const empty = map.get(EMPTY_BUCKET);
    return empty ? [...out, { key: EMPTY_BUCKET, title: emptyTitle, color: 'gray', items: empty }] : out;
  }

  const defaults = new Set(labelsOf(column).filter((label) => label.isDefault).map((label) => label.id));
  for (const item of items) {
    const ids = idsOf(column, item).filter((id) => !defaults.has(id));
    if (ids.length === 0) push(map, EMPTY_BUCKET, item);
    for (const id of new Set(ids)) push(map, id, item);
  }

  let out: ItemBucket[];
  if (column.type === 'people') {
    const byId = new Map(users.map((user) => [user.id, user]));
    out = [...map.keys()]
      .filter((key) => key !== EMPTY_BUCKET)
      .map((key) => ({ key, title: byId.get(key)?.name ?? 'Former member', color: 'blue', userId: key, items: map.get(key) ?? [] }))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((entry, index) => ({ ...entry, color: PERSON_COLORS[index % PERSON_COLORS.length] ?? 'blue' }));
  } else {
    out = labelsOf(column)
      .filter((label) => map.has(label.id))
      .map((label) => ({ key: label.id, title: label.name, color: label.color, items: map.get(label.id) ?? [] }));
  }
  const empty = map.get(EMPTY_BUCKET);
  return empty ? [...out, { key: EMPTY_BUCKET, title: emptyTitle, color: 'gray', items: empty }] : out;
}
