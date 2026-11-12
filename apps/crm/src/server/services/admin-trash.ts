/**
 * Trash: soft-deleted boards, groups and items, restore and permanent delete.
 *
 * Visibility follows board access: org admins see everything; other members see deleted boards
 * they created or own, and deleted groups/items on boards they can see. Permanent delete needs
 * board ownership (or org admin). Restoring a group brings back exactly the items that were
 * deleted with it (same `deleted_at` timestamp), not items deleted individually before.
 */
import 'server-only';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { recordAudit } from '@/server/audit';
import { activityLog, boardMembers, boards, groups, items, user, workspaces } from '@/server/db/schema';
import { AppError, BadRequestError, NotFoundError } from '@/server/http/errors';
import { logger } from '@/server/logger';
import { hasPermission } from '@/server/rbac';
import { publish } from '@/server/realtime/publisher';
import { requireBoard, requireBoardOwner, visibleBoardsPredicate } from './access';
import { logActivity } from './activity';
import { changeBoardLifecycle } from './boards';
import { inTransaction, isOrgAdmin, type ServiceContext } from './context';
import { changeItemLifecycle } from './items';
import {
  TRASH_RETENTION_DAYS,
  type TrashEntriesInput,
  type TrashEntryDto,
  type TrashResultDto,
  type TrashType,
} from './admin-contracts';
import { purgeDate } from './admin-policy';

const DAY_MS = 86_400_000;

/** Board role of the caller on `boards.id` (null when not a board member). */
function boardRoleSql(ctx: ServiceContext) {
  const userId = ctx.userId ?? '00000000-0000-0000-0000-000000000000';
  return sql<string | null>`(select bm.role from ${boardMembers} bm where bm.board_id = ${boards.id} and bm.user_id = ${userId} limit 1)`;
}

/** Restoring groups/items needs `item:write` and edit access to the board (not a board viewer). */
function canEditBoard(ctx: ServiceContext, boardRole: string | null): boolean {
  if (!hasPermission(ctx.roles, 'item:write')) return false;
  return isOrgAdmin(ctx) || ctx.userId === null || boardRole !== 'viewer';
}

const LIST_LIMIT = 500;

function ownsBoardSql(ctx: ServiceContext): SQL {
  if (isOrgAdmin(ctx) || ctx.userId === null) return sql`true`;
  const userId = ctx.userId;
  return or(
    eq(boards.createdBy, userId),
    sql`exists (select 1 from ${boardMembers} bm where bm.board_id = ${boards.id} and bm.user_id = ${userId} and bm.role = 'owner')`,
  ) as SQL;
}

async function deleters(ctx: ServiceContext, boardIds: readonly string[], action: string) {
  if (boardIds.length === 0) return [] as { boardId: string | null; before: unknown; name: string | null; id: string | null }[];
  return ctx.db
    .select({ boardId: activityLog.boardId, before: activityLog.before, name: user.name, id: user.id })
    .from(activityLog)
    .leftJoin(user, eq(user.id, activityLog.actorId))
    .where(and(eq(activityLog.orgId, ctx.orgId), eq(activityLog.action, action), inArray(activityLog.boardId, [...boardIds])))
    .orderBy(desc(activityLog.createdAt))
    .limit(2000);
}

function person(id: string | null, name: string | null) {
  return id && name ? { id, name } : null;
}

