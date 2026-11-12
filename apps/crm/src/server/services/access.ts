/**
 * Board / workspace level access control (layered on top of the org RBAC in `withApi`).
 *
 * Rules:
 *  - Every lookup filters by `org_id` → cross-org ids are indistinguishable from missing ones (404).
 *  - Owners/admins see everything in the org.
 *  - `main` boards in open workspaces are visible to all non-guest members.
 *  - Closed workspaces require a workspace membership.
 *  - `private` / `shareable` boards require an explicit board membership.
 *  - Guests only see boards they are explicitly a member of.
 *  - Board members with role `viewer` cannot write.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { boardMembers, boards, items, workspaceMembers, workspaces } from '@/server/db/schema';
import { ForbiddenError, NotFoundError } from '@/server/http/errors';
import { isGuest, isOrgAdmin, type ServiceContext } from './context';

export type AccessMode = 'read' | 'write';

export type BoardRow = typeof boards.$inferSelect;

interface BoardAccessRow {
  readonly board: BoardRow;
  readonly workspaceKind: 'open' | 'closed';
  readonly workspaceMember: boolean;
  readonly boardRole: 'owner' | 'editor' | 'viewer' | 'subscriber' | null;
}

async function loadBoardAccessRow(
  ctx: ServiceContext,
  boardId: string,
  options: { includeArchived?: boolean; includeDeleted?: boolean } = {},
): Promise<BoardAccessRow | null> {
  const userId = ctx.userId ?? '00000000-0000-0000-0000-000000000000';
  const conditions: SQL[] = [eq(boards.id, boardId), eq(boards.orgId, ctx.orgId)];
  if (!options.includeDeleted) conditions.push(isNull(boards.deletedAt));
  const rows = await ctx.db
    .select({
      board: boards,
      workspaceKind: workspaces.kind,
      workspaceMember: sql<boolean>`exists (select 1 from ${workspaceMembers} wm where wm.workspace_id = ${boards.workspaceId} and wm.user_id = ${userId})`,
      boardRole: boardMembers.role,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .leftJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, userId)))
    .where(and(...conditions))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.board.archivedAt && !options.includeArchived) return null;
  return row;
}

function canSee(ctx: ServiceContext, row: BoardAccessRow): boolean {
  if (ctx.userId === null) return true; // system context (seed, scheduled jobs)
  if (isOrgAdmin(ctx)) return true;
  if (isGuest(ctx)) return row.boardRole !== null;
  if (row.workspaceKind === 'closed' && !row.workspaceMember && row.boardRole === null) return false;
  if (row.board.privacy !== 'main') return row.boardRole !== null;
  return true;
}

function canWrite(ctx: ServiceContext, row: BoardAccessRow): boolean {
  if (ctx.userId === null || isOrgAdmin(ctx)) return true;
  return row.boardRole !== 'viewer';
}

/**
 * Load a board the caller may access in `mode`. Throws 404 when it does not exist, belongs to
 * another org or is invisible to the caller; 403 when visible but read-only.
 */
export async function requireBoard(
  ctx: ServiceContext,
  boardId: string,
  mode: AccessMode = 'read',
  options: { includeDeleted?: boolean } = {},
): Promise<BoardRow> {
  const row = await loadBoardAccessRow(ctx, boardId, { includeArchived: true, ...options });
  if (!row || !canSee(ctx, row)) throw new NotFoundError('Board');
  if (mode === 'write' && !canWrite(ctx, row)) {
    throw new ForbiddenError('You have view-only access to this board');
  }
  return row.board;
}

/** Whether the caller is the board owner (or an org admin) — required for destructive board ops. */
export async function requireBoardOwner(ctx: ServiceContext, boardId: string): Promise<BoardRow> {
  const row = await loadBoardAccessRow(ctx, boardId, { includeArchived: true, includeDeleted: true });
  if (!row || !canSee(ctx, row)) throw new NotFoundError('Board');
  if (ctx.userId === null || isOrgAdmin(ctx) || row.boardRole === 'owner') return row.board;
  if (row.board.createdBy === ctx.userId) return row.board;
  throw new ForbiddenError('Only board owners can do that');
}

export type ItemRow = typeof items.$inferSelect;

/** Load an item (org-scoped, not deleted) and check access to its board. */
export async function requireItem(
  ctx: ServiceContext,
  itemId: string,
  mode: AccessMode = 'read',
  options: { includeDeleted?: boolean } = {},
): Promise<{ item: ItemRow; board: BoardRow }> {
  const conditions: SQL[] = [eq(items.id, itemId), eq(items.orgId, ctx.orgId)];
  if (!options.includeDeleted) conditions.push(isNull(items.deletedAt));
  const [item] = await ctx.db
    .select()
    .from(items)
    .where(and(...conditions))
    .limit(1);
  if (!item) throw new NotFoundError('Item');
  try {
    const board = await requireBoard(ctx, item.boardId, mode);
    return { item, board };
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('Item');
    throw error;
  }
}

/**
 * SQL predicate restricting `boards` rows to those visible to the caller. Used by list and
 * search queries so access rules are applied in the database, not post-filtered.
 */
export function visibleBoardsPredicate(ctx: ServiceContext): SQL {
  const base = and(eq(boards.orgId, ctx.orgId), isNull(boards.deletedAt)) as SQL;
  if (ctx.userId === null || isOrgAdmin(ctx)) return base;
  const userId = ctx.userId;
  const isBoardMember = sql`exists (select 1 from ${boardMembers} bm where bm.board_id = ${boards.id} and bm.user_id = ${userId})`;
  if (isGuest(ctx)) return and(base, isBoardMember) as SQL;
  const workspaceVisible = sql`exists (select 1 from ${workspaces} w where w.id = ${boards.workspaceId} and (w.kind = 'open' or exists (select 1 from ${workspaceMembers} wm where wm.workspace_id = w.id and wm.user_id = ${userId})))`;
  return and(base, or(isBoardMember, and(eq(boards.privacy, 'main'), workspaceVisible))) as SQL;
}

/** Ids among `boardIds` the caller can see (order not preserved). */
export async function filterVisibleBoardIds(
  ctx: ServiceContext,
  boardIds: readonly string[],
): Promise<string[]> {
  if (boardIds.length === 0) return [];
  const rows = await ctx.db
    .select({ id: boards.id })
    .from(boards)
    .where(and(inArray(boards.id, [...boardIds]), visibleBoardsPredicate(ctx)));
  return rows.map((row) => row.id);
}

/** Workspace lookup honoring closed-workspace membership. */
export async function requireWorkspace(
  ctx: ServiceContext,
  workspaceId: string,
): Promise<typeof workspaces.$inferSelect> {
  const [row] = await ctx.db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, ctx.orgId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Workspace');
  if (row.kind === 'closed' && ctx.userId !== null && !isOrgAdmin(ctx)) {
    const [membership] = await ctx.db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, ctx.userId)))
      .limit(1);
    if (!membership) throw new NotFoundError('Workspace');
  }
  return row;
}
