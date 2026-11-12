/**
 * Pure My work model: date buckets, done detection, filtering and ordering (unit-tested).
 * Weeks run Monday → Sunday. "Today" is the viewer's local calendar day.
 */
import type {
  MyWorkBoardDto,
  MyWorkDto,
  MyWorkItemDto,
  MyWorkLabelDto,
} from '@/server/services/contracts/inbox-mywork';

export type BucketId = 'overdue' | 'today' | 'this-week' | 'next-week' | 'later' | 'no-date' | 'records';

export const BUCKETS: readonly { id: BucketId; title: string; tone: 'danger' | 'primary' | 'neutral' }[] = [
  { id: 'overdue', title: 'Past dates', tone: 'danger' },
  { id: 'today', title: 'Today', tone: 'primary' },
  { id: 'this-week', title: 'This week', tone: 'neutral' },
  { id: 'next-week', title: 'Next week', tone: 'neutral' },
  { id: 'later', title: 'Later', tone: 'neutral' },
  { id: 'no-date', title: 'Without a date', tone: 'neutral' },
  { id: 'records', title: 'Other assigned items', tone: 'neutral' },
];

/** Groups whose name says the work inside is finished (Closed lost, Completed, Done...). */
const CLOSED_GROUP = /\b(closed|completed?|done|won|lost|churned|cancel\w*|archived?|finished)\b/i;

export function isClosedGroup(title: string): boolean {
  return CLOSED_GROUP.test(title);
}

/** Record boards (contacts, accounts) and boards without a due date are not dated work. */
export function isRecordBoard(board: MyWorkBoardDto): boolean {
  return board.recordList || !board.date;
}

/** Local `YYYY-MM-DD` for a Date. */
export function toIsoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse `YYYY-MM-DD` as a local date (never UTC-shifted). */
export function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Sunday that ends the Monday-based week containing `date`. */
function endOfWeek(date: Date): Date {
  const weekday = (date.getDay() + 6) % 7; // Monday = 0
  return addDays(date, 6 - weekday);
}

export function bucketFor(date: string | null, now: Date = new Date()): BucketId {
  if (!date) return 'no-date';
  const day = parseIsoDay(date);
  if (!day) return 'no-date';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day < today) return 'overdue';
  if (day.getTime() === today.getTime()) return 'today';
  const weekEnd = endOfWeek(today);
  if (day <= weekEnd) return 'this-week';
  if (day <= addDays(weekEnd, 7)) return 'next-week';
  return 'later';
}

export function labelFor(board: MyWorkBoardDto | undefined, labelId: string | null): MyWorkLabelDto | null {
  if (!board?.status || !labelId) return null;
  return board.status.labels.find((label) => label.id === labelId) ?? null;
}

/**
 * Whether the item is finished: its status is terminal (done, or a closed outcome such as Lost
 * or Cancelled) or it sits in a closed/completed group. Finished items are hidden unless
 * "Show done" is on and are never flagged overdue.
 */
export function isDone(
  board: MyWorkBoardDto | undefined,
  item: Pick<MyWorkItemDto, 'statusLabelId'> & Partial<Pick<MyWorkItemDto, 'groupTitle'>>,
): boolean {
  const label = labelFor(board, item.statusLabelId);
  if (label?.isDone || label?.isClosed) return true;
  return item.groupTitle ? isClosedGroup(item.groupTitle) : false;
}

/** The label "Mark done" writes: the first done label of the board's status column. */
export function doneLabelOf(board: MyWorkBoardDto | undefined): MyWorkLabelDto | null {
  return board?.status?.labels.find((label) => label.isDone) ?? null;
}

/** Plain completion labels that a one-click "done" circle may set (not Won / Lost outcomes). */
const NEUTRAL_DONE = /^(done|complete|completed|finished|resolved)$/i;

export function isNeutralDoneLabel(label: Pick<MyWorkLabelDto, 'name'> | null | undefined): boolean {
  return Boolean(label && NEUTRAL_DONE.test(label.name.trim()));
}