async function listDeletedBoards(ctx: ServiceContext, boardId?: string): Promise<TrashEntryDto[]> {
  const conditions: SQL[] = [eq(boards.orgId, ctx.orgId), isNotNull(boards.deletedAt), ownsBoardSql(ctx)];
  if (boardId) conditions.push(eq(boards.id, boardId));
  const rows = await ctx.db
    .select({
      id: boards.id,
      name: boards.name,
      deletedAt: boards.deletedAt,
      workspaceName: workspaces.name,
      itemCount: sql<number>`(select count(*)::int from ${items} i where i.board_id = ${boards.id} and i.deleted_at is null and i.parent_item_id is null)`,
    })
    .from(boards)
    .leftJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .where(and(...conditions))
    .orderBy(desc(boards.deletedAt))
    .limit(LIST_LIMIT);
  const who = await deleters(ctx, rows.map((row) => row.id), 'board.deleted');
  return rows.map((row) => {
    const by = who.find((entry) => entry.boardId === row.id);
    const deletedAt = row.deletedAt as Date;
    return {
      type: 'board' as const,
      id: row.id,
      name: row.name,
      boardId: row.id,
      boardName: row.name,
      groupName: null,
      workspaceName: row.workspaceName,
      itemCount: Number(row.itemCount),
      deletedAt: deletedAt.toISOString(),
      deletedBy: by ? person(by.id, by.name) : null,
      purgeAt: purgeDate(deletedAt, TRASH_RETENTION_DAYS).toISOString(),
      canPurge: true, // the query already restricts to boards the caller owns
      canRestore: hasPermission(ctx.roles, 'item:write'),
    };
  });
}

async function listDeletedGroups(ctx: ServiceContext, boardId?: string): Promise<TrashEntryDto[]> {
  const conditions: SQL[] = [eq(groups.orgId, ctx.orgId), isNotNull(groups.deletedAt), visibleBoardsPredicate(ctx)];
  if (boardId) conditions.push(eq(groups.boardId, boardId));
  const rows = await ctx.db
    .select({
      id: groups.id,
      name: groups.title,
      deletedAt: groups.deletedAt,
      boardId: boards.id,
      boardName: boards.name,
      boardCreatedBy: boards.createdBy,
      boardRole: boardRoleSql(ctx),
      workspaceName: workspaces.name,
      itemCount: sql<number>`(select count(*)::int from ${items} i where i.group_id = ${groups.id} and i.deleted_at = ${groups.deletedAt} and i.parent_item_id is null)`,
    })
    .from(groups)
    .innerJoin(boards, eq(boards.id, groups.boardId))
    .leftJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .where(and(...conditions))
    .orderBy(desc(groups.deletedAt))
    .limit(LIST_LIMIT);
  const who = await deleters(ctx, [...new Set(rows.map((row) => row.boardId))], 'group.deleted');
  return rows.map((row) => {
    const by = who.find(
      (entry) =>
        entry.boardId === row.boardId &&
        typeof entry.before === 'object' &&
        entry.before !== null &&
        (entry.before as { groupId?: string }).groupId === row.id,
    );
    const deletedAt = row.deletedAt as Date;
    return {
      type: 'group' as const,
      id: row.id,
      name: row.name,
      boardId: row.boardId,
      boardName: row.boardName,
      groupName: row.name,
      workspaceName: row.workspaceName,
      itemCount: Number(row.itemCount),
      deletedAt: deletedAt.toISOString(),
      deletedBy: by ? person(by.id, by.name) : null,
      purgeAt: purgeDate(deletedAt, TRASH_RETENTION_DAYS).toISOString(),
      canPurge: isOrgAdmin(ctx) || row.boardCreatedBy === ctx.userId || row.boardRole === 'owner',
      canRestore: canEditBoard(ctx, row.boardRole),
    };
  });
}

