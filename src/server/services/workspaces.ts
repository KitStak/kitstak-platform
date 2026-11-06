/** Workspaces & folders (sidebar structure). */
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { boards, dashboards, folders, workspaceMembers, workspaces } from '@/server/db/schema';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireWorkspace, visibleBoardsPredicate } from './access';
import { assertCreationAllowed } from './admin-org';
import { inTransaction, isOrgAdmin, type ServiceContext, concurrently } from './context';
import type { FolderDto, WorkspaceDto, WorkspaceTreeDto } from './contracts/dto';
import type {
  CreateFolderInput,
  CreateWorkspaceInput,
  UpdateFolderInput,
  UpdateWorkspaceInput,
} from './contracts/structure-inputs';
import { toBoardSummaryDto, toFolderDto, toWorkspaceDto } from './mappers';
import { positionAfter, resolveMovePosition } from './positions';

function visibleWorkspacesWhere(ctx: ServiceContext) {
  const base = and(eq(workspaces.orgId, ctx.orgId), isNull(workspaces.deletedAt));
  if (ctx.userId === null || isOrgAdmin(ctx)) return base;
  return and(
    base,
    or(
      eq(workspaces.kind, 'open'),
      sql`exists (select 1 from ${workspaceMembers} wm where wm.workspace_id = ${workspaces.id} and wm.user_id = ${ctx.userId})`,
    ),
  );
}

export async function listWorkspaces(ctx: ServiceContext): Promise<WorkspaceDto[]> {
  const rows = await ctx.db
    .select()
    .from(workspaces)
    .where(visibleWorkspacesWhere(ctx))
    .orderBy(asc(workspaces.position), asc(workspaces.id));
  return rows.map(toWorkspaceDto);
}

export async function getWorkspace(ctx: ServiceContext, workspaceId: string): Promise<WorkspaceDto> {
  return toWorkspaceDto(await requireWorkspace(ctx, workspaceId));
}

export async function createWorkspace(
  ctx: ServiceContext,
  input: CreateWorkspaceInput,
): Promise<WorkspaceDto> {
  return inTransaction(ctx, async (tx) => {
    await assertCreationAllowed(tx, 'workspace');
    const [last] = await tx.db
      .select({ position: workspaces.position })
      .from(workspaces)
      .where(eq(workspaces.orgId, tx.orgId))
      .orderBy(desc(workspaces.position))
      .limit(1);
    const [row] = await tx.db
      .insert(workspaces)
      .values({
        orgId: tx.orgId,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color,
        kind: input.kind,
        position: positionAfter(last?.position),
        createdBy: tx.userId,
      })
      .returning();
    if (!row) throw new Error('Workspace insert returned no row');
    if (tx.userId) {
      await tx.db
        .insert(workspaceMembers)
        .values({ orgId: tx.orgId, workspaceId: row.id, userId: tx.userId, role: 'owner' })
        .onConflictDoNothing();
    }
    await publish(tx.db, { type: 'workspace.changed', orgId: tx.orgId, ids: [row.id], actorId: tx.userId });
    return toWorkspaceDto(row);
  });
}

export async function updateWorkspace(
  ctx: ServiceContext,
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<WorkspaceDto> {
  return inTransaction(ctx, async (tx) => {
    await requireWorkspace(tx, workspaceId);
    let position: string | undefined;
    if (input.afterId || input.beforeId) {
      const siblings = await tx.db
        .select({ id: workspaces.id, position: workspaces.position })
        .from(workspaces)
        .where(and(eq(workspaces.orgId, tx.orgId), isNull(workspaces.deletedAt)));
      position = resolveMovePosition(
        siblings.filter((entry) => entry.id !== workspaceId),
        input,
      );
    }
    const [row] = await tx.db
      .update(workspaces)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.kind !== undefined && { kind: input.kind }),
        ...(position && { position }),
        updatedAt: new Date(),
      })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, tx.orgId)))
      .returning();
    if (!row) throw new NotFoundError('Workspace');
    await publish(tx.db, { type: 'workspace.changed', orgId: tx.orgId, ids: [row.id], actorId: tx.userId });
    return toWorkspaceDto(row);
  });
}

