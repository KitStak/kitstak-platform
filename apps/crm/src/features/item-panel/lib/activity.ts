/** Activity log shaping: day buckets, filters and human descriptions. Pure. */
import type { ActivityDto, ColumnDto } from '@/server/services/contracts/dto';
import { dayKey } from './format';

export interface ActivityFilter {
  /** Column key, `'name'` for renames, or null for all. */
  readonly columnKey: string | null;
  /** Actor user id, `'automation'`, or null for all. */
  readonly actorId: string | null;
}

export const NO_FILTER: ActivityFilter = { columnKey: null, actorId: null };

export function matchesFilter(entry: ActivityDto, filter: ActivityFilter): boolean {
  if (filter.columnKey && entry.columnKey !== filter.columnKey) return false;
  if (filter.actorId === 'automation') return entry.automationId !== null;
  if (filter.actorId && entry.actorId !== filter.actorId) return false;
  return true;
}

export interface ActivityDay {
  readonly key: string;
  readonly entries: readonly ActivityDto[];
}

/** Groups newest-first entries into local-day buckets, keeping order. */
export function groupByDay(entries: readonly ActivityDto[]): ActivityDay[] {
  const days: { key: string; entries: ActivityDto[] }[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, entries: [entry] });
  }
  return days;
}

export interface ActorOption {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export function distinctActors(entries: readonly ActivityDto[]): ActorOption[] {
  const seen = new Map<string, ActorOption>();
  for (const entry of entries) {
    if (entry.actorId && !seen.has(entry.actorId)) {
      seen.set(entry.actorId, { id: entry.actorId, name: entry.actorName ?? 'Unknown user', image: entry.actorImage });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : null;
}

/** Sentence fragment after the actor's name ("changed Stage", "uploaded a file"). */
export function describeActivity(
  entry: ActivityDto,
  columnsByKey: ReadonlyMap<string, ColumnDto>,
  term: string,
): string {
  const noun = term.toLowerCase();
  const column = entry.columnKey ? columnsByKey.get(entry.columnKey) : undefined;
  switch (entry.action) {
    case 'item.created':
      return `created this ${noun}`;
    case 'subitem.created':
      return 'created a subitem';
    case 'item.renamed':
      return `renamed the ${noun}`;
    case 'item.value_changed':
    case 'item.status_changed':
    case 'item.updated':
      return column ? `changed ${column.title}` : 'changed a column that was removed';
    case 'item.moved':
      return 'moved it to another group';
    case 'item.moved_board':
      return 'moved it to another board';
    case 'item.reordered':
      return 'reordered it';
    case 'item.duplicated':
      return `duplicated this ${noun}`;
    case 'item.archived':
      return `archived this ${noun}`;
    case 'item.deleted':
      return `deleted this ${noun}`;
    case 'item.restored':
      return `restored this ${noun}`;
    case 'update.created':
      return 'posted an update';
    case 'update.replied':
      return 'replied to an update';
    case 'update.deleted':
      return 'deleted an update';
    case 'file.uploaded': {
      const name = readString(entry.after, 'name');
      return name ? `uploaded ${name}` : 'uploaded a file';
    }
    case 'file.deleted': {
      const name = readString(entry.before, 'name');
      return name ? `deleted ${name}` : 'deleted a file';
    }
    default:
      return entry.action.replace(/[._]/g, ' ');
  }
}

/** Value-change entries render before → after with real cell displays. */
export function isValueChange(entry: ActivityDto): boolean {
  return (
    (entry.action === 'item.value_changed' || entry.action === 'item.status_changed' || entry.action === 'item.updated') &&
    entry.columnKey !== null
  );
}

/** Short quoted preview for update activity ("Sent the ROI model…"). */
export function activityPreview(entry: ActivityDto): string | null {
  return readString(entry.after, 'preview');
}
