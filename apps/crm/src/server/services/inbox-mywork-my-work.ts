/**
 * My work: every top-level item assigned to the caller (any people column) across the boards
 * they can see. Grouping into date buckets happens on the client (user's local "today").
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { boardMembers, boards, columns, groups, items } from '@/server/db/schema';
import { visibleBoardsPredicate } from './access';
import { isOrgAdmin, type ServiceContext } from './context';
import {
  MY_WORK_MAX_ITEMS,
  type MyWorkBoardDto,
  type MyWorkDto,
  type MyWorkItemDto,
  type MyWorkLabelDto,
  type MyWorkQuery,
} from './contracts/inbox-mywork';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Labels from a status column's settings (defensive: settings is jsonb). */
export function statusLabelsOf(settings: unknown): MyWorkLabelDto[] {
  if (!isRecord(settings) || !Array.isArray(settings.labels)) return [];
  return settings.labels
    .filter(
      (label): label is { id: string; name: string; color: string; isDone?: boolean; position?: number } =>
        isRecord(label) &&
        typeof label.id === 'string' &&
        typeof label.name === 'string' &&
        label.isDefault !== true,
    )
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((label) => ({
      id: label.id,
      name: label.name,
      color: typeof label.color === 'string' ? label.color : 'gray',
      isDone: label.isDone === true,
      isClosed: label.isDone === true || isTerminalLabelName(label.name),
    }));
}

/** Closed outcomes that are not "done" but still end the work (Lost, Cancelled, Closed...). */
const TERMINAL_LABEL =
  /\b(lost|cancel\w*|closed|rejected|declined|churned|abandoned|disqualified|dead|void|won|completed?|done)\b/i;

export function isTerminalLabelName(name: string): boolean {
  return TERMINAL_LABEL.test(name);
}

/** Whether `value` (a people cell) lists `userId`. */
export function peopleIncludes(value: unknown, userId: string): boolean {
  return isRecord(value) && Array.isArray(value.ids) && value.ids.includes(userId);
}

type StatusColumn = NonNullable<MyWorkBoardDto['status']>;

/** Columns that classify a record (type, health, priority...) rather than track progress. */
const NON_PROGRESS_STATUS =
  /\b(type|health|priority|tier|segment|source|category|industry|rating|size|region|channel|sentiment|risk|role|persona|lifecycle)\b/i;
const PROGRESS_STATUS = /\b(status|stage|progress|state|phase)\b/i;

/**
 * Pick the status column that represents "progress": it must be named status/stage/progress
 * (or carry a done label without being a classification like Type/Health/Priority). Among
 * those, a done label wins, then the progress name. Returns null when no column qualifies, so
 * classification pills never masquerade as work status. Pure (unit-tested).
 */
export function pickStatusColumn(candidates: readonly StatusColumn[]): StatusColumn | null {
  const text = (column: StatusColumn) => `${column.key.replace(/_/g, ' ')} ${column.title}`;
  const named = (column: StatusColumn) => PROGRESS_STATUS.test(text(column));
  const hasDone = (column: StatusColumn) => column.labels.some((label) => label.isDone);
  const eligible = (column: StatusColumn) =>
    named(column) || (hasDone(column) && !NON_PROGRESS_STATUS.test(text(column)));
  const score = (column: StatusColumn) => (hasDone(column) ? 4 : 0) + (named(column) ? 2 : 0);
  let best: StatusColumn | null = null;
  for (const column of candidates) {
    if (!eligible(column)) continue;
    if (!best || score(column) > score(best)) best = column;
  }
  return best;
}

type DateColumn = NonNullable<MyWorkBoardDto['date']>;

/**
 * Pick the date column that means "when is this due": prefer due/deadline/close/follow-up names,
 * avoid historical ones (last contacted, created, start, birthday). Pure (unit-tested).
 */
export function pickDateColumn(candidates: readonly DateColumn[]): DateColumn | null {
  const score = (column: DateColumn) => {
    const text = `${column.key} ${column.title}`;
    let value = 0;
    if (/due|deadline|close|follow|next|target|end|eta/i.test(text)) value += 2;
    if (/last|created|start|birth|joined|signed|since/i.test(text)) value -= 3;
    return value;
  };
  let best: DateColumn | null = null;
  for (const column of candidates) if (!best || score(column) > score(best)) best = column;
  return best && score(best) > -3 ? best : null;
}

/** Boards that hold reference records (people/companies), not work with a due date. */
const RECORD_LIST_KINDS: ReadonlySet<string> = new Set(['contacts', 'accounts']);

