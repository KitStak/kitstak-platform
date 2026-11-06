/**
 * Folder extras for the sidebar (shell module): custom icons, move to another workspace, and
 * archive with a real restore. Every query is org-scoped and the workspace access-checked.
 * Folder icons live in the organization metadata JSON under `shell.folderIcons` (no schema
 * change); other metadata keys are preserved on write.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { boards, folders, organization } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireWorkspace } from './access';
import { inTransaction, type ServiceContext } from './context';
import { positionAfter } from './positions';
import { FOLDER_ICONS, readFolderIcons, writeFolderIcon, type FolderIcon } from './shell-folders-model';

export * from './shell-folders-model';

const MAX_SUBTREE = 500;

export const folderIconSchema = z.object({ icon: z.enum(FOLDER_ICONS).nullable() });
export const moveFolderSchema = z.object({ workspaceId: z.uuid() });
export const restoreFolderSchema = z.object({
  folderIds: z.array(z.uuid()).min(1).max(MAX_SUBTREE),
  boardIds: z.array(z.uuid()).max(2000).default([]),
});

export interface ArchivedFolderDto {
  readonly folderIds: string[];
  readonly boardIds: string[];
}

async function requireFolderRow(ctx: ServiceContext, folderId: string) {
  const [row] = await ctx.db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.orgId, ctx.orgId), isNull(folders.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Folder');
  await requireWorkspace(ctx, row.workspaceId);
  return row;
}

/** The folder and all of its live descendants, breadth first. */
async function subtreeIds(ctx: ServiceContext, rootId: string): Promise<string[]> {
  const all: string[] = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0 && all.length < MAX_SUBTREE) {
    const children = await ctx.db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.orgId, ctx.orgId), inArray(folders.parentId, frontier), isNull(folders.deletedAt)));
    frontier = children.map((child) => child.id).filter((id) => !all.includes(id));
    all.push(...frontier);
  }
  return all;
}

async function announce(ctx: ServiceContext, workspaceIds: readonly string[]): Promise<void> {
  await publish(ctx.db, {
    type: 'workspace.changed',
    orgId: ctx.orgId,
    ids: [...new Set(workspaceIds)],
    actorId: ctx.userId,
  });
}

export async function listFolderIcons(ctx: ServiceContext): Promise<Record<string, FolderIcon>> {
  const [row] = await ctx.db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, ctx.orgId))
    .limit(1);
  return readFolderIcons(row?.metadata);
}

export async function setFolderIcon(
  ctx: ServiceContext,
  folderId: string,
  input: z.infer<typeof folderIconSchema>,
): Promise<{ folderId: string; icon: FolderIcon | null }> {
  return inTransaction(ctx, async (tx) => {
    const folder = await requireFolderRow(tx, folderId);
    const [row] = await tx.db
      .select({ metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, tx.orgId))
      .for('update')
      .limit(1);
    await tx.db
      .update(organization)
      .set({ metadata: writeFolderIcon(row?.metadata, folderId, input.icon) })
      .where(eq(organization.id, tx.orgId));
    await announce(tx, [folder.workspaceId]);
    return { folderId, icon: input.icon };
  });
}

/** Moves a folder (with sub-folders and boards) to the top level of another workspace. */
export async function moveFolderToWorkspace(
  ctx: ServiceContext,
  folderId: string,
  input: z.infer<typeof moveFolderSchema>,
): Promise<{ folderId: string; workspaceId: string }> {
  return inTransaction(ctx, async (tx) => {
    const folder = await requireFolderRow(tx, folderId);
    if (folder.workspaceId === input.workspaceId) return { folderId, workspaceId: input.workspaceId };
    await requireWorkspace(tx, input.workspaceId);
    const ids = await subtreeIds(tx, folderId);
    const [last] = await tx.db
      .select({ position: folders.position })
      .from(folders)
      .where(
        and(
          eq(folders.orgId, tx.orgId),
          eq(folders.workspaceId, input.workspaceId),
          isNull(folders.parentId),
          isNull(folders.deletedAt),
        ),
      )
      .orderBy(desc(folders.position))
      .limit(1);
    const now = new Date();
    await tx.db
      .update(folders)
      .set({ workspaceId: input.workspaceId, updatedAt: now })
      .where(and(eq(folders.orgId, tx.orgId), inArray(folders.id, ids)));
    await tx.db
      .update(folders)
      .set({ parentId: null, position: positionAfter(last?.position) })
      .where(and(eq(folders.orgId, tx.orgId), eq(folders.id, folderId)));
    await tx.db
      .update(boards)
      .set({ workspaceId: input.workspaceId, updatedAt: now })
      .where(and(eq(boards.orgId, tx.orgId), inArray(boards.folderId, ids)));
    await announce(tx, [folder.workspaceId, input.workspaceId]);
    return { folderId, workspaceId: input.workspaceId };
  });
}

/** Archives every live board in the folder tree and hides the folders; returns what to restore. */
export async function archiveFolder(ctx: ServiceContext, folderId: string): Promise<ArchivedFolderDto> {
  return inTransaction(ctx, async (tx) => {
    const folder = await requireFolderRow(tx, folderId);
    const folderIds = await subtreeIds(tx, folderId);
    const now = new Date();
    const archived = await tx.db
      .update(boards)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(boards.orgId, tx.orgId),
          inArray(boards.folderId, folderIds),
          isNull(boards.archivedAt),
          isNull(boards.deletedAt),
        ),
      )
      .returning({ id: boards.id });
    await tx.db
      .update(folders)
      .set({ deletedAt: now })
      .where(and(eq(folders.orgId, tx.orgId), inArray(folders.id, folderIds)));
    await announce(tx, [folder.workspaceId]);
    return { folderIds, boardIds: archived.map((board) => board.id) };
  });
}

/** Undo of `archiveFolder`: brings the folders back and un-archives the boards it archived. */
export async function restoreFolder(
  ctx: ServiceContext,
  input: z.infer<typeof restoreFolderSchema>,
): Promise<ArchivedFolderDto> {
  return inTransaction(ctx, async (tx) => {
    const candidates = await tx.db
      .select({ id: folders.id, workspaceId: folders.workspaceId })
      .from(folders)
      .where(and(eq(folders.orgId, tx.orgId), inArray(folders.id, input.folderIds)));
    if (candidates.length === 0) throw new NotFoundError('Folder');
    for (const workspaceId of new Set(candidates.map((row) => row.workspaceId))) {
      await requireWorkspace(tx, workspaceId);
    }
    const ids = candidates.map((row) => row.id);
    await tx.db
      .update(folders)
      .set({ deletedAt: null })
      .where(and(eq(folders.orgId, tx.orgId), inArray(folders.id, ids)));
    if (input.boardIds.length > 0) {
      await tx.db
        .update(boards)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(boards.orgId, tx.orgId), inArray(boards.id, input.boardIds), inArray(boards.folderId, ids), isNull(boards.deletedAt)));
    }
    await announce(tx, candidates.map((row) => row.workspaceId));
    return { folderIds: ids, boardIds: input.boardIds };
  });
}