export interface MyWorkFilters {
  readonly boardId: string | null;
  readonly search: string;
  readonly showDone: boolean;
  /** Include contacts/accounts and boards without a date column (off by default). */
  readonly showRecords?: boolean;
}

export interface MyWorkRow {
  readonly item: MyWorkItemDto;
  readonly board: MyWorkBoardDto;
  readonly done: boolean;
}

export interface MyWorkSection {
  readonly id: BucketId;
  readonly title: string;
  readonly tone: 'danger' | 'primary' | 'neutral';
  readonly rows: readonly MyWorkRow[];
}

export interface MyWorkView {
  readonly sections: readonly MyWorkSection[];
  readonly total: number;
  /** Items hidden only because they are done. */
  readonly hiddenDone: number;
  /** Items hidden only because they are reference records (see isRecordBoard). */
  readonly hiddenRecords: number;
}

function matches(row: MyWorkRow, query: string): boolean {
  if (!query) return true;
  const haystack = `${row.item.name} ${row.board.name} ${row.item.groupTitle}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/** Build the bucketed, filtered view. Sections without rows are omitted. */
export function buildMyWorkView(data: MyWorkDto, filters: MyWorkFilters, now: Date = new Date()): MyWorkView {
  const boards = new Map(data.boards.map((board) => [board.id, board]));
  const query = filters.search.trim();
  const byBucket = new Map<BucketId, MyWorkRow[]>();
  let total = 0;
  let hiddenDone = 0;
  let hiddenRecords = 0;
  for (const item of data.items) {
    const board = boards.get(item.boardId);
    if (!board) continue;
    if (filters.boardId && item.boardId !== filters.boardId) continue;
    const row: MyWorkRow = { item, board, done: isDone(board, item) };
    if (!matches(row, query)) continue;
    if (row.done && !filters.showDone) {
      hiddenDone += 1;
      continue;
    }
    const record = isRecordBoard(board);
    if (record && !filters.showRecords) {
      hiddenRecords += 1;
      continue;
    }
    total += 1;
    const bucket: BucketId = record ? 'records' : bucketFor(item.date, now);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), row]);
  }
  const sections = BUCKETS.flatMap((bucket) => {
    const rows = byBucket.get(bucket.id);
    if (!rows) return [];
    const sorted = [...rows].sort(
      (a, b) =>
        (a.item.date ?? '').localeCompare(b.item.date ?? '') ||
        Number(a.done) - Number(b.done) ||
        a.item.name.localeCompare(b.item.name),
    );
    // A past-dates section that holds only finished work is history, not a warning.
    if (bucket.id === 'overdue' && sorted.every((row) => row.done))
      return [{ ...bucket, title: 'Completed', tone: 'neutral' as const, rows: sorted }];
    return [{ ...bucket, rows: sorted }];
  });
  return { sections, total, hiddenDone, hiddenRecords };
}

/** Immutable patch of one item in the My work payload. */
export function patchMyWorkItem(
  data: MyWorkDto,
  itemId: string,
  patch: Partial<Pick<MyWorkItemDto, 'statusLabelId' | 'date'>>,
): MyWorkDto {
  return {
    ...data,
    items: data.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
  };
}

/**
 * Human date for a row, one format per bucket so a section reads as a column:
 * Today → "Today"; this/next week → "Tue, Nov 10"; past and later → "Nov 14" (year added when
 * it differs from this year). Without a bucket it is derived from the date.
 */
export function formatDueDate(date: string, now: Date = new Date(), bucket?: BucketId): string {
  const day = parseIsoDay(date);
  if (!day) return date;
  const resolved = bucket ?? bucketFor(date, now);
  if (resolved === 'today') return 'Today';
  const otherYear = day.getFullYear() !== now.getFullYear();
  if ((resolved === 'this-week' || resolved === 'next-week') && !otherYear)
    return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return day.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(otherYear ? { year: 'numeric' } : {}),
  });
}