/** Soft-deletes the workspace and every board in it. */
export async function deleteWorkspace(ctx: ServiceContext, workspaceId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    await requireWorkspace(tx, workspaceId);
    const remaining = await tx.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.orgId, tx.orgId), isNull(workspaces.deletedAt)));
    if (remaining.length <= 1) throw new BadRequestError('An organization must keep at least one workspace');
    const now = new Date();
    await tx.db
      .update(workspaces)
      .set({ deletedAt: now })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, tx.orgId)));
    await tx.db
      .update(boards)
      .set({ deletedAt: now })
      .where(and(eq(boards.workspaceId, workspaceId), eq(boards.orgId, tx.orgId), isNull(boards.deletedAt)));
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [workspaceId],
      actorId: tx.userId,
    });
    return { id: workspaceId };
  });
}

/** Folders + visible boards + dashboards of a workspace (sidebar tree). */
export async function getWorkspaceTree(ctx: ServiceContext, workspaceId: string): Promise<WorkspaceTreeDto> {
  const workspace = await requireWorkspace(ctx, workspaceId);
  const [folderRows, boardRows, dashboardRows] = await concurrently(ctx, [
    () =>
      ctx.db
        .select()
        .from(folders)
        .where(
          and(eq(folders.workspaceId, workspaceId), eq(folders.orgId, ctx.orgId), isNull(folders.deletedAt)),
        )
        .orderBy(asc(folders.position)),
    () =>
      ctx.db
        .select()
        .from(boards)
        .where(
          and(eq(boards.workspaceId, workspaceId), isNull(boards.archivedAt), visibleBoardsPredicate(ctx)),
        )
        .orderBy(asc(boards.position)),
    () =>
      ctx.db
        .select({
          id: dashboards.id,
          workspaceId: dashboards.workspaceId,
          name: dashboards.name,
          position: dashboards.position,
        })
        .from(dashboards)
        .where(
          and(
            eq(dashboards.workspaceId, workspaceId),
            eq(dashboards.orgId, ctx.orgId),
            isNull(dashboards.deletedAt),
          ),
        )
        .orderBy(asc(dashboards.position)),
  ]);
  return {
    workspace: toWorkspaceDto(workspace),
    folders: folderRows.map(toFolderDto),
    boards: boardRows.map(toBoardSummaryDto),
    dashboards: dashboardRows,
  };
}

// Folders ---------------------------------------------------------------------------------------

async function requireFolder(ctx: ServiceContext, folderId: string) {
  const [row] = await ctx.db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.orgId, ctx.orgId), isNull(folders.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Folder');
  await requireWorkspace(ctx, row.workspaceId);
  return row;
}

async function assertNoCycle(ctx: ServiceContext, folderId: string, newParentId: string): Promise<void> {
  let current: string | null = newParentId;
  for (let depth = 0; current && depth < 50; depth += 1) {
    if (current === folderId) throw new BadRequestError('A folder cannot be moved inside itself');
    const [parent]: { parentId: string | null }[] = await ctx.db
      .select({ parentId: folders.parentId })
      .from(folders)
      .where(and(eq(folders.id, current), eq(folders.orgId, ctx.orgId)))
      .limit(1);
    current = parent?.parentId ?? null;
  }
}

