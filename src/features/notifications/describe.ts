/**
 * Pure presentation model for notifications: sentence segments, day grouping, deep links and
 * compact relative time. No React, no I/O (unit-tested in describe.test.ts).
 */
import type { NotificationDto, NotificationKind } from '@/server/services/contracts/dto';

export interface Segment {
  readonly text: string;
  readonly strong?: boolean;
}

export interface NotificationDescription {
  /** Display name of who caused it ("Automation" for system events). */
  readonly actorName: string;
  /** True for automations / reminders: render a system icon instead of an avatar. */
  readonly system: boolean;
  readonly segments: readonly Segment[];
  /** Quoted update preview (mentions, replies, updates), already trimmed. */
  readonly preview: string | null;
  /** Plain-text sentence for aria-labels. */
  readonly label: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Object names inside free-text system messages: quoted text and file names (no spaces). */
const OBJECT_NAME = /"[^"]+"|“[^”]+”|[\w()[\].-]+\.(?:csv|xlsx?|json|pdf|docx?|txt|zip|png|jpe?g)\b/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a system message into segments, bolding object names: quoted text, file names such
 * as `import-contacts.csv`, and any `names` given (e.g. the board).
 */
export function emphasize(message: string, names: readonly string[] = []): Segment[] {
  if (!message) return [];
  const extra = names.filter((name) => name.length > 2).map(escapeRegExp);
  const pattern = new RegExp(
    extra.length ? `${OBJECT_NAME.source}|${extra.join('|')}` : OBJECT_NAME.source,
    'gi',
  );
  const out: Segment[] = [];
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ text: message.slice(last, start) });
    out.push({ text: match[0], strong: true });
    last = start + match[0].length;
  }
  if (last < message.length) out.push({ text: message.slice(last) });
  return out;
}

const SYSTEM_KINDS: ReadonlySet<NotificationKind> = new Set(['automation', 'due_date']);

export function isSystemNotification(entry: Pick<NotificationDto, 'kind' | 'actor'>): boolean {
  return SYSTEM_KINDS.has(entry.kind) || entry.actor === null;
}

const PREVIEW_MAX = 160;

export function trimPreview(text: string | null, max = PREVIEW_MAX): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function describeNotification(entry: NotificationDto): NotificationDescription {
  const payload = entry.payload ?? {};
  const system = isSystemNotification(entry);
  const actorName = entry.actor?.name ?? (entry.kind === 'due_date' ? 'Reminder' : 'Automation');
  const item = entry.itemName ?? str(payload.itemName) ?? 'an item';
  const board = entry.boardName ?? str(payload.boardName) ?? 'a board';
  const column = str(payload.columnTitle);
  const actor: Segment = { text: actorName, strong: true };
  const target: Segment = { text: item, strong: true };
  let segments: Segment[];
  switch (entry.kind) {
    case 'mention':
      segments = [actor, { text: ' mentioned you on ' }, target];
      break;
    case 'assigned':
      segments = [actor, { text: ' assigned you to ' }, target];
      if (column && column.toLowerCase() !== 'person' && column.toLowerCase() !== 'people')
        segments.push({ text: ` as ${column}` });
      break;
    case 'update_reply':
      segments = [actor, { text: ' replied to your update on ' }, target];
      break;
    case 'update_on_subscribed':
      segments = [actor, { text: ' posted an update on ' }, target];
      break;
    case 'status_change': {
      const to = str(payload.toLabel) ?? str(payload.label);
      segments = [actor, { text: ` changed ${column ?? 'the status'}` }];
      if (to) segments.push({ text: ' to ' }, { text: to, strong: true });
      segments.push({ text: ' on ' }, target);
      break;
    }
    case 'due_date': {
      const date = str(payload.date);
      segments = [target, { text: date ? ` is due ${date}` : ' has a date arriving today' }];
      break;
    }
    case 'invitation':
      segments = [actor, { text: ' invited you to ' }, { text: board, strong: true }];
      break;
    case 'automation': {
      const message = str(payload.message);
      const hasItem = Boolean(entry.itemName ?? str(payload.itemName));
      const boardNames = entry.boardName ? [entry.boardName] : [];
      if (!message)
        segments = hasItem
          ? [{ text: 'An automation ran on ' }, target]
          : [{ text: 'An automation ran on ' }, { text: board, strong: true }];
      else if (!hasItem) segments = emphasize(message, boardNames);
      else if (message.includes(item)) {
        const at = message.indexOf(item);
        segments = [
          ...emphasize(message.slice(0, at), boardNames),
          target,
          ...emphasize(message.slice(at + item.length), boardNames),
        ];
      } else segments = [...emphasize(message, boardNames), { text: ' · ' }, target];
      break;
    }
    case 'reaction': {
      const emoji = str(payload.emoji);
      segments = [actor, { text: ` reacted${emoji ? ` ${emoji}` : ''} to your update on ` }, target];
      break;
    }
    case 'board_shared':
      segments = [
        actor,
        { text: ' shared the board ' },
        { text: board, strong: true },
        { text: ' with you' },
      ];
      break;
    default:
      segments = [actor, { text: ' updated ' }, target];
  }
  const showPreview =
    entry.kind === 'mention' || entry.kind === 'update_reply' || entry.kind === 'update_on_subscribed';
  return {
    actorName,
    system,
    segments,
    preview: showPreview ? trimPreview(str(payload.preview)) : null,
    label: segments.map((segment) => segment.text).join(''),
  };
}