function dateOf(value: unknown): string | null {
  if (!isRecord(value) || typeof value.date !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : null;
}

function timeOf(value: unknown): string | null {
  if (!isRecord(value) || typeof value.time !== 'string') return null;
  return /^\d{2}:\d{2}$/.test(value.time) ? value.time : null;
}

function labelOf(value: unknown): string | null {
  return isRecord(value) && typeof value.labelId === 'string' ? value.labelId : null;
}

export async function listMyWork(ctx: ServiceContext, query: MyWorkQuery): Promise<MyWorkDto> {
  const userId = ctx.userId;
  if (!userId) return { boards: [], items: [], truncated: false };
  // jsonb_path_ops GIN index serves `@?`. The uuid comes from the session, passed as a bound param.
  const assignedPath = `$.*.ids[*] ? (@ == "${userId.replace(/[^0-9a-f-]/gi, '')}")`;
  const conditions = [
    eq(items.orgId, ctx.orgId),
    isNull(items.deletedAt),
    isNull(items.archivedAt),
    isNull(items.parentItemId),
    isNull(boards.archivedAt),
    isNull(groups.deletedAt),
    isNull(groups.archivedAt),
    visibleBoardsPredicate(ctx),
    sql`${items.values} @? ${assignedPath}::jsonpath`,
  ];
  if (query.boardId) conditions.push(eq(items.boardId, query.boardId));
  const rows = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      boardId: items.boardId,
      groupId: items.groupId,
      values: items.values,
      updatedAt: items.updatedAt,
      groupTitle: groups.title,
      groupColor: groups.color,
      boardName: boards.name,
      boardKind: boards.kind,
      itemTerminology: boards.itemTerminology,
    })
    .from(items)
    .innerJoin(boards, eq(boards.id, items.boardId))
    .innerJoin(groups, eq(groups.id, items.groupId))
    .where(and(...conditions))
    .orderBy(desc(items.updatedAt), desc(items.id))
    .limit(MY_WORK_MAX_ITEMS + 1);

  const boardIds = [...new Set(rows.map((row) => row.boardId))];
  if (boardIds.length === 0) return { boards: [], items: [], truncated: false };

  const [columnRows, roleRows] = await Promise.all([
    ctx.db
      .select({
        boardId: columns.boardId,
        key: columns.key,
        title: columns.title,
        type: columns.type,
        settings: columns.settings,
      })
      .from(columns)
      .where(
        and(
          eq(columns.orgId, ctx.orgId),
          inArray(columns.boardId, boardIds),
          isNull(columns.deletedAt),
          eq(columns.scope, 'item'),
          inArray(columns.type, ['people', 'status', 'date']),
        ),
      )
      .orderBy(asc(columns.position)),
    ctx.db
      .select({ boardId: boardMembers.boardId, role: boardMembers.role })
      .from(boardMembers)
      .where(and(inArray(boardMembers.boardId, boardIds), eq(boardMembers.userId, userId))),
  ]);

  const roleByBoard = new Map(roleRows.map((row) => [row.boardId, row.role]));
  const peopleKeys = new Map<string, string[]>();
  const statusCandidates = new Map<string, StatusColumn[]>();
  const dateCandidates = new Map<string, DateColumn[]>();
  for (const column of columnRows) {
    if (column.type === 'people') {
      peopleKeys.set(column.boardId, [...(peopleKeys.get(column.boardId) ?? []), column.key]);
    } else if (column.type === 'status') {
      statusCandidates.set(column.boardId, [
        ...(statusCandidates.get(column.boardId) ?? []),
        { key: column.key, title: column.title, labels: statusLabelsOf(column.settings) },
      ]);
    } else if (column.type === 'date') {
      dateCandidates.set(column.boardId, [
        ...(dateCandidates.get(column.boardId) ?? []),
        { key: column.key, title: column.title },
      ]);
    }
  }

  const statusCol = new Map<string, StatusColumn>();
  for (const [boardId, candidates] of statusCandidates) {
    const picked = pickStatusColumn(candidates);
    if (picked) statusCol.set(boardId, picked);
  }

  const dateCol = new Map<string, DateColumn>();
  for (const [boardId, candidates] of dateCandidates) {
    const picked = pickDateColumn(candidates);
    if (picked) dateCol.set(boardId, picked);
  }

  const matched = rows.filter((row) =>
    (peopleKeys.get(row.boardId) ?? []).some((key) => peopleIncludes(row.values[key], userId)),
  );
  const truncated = matched.length > MY_WORK_MAX_ITEMS;
  const kept = matched.slice(0, MY_WORK_MAX_ITEMS);

  const boardMap = new Map<string, MyWorkBoardDto>();
  const outItems: MyWorkItemDto[] = kept.map((row) => {
    if (!boardMap.has(row.boardId)) {
      boardMap.set(row.boardId, {
        id: row.boardId,
        name: row.boardName,
        kind: row.boardKind,
        itemTerminology: row.itemTerminology,
        canEdit: isOrgAdmin(ctx) || roleByBoard.get(row.boardId) !== 'viewer',
        recordList: RECORD_LIST_KINDS.has(row.boardKind),
        status: statusCol.get(row.boardId) ?? null,
        date: dateCol.get(row.boardId) ?? null,
      });
    }
    const status = statusCol.get(row.boardId);
    const date = dateCol.get(row.boardId);
    return {
      id: row.id,
      name: row.name,
      boardId: row.boardId,
      groupId: row.groupId,
      groupTitle: row.groupTitle,
      groupColor: row.groupColor,
      statusLabelId: status ? labelOf(row.values[status.key]) : null,
      date: date ? dateOf(row.values[date.key]) : null,
      time: date ? timeOf(row.values[date.key]) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  const sortedBoards = [...boardMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { boards: sortedBoards, items: outItems, truncated };
}