export async function createFolder(ctx: ServiceContext, input: CreateFolderInput): Promise<FolderDto> {
  return inTransaction(ctx, async (tx) => {
    await requireWorkspace(tx, input.workspaceId);
    if (input.parentId) {
      const parent = await requireFolder(tx, input.parentId);
      if (parent.workspaceId !== input.workspaceId)
        throw new BadRequestError('Parent folder is in another workspace');
    }
    const [last] = await tx.db
      .select({ position: folders.position })
      .from(folders)
      .where(
        and(
          eq(folders.workspaceId, input.workspaceId),
          input.parentId ? eq(folders.parentId, input.parentId) : isNull(folders.parentId),
        ),
      )
      .orderBy(desc(folders.position))
      .limit(1);
    const [row] = await tx.db
      .insert(folders)
      .values({
        orgId: tx.orgId,
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        name: input.name,
        color: input.color ?? null,
        position: positionAfter(last?.position),
        createdBy: tx.userId,
      })
      .returning();
    if (!row) throw new Error('Folder insert returned no row');
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [input.workspaceId],
      actorId: tx.userId,
    });
    return toFolderDto(row);
  });
}

export async function updateFolder(
  ctx: ServiceContext,
  folderId: string,
  input: UpdateFolderInput,
): Promise<FolderDto> {
  return inTransaction(ctx, async (tx) => {
    const folder = await requireFolder(tx, folderId);
    const parentId = input.parentId === undefined ? folder.parentId : input.parentId;
    if (input.parentId) {
      const parent = await requireFolder(tx, input.parentId);
      if (parent.workspaceId !== folder.workspaceId)
        throw new BadRequestError('Parent folder is in another workspace');
      await assertNoCycle(tx, folderId, input.parentId);
    }
    let position: string | undefined;
    if (input.afterId || input.beforeId || input.parentId !== undefined) {
      const siblings = await tx.db
        .select({ id: folders.id, position: folders.position })
        .from(folders)
        .where(
          and(
            eq(folders.workspaceId, folder.workspaceId),
            parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
            isNull(folders.deletedAt),
          ),
        );
      position = resolveMovePosition(
        siblings.filter((entry) => entry.id !== folderId),
        input,
      );
    }
    const [row] = await tx.db
      .update(folders)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(position && { position }),
        updatedAt: new Date(),
      })
      .where(and(eq(folders.id, folderId), eq(folders.orgId, tx.orgId)))
      .returning();
    if (!row) throw new NotFoundError('Folder');
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [folder.workspaceId],
      actorId: tx.userId,
    });
    return toFolderDto(row);
  });
}

/** Deletes a folder: its boards and sub-folders move up to the parent (nothing is lost). */
export async function deleteFolder(ctx: ServiceContext, folderId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const folder = await requireFolder(tx, folderId);
    await tx.db
      .update(boards)
      .set({ folderId: folder.parentId })
      .where(and(eq(boards.folderId, folderId), eq(boards.orgId, tx.orgId)));
    await tx.db
      .update(folders)
      .set({ parentId: folder.parentId })
      .where(and(eq(folders.parentId, folderId), eq(folders.orgId, tx.orgId)));
    await tx.db
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(and(eq(folders.id, folderId), eq(folders.orgId, tx.orgId)));
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [folder.workspaceId],
      actorId: tx.userId,
    });
    return { id: folderId };
  });
}

/** Replace the explicit member list of a (closed) workspace. */
export async function setWorkspaceMembers(
  ctx: ServiceContext,
  workspaceId: string,
  userIds: readonly string[],
): Promise<{ userIds: string[] }> {
  return inTransaction(ctx, async (tx) => {
    await requireWorkspace(tx, workspaceId);
    await tx.db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.orgId, tx.orgId)));
    const unique = [...new Set(userIds)];
    if (unique.length > 0) {
      await tx.db
        .insert(workspaceMembers)
        .values(unique.map((userId) => ({ orgId: tx.orgId, workspaceId, userId, role: 'member' as const })));
    }
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [workspaceId],
      actorId: tx.userId,
    });
    return { userIds: unique };
  });
}

export async function workspaceIdsForBoards(
  ctx: ServiceContext,
  boardIds: readonly string[],
): Promise<Map<string, string>> {
  if (boardIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: boards.id, workspaceId: boards.workspaceId })
    .from(boards)
    .where(and(inArray(boards.id, [...boardIds]), eq(boards.orgId, ctx.orgId)));
  return new Map(rows.map((row) => [row.id, row.workspaceId]));
}