// ---------------------------------------------------------------------------------------------

export type DayBucket = 'Today' | 'Yesterday' | 'Earlier';

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayBucketFor(iso: string, now: Date = new Date()): DayBucket {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'Earlier';
  const today = dayStart(now);
  const day = dayStart(new Date(time));
  if (day >= today) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  return day >= yesterday ? 'Yesterday' : 'Earlier';
}

export interface DayGroup<T> {
  readonly bucket: DayBucket;
  readonly entries: readonly T[];
}

/** Group newest-first entries into Today / Yesterday / Earlier, preserving order. */
export function groupByDay<T extends { readonly createdAt: string }>(
  entries: readonly T[],
  now: Date = new Date(),
): DayGroup<T>[] {
  const order: DayBucket[] = ['Today', 'Yesterday', 'Earlier'];
  const buckets = new Map<DayBucket, T[]>();
  for (const entry of entries) {
    const bucket = dayBucketFor(entry.createdAt, now);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry]);
  }
  return order.flatMap((bucket) => {
    const list = buckets.get(bucket);
    return list ? [{ bucket, entries: list }] : [];
  });
}

// ---------------------------------------------------------------------------------------------

/** Deep link that opens the item panel in context (`?item=`), else the board, else null. */
export function notificationHref(
  orgSlug: string,
  entry: Pick<NotificationDto, 'boardId' | 'itemId' | 'updateId'>,
): string | null {
  if (!entry.boardId) return null;
  const base = `/${orgSlug}/boards/${entry.boardId}`;
  if (!entry.itemId) return base;
  const params = new URLSearchParams({ item: entry.itemId });
  if (entry.updateId) params.set('update', entry.updateId);
  return `${base}?${params.toString()}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "3h", "2d", then "Nov 2" (or "Nov 2, 2025" for another year). */
export function formatShortTime(iso: string, now: Date = new Date()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const diff = Math.max(0, now.getTime() - time);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const date = new Date(time);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Full timestamp for tooltips. */
export function formatFullTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Date(time).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------------------------

export interface NotificationCluster<T> {
  /** Newest event of the run; rendered as the row. */
  readonly head: T;
  /** Older identical events folded under "+N similar" (newest first). */
  readonly similar: readonly T[];
}

/**
 * Identity of a system event for folding: same kind, item and message. The board is not part
 * of it, so the same import/automation firing across boards folds into one row.
 */
function similarityKey(entry: NotificationDto): string | null {
  if (!isSystemNotification(entry)) return null;
  const payload = entry.payload ?? {};
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  return [entry.kind, entry.itemId ?? '', message].join('|');
}

/**
 * Fold consecutive identical system events (automations, reminders, imports) into one row so a
 * burst does not become a wall of duplicates. People's events are never folded.
 */
export function clusterSimilar<T extends NotificationDto>(entries: readonly T[]): NotificationCluster<T>[] {
  const out: { head: T; similar: T[] }[] = [];
  let lastKey: string | null = null;
  for (const entry of entries) {
    const key = similarityKey(entry);
    const previous = out[out.length - 1];
    if (key !== null && key === lastKey && previous) previous.similar.push(entry);
    else out.push({ head: entry, similar: [] });
    lastKey = key;
  }
  return out;
}

/** Feed rows a mark-all affects locally (mirrors the server's scope, actor name included). */
export function inScope(entry: NotificationDto, input: { readonly boardId?: string; readonly q?: string }): boolean {
  if (input.boardId && entry.boardId !== input.boardId) return false;
  if (input.q) {
    const q = input.q.toLowerCase();
    const payload = entry.payload as { preview?: unknown; message?: unknown } | null;
    const text = [entry.itemName, entry.boardName, entry.actor?.name, payload?.preview, payload?.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    if (!text.includes(q)) return false;
  }
  return true;
}