async function listDeletedItems(ctx: ServiceContext, boardId?: string): Promise<TrashEntryDto[]> {
  const conditions: SQL[] = [
    eq(items.orgId, ctx.orgId),
    isNotNull(items.deletedAt),
    isNull(items.parentItemId),
    isNull(groups.deletedAt),
    visibleBoardsPredicate(ctx),
  ];
  if (boardId) conditions.push(eq(items.boardId, boardId));
  const rows = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      deletedAt: items.deletedAt,
      boardId: boards.id,
      boardName: boards.name,
      boardCreatedBy: boards.createdBy,
      boardRole: boardRoleSql(ctx),
      groupName: groups.title,
      workspaceName: workspaces.name,
      byId: user.id,
      byName: user.name,
    })
    .from(items)
    .innerJoin(boards, eq(boards.id, items.boardId))
    .innerJoin(groups, eq(groups.id, items.groupId))
    .leftJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .leftJoin(user, eq(user.id, items.updatedBy))
    .where(and(...conditions))
    .orderBy(desc(items.deletedAt))
    .limit(LIST_LIMIT);
  return rows.map((row) => {
    const deletedAt = row.deletedAt as Date;
    return {
      type: 'item' as const,
      id: row.id,
      name: row.name,
      boardId: row.boardId,
      boardName: row.boardName,
      groupName: row.groupName,
      workspaceName: row.workspaceName,
      itemCount: null,
      deletedAt: deletedAt.toISOString(),
      deletedBy: person(row.byId, row.byName),
      purgeAt: purgeDate(deletedAt, TRASH_RETENTION_DAYS).toISOString(),
      canPurge: isOrgAdmin(ctx) || row.boardCreatedBy === ctx.userId || row.boardRole === 'owner',
      canRestore: canEditBoard(ctx, row.boardRole),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Retention: entries older than TRASH_RETENTION_DAYS are removed permanently. Runs lazily (at most
// every few minutes per org) whenever the trash is listed, so the countdown is always truthful.
// ---------------------------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 5 * 60_000;
const lastSweep = new Map<string, number>();

export interface RetentionSweepResult {
  readonly boards: number;
  readonly groups: number;
  readonly items: number;
}

/** Hard-delete this org's trash older than the retention window. System action, audited. */
export async function purgeExpiredTrash(
  ctx: Pick<ServiceContext, 'db' | 'orgId'>,
  now: Date = new Date(),
): Promise<RetentionSweepResult> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
  const result = await ctx.db.transaction(async (tx) => {
    const purgedBoards = await tx
      .delete(boards)
      .where(and(eq(boards.orgId, ctx.orgId), isNotNull(boards.deletedAt), lt(boards.deletedAt, cutoff)))
      .returning({ id: boards.id, name: boards.name });
    const purgedGroups = await tx
      .delete(groups)
      .where(and(eq(groups.orgId, ctx.orgId), isNotNull(groups.deletedAt), lt(groups.deletedAt, cutoff)))
      .returning({ id: groups.id });
    const purgedItems = await tx
      .delete(items)
      .where(and(eq(items.orgId, ctx.orgId), isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)))
      .returning({ id: items.id });
    return { purgedBoards, purgedGroups, purgedItems };
  });
  const counts = {
    boards: result.purgedBoards.length,
    groups: result.purgedGroups.length,
    items: result.purgedItems.length,
  };
  if (counts.boards + counts.groups + counts.items > 0) {
    await recordAudit({
      orgId: ctx.orgId,
      actorId: null,
      action: 'trash.retention_purged',
      targetType: 'trash',
      metadata: {
        ...counts,
        retentionDays: TRASH_RETENTION_DAYS,
        cutoff: cutoff.toISOString(),
        boardNames: result.purgedBoards.slice(0, 20).map((row) => row.name),
      },
    });
  }
  return counts;
}

async function sweepIfDue(ctx: ServiceContext): Promise<void> {
  const last = lastSweep.get(ctx.orgId) ?? 0;
  if (Date.now() - last < SWEEP_INTERVAL_MS) return;
  lastSweep.set(ctx.orgId, Date.now());
  try {
    await purgeExpiredTrash(ctx);
  } catch (error) {
    lastSweep.delete(ctx.orgId);
    logger.error('trash.retention_sweep_failed', { orgId: ctx.orgId, error });
  }
}

export async function listTrash(
  ctx: ServiceContext,
  query: { type?: TrashType; boardId?: string },
): Promise<TrashEntryDto[]> {
  await sweepIfDue(ctx);
  const want = (type: TrashType) => !query.type || query.type === type;
  const [boardRows, groupRows, itemRows] = await Promise.all([
    want('board') ? listDeletedBoards(ctx, query.boardId) : Promise.resolve([]),
    want('group') ? listDeletedGroups(ctx, query.boardId) : Promise.resolve([]),
    want('item') ? listDeletedItems(ctx, query.boardId) : Promise.resolve([]),
  ]);
  return [...boardRows, ...groupRows, ...itemRows].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// ---------------------------------------------------------------------------------------------
// Restore / purge
// ---------------------------------------------------------------------------------------------

async function loadDeletedGroup(ctx: ServiceContext, groupId: string) {
  const [row] = await ctx.db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.orgId, ctx.orgId), isNotNull(groups.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Group');
  return row;
}

export async function restoreGroup(ctx: ServiceContext, groupId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const group = await loadDeletedGroup(tx, groupId);
    await requireBoard(tx, group.boardId, 'write');
    const deletedAt = group.deletedAt as Date;
    await tx.db.update(groups).set({ deletedAt: null, updatedAt: new Date() }).where(eq(groups.id, groupId));
    const restored = await tx.db
      .update(items)
      .set({ deletedAt: null, updatedBy: tx.userId, updatedAt: new Date() })
      .where(and(eq(items.groupId, groupId), eq(items.deletedAt, deletedAt)))
      .returning({ id: items.id });
    await logActivity(tx, {
      boardId: group.boardId,
      action: 'group.restored',
      after: { groupId, title: group.title, items: restored.length },
    });
    await publish(tx.db, { type: 'groups.changed', orgId: tx.orgId, boardId: group.boardId, ids: [groupId], actorId: tx.userId });
    await publish(tx.db, {
      type: 'items.changed',
      orgId: tx.orgId,
      boardId: group.boardId,
      ids: restored.map((row) => row.id),
      actorId: tx.userId,
    });
    return { id: groupId };
  });
}

async function purgeOne(ctx: ServiceContext, type: TrashType, id: string): Promise<void> {
  await inTransaction(ctx, async (tx) => {
    if (type === 'board') {
      const board = await requireBoardOwner(tx, id);
      if (!board.deletedAt) throw new BadRequestError('Move the board to the trash first');
      await tx.db.delete(boards).where(and(eq(boards.id, id), eq(boards.orgId, tx.orgId)));
      await publish(tx.db, { type: 'workspace.changed', orgId: tx.orgId, ids: [board.workspaceId], actorId: tx.userId });
      return;
    }
    if (type === 'group') {
      const group = await loadDeletedGroup(tx, id);
      await requireBoardOwner(tx, group.boardId);
      await tx.db.delete(groups).where(eq(groups.id, id));
      return;
    }
    const [item] = await tx.db
      .select({ id: items.id, boardId: items.boardId, deletedAt: items.deletedAt })
      .from(items)
      .where(and(eq(items.id, id), eq(items.orgId, tx.orgId)))
      .limit(1);
    if (!item?.deletedAt) throw new NotFoundError('Item');
    await requireBoardOwner(tx, item.boardId);
    await tx.db.delete(items).where(eq(items.id, id));
  });
}

async function restoreOne(ctx: ServiceContext, type: TrashType, id: string): Promise<void> {
  if (type === 'board') await changeBoardLifecycle(ctx, id, 'restore');
  else if (type === 'group') await restoreGroup(ctx, id);
  else await changeItemLifecycle(ctx, id, 'restore');
}

async function runEach(
  ctx: ServiceContext,
  input: TrashEntriesInput,
  op: (ctx: ServiceContext, type: TrashType, id: string) => Promise<void>,
): Promise<TrashResultDto> {
  const done: { type: TrashType; id: string }[] = [];
  const failed: { type: TrashType; id: string; reason: string }[] = [];
  for (const entry of input.entries) {
    try {
      await op(ctx, entry.type, entry.id);
      done.push(entry);
    } catch (error) {
      failed.push({ ...entry, reason: error instanceof AppError ? error.message : 'Something went wrong' });
    }
  }
  return { done, failed };
}

export function restoreFromTrash(ctx: ServiceContext, input: TrashEntriesInput): Promise<TrashResultDto> {
  return runEach(ctx, input, restoreOne);
}

export function purgeFromTrash(ctx: ServiceContext, input: TrashEntriesInput): Promise<TrashResultDto> {
  return runEach(ctx, input, purgeOne);
}

export const __test = { lastSweep };
