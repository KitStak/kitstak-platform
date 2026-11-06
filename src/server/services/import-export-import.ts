/**
 * Import pipeline: prepare (board/group/columns/labels) → batches (bulk create/update inside a
 * transaction per batch, savepoint per row) → complete (notification) → undo (by batch id).
 *
 * Every batch writes an append-only audit row (`data.import.batch`) carrying the created ids and
 * the previous values of updated items, which is what powers "Undo import" for 24 hours.
 */
import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { auditLog, boards, groups, items } from '@/server/db/schema';
import { BOARD_TEMPLATES } from '@/server/services/templates/crm';
import { instantiateTemplate } from '@/server/services/templates/instantiate';
import type { BoardTemplate, TemplateColumn } from '@/server/services/templates/types';
import { recordAudit } from '@/server/audit';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { hasPermission } from '@/server/rbac';
import { requireBoard, requireWorkspace } from './access';
import type { ValuesPatch } from './cell-validation';
import { changeBoardLifecycle } from './boards';
import { createColumn, deleteColumn, updateColumn } from './columns';
import { inTransaction, type ServiceContext } from './context';
import { createGroup, deleteGroup } from './groups';
import { loadBoardColumns } from './item-reads';
import { persistItemChanges } from './item-values';
import { applyLifecycle, finishItemMutation } from './items';
import { IMPORT_BATCH_ACTION as BATCH_ACTION, lockImportRun, type ImportBatchMetadata } from './import-export-batch';
import { toBoardSummaryDto, toColumnDto } from './mappers';
import { notify } from './notifications';
import {
  type ImportCompleteInput,
  type ImportRunSummary,
  type ImportUndoInput,
  type ImportUndoResult,
  type PrepareImportInput,
  type PrepareImportResult,
} from './import-export-contracts';

const TERMINOLOGY: Record<string, string> = {
  leads: 'Lead',
  contacts: 'Contact',
  accounts: 'Account',
  deals: 'Deal',
  activities: 'Activity',
  projects: 'Project',
  custom: 'Item',
};

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
const UNDO_ACTION = 'data.import.undone';

const PREPARED_ACTION = 'data.import.prepared';
const COMPLETED_ACTION = 'data.import.completed';

interface PreparedMetadata {
  readonly batchId: string;
  readonly boardCreated: boolean;
  readonly createdColumnIds: string[];
  readonly createdGroupId: string | null;
  readonly labelChanges: { columnId: string; key: string; type: string; before: string[] }[];
  /** Stored so a retried prepare (lost response) returns the same result instead of redoing it. */
  readonly groupId?: string;
  readonly keyByRef?: Record<string, string>;
  readonly createdColumns?: number;
  readonly addedLabels?: number;
}

async function findPrepared(ctx: ServiceContext, batchId: string): Promise<{ boardId: string; metadata: PreparedMetadata } | null> {
  const [row] = await ctx.db
    .select({ targetId: auditLog.targetId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, ctx.orgId),
        eq(auditLog.action, PREPARED_ACTION),
        ctx.userId ? eq(auditLog.actorId, ctx.userId) : isNull(auditLog.actorId),
        sql`${auditLog.metadata} ->> 'batchId' = ${batchId}`,
      ),
    )
    .limit(1);
  return row?.targetId ? { boardId: row.targetId, metadata: row.metadata as unknown as PreparedMetadata } : null;
}

function labelIdsOf(settings: unknown): string[] {
  const labels = (settings as { labels?: { id: string }[] } | null)?.labels ?? [];
  return labels.map((label) => label.id);
}

function slugKey(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'column';
  let key = /^[a-z]/.test(base) ? base : `c_${base}`;
  let counter = 2;
  while (taken.has(key) || key === 'name') key = `${base.slice(0, 36)}_${counter++}`;
  taken.add(key);
  return key;
}

// ---------------------------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------------------------

export async function prepareImport(ctx: ServiceContext, input: PrepareImportInput): Promise<PrepareImportResult> {
  return inTransaction(ctx, async (tx) => {
    if (input.batchId) {
      // Idempotent per run: a retry after a lost response must not create a second board.
      await lockImportRun(tx, input.batchId);
      const existing = await findPrepared(tx, input.batchId);
      if (existing?.metadata.groupId && existing.metadata.keyByRef) {
        const board = await requireBoard(tx, existing.boardId, 'write');
        return {
          board: toBoardSummaryDto(board),
          groupId: existing.metadata.groupId,
          columns: (await loadBoardColumns(tx, board.id)).map(toColumnDto),
          keyByRef: existing.metadata.keyByRef,
          boardCreated: existing.metadata.boardCreated,
          createdColumns: existing.metadata.createdColumns ?? existing.metadata.createdColumnIds.length,
          addedLabels: existing.metadata.addedLabels ?? 0,
        };
      }
    }
    const keyByRef: Record<string, string> = {};
    let boardId: string;
    let groupId: string;
    let createdGroupId: string | null = null;
    const createdColumnIds: string[] = [];
    const labelChanges: { columnId: string; key: string; type: string; before: string[] }[] = [];
    let addedLabels = 0;
    const destination = input.destination;

    if (destination.type === 'new') {
      if (!hasPermission(tx.roles, 'board:create')) throw new ForbiddenError("You don't have permission to create boards");
      await requireWorkspace(tx, destination.workspaceId);
      const reference = BOARD_TEMPLATES.find((template) => template.kind === destination.kind);
      const taken = new Set<string>();
      const templateColumns: TemplateColumn[] = [
        { key: 'name', title: destination.nameColumnTitle ?? TERMINOLOGY[destination.kind] ?? 'Item', type: 'name', width: 300 },
        ...input.newColumns.map((column) => {
          const key = slugKey(column.title, taken);
          keyByRef[column.ref] = key;
          return {
            key,
            title: column.title,
            type: column.type,
            ...(column.settings !== undefined ? { settings: column.settings as Record<string, unknown> } : {}),
          } satisfies TemplateColumn;
        }),
      ];
      const template: BoardTemplate = {
        id: 'import',
        name: destination.name,
        description: '',
        kind: destination.kind,
        icon: reference?.icon ?? 'LayoutGrid',
        category: 'blank',
        itemTerminology: TERMINOLOGY[destination.kind] ?? 'Item',
        columns: templateColumns,
        groups: [{ key: 'imported', title: destination.groupTitle ?? 'Imported', color: 'blue' }],
        views: [{ type: 'table', name: 'Main table', config: {}, isDefault: true }],
      };
      let created;
      try {
        created = await instantiateTemplate(tx, template, {
          workspaceId: destination.workspaceId,
          folderId: destination.folderId ?? null,
          name: destination.name,
          description: null,
          privacy: destination.privacy,
          withSampleData: false,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new BadRequestError('Some new column settings are invalid. Review the mapping and try again.');
      }
      boardId = created.board.id;
      groupId = created.groupIds.get('imported') as string;
      await publish(tx.db, { type: 'workspace.changed', orgId: tx.orgId, ids: [destination.workspaceId], actorId: tx.userId });
    } else {
      await requireBoard(tx, destination.boardId, 'write');
      boardId = destination.boardId;
      if (destination.newGroupTitle) {
        groupId = (await createGroup(tx, boardId, { title: destination.newGroupTitle })).id;
        createdGroupId = groupId;
      } else if (destination.groupId) {
        const [group] = await tx.db
          .select({ id: groups.id })
          .from(groups)
          .where(and(eq(groups.id, destination.groupId), eq(groups.boardId, boardId), eq(groups.orgId, tx.orgId), isNull(groups.deletedAt)))
          .limit(1);
        if (!group) throw new NotFoundError('Group');
        groupId = group.id;
      } else {
        const [group] = await tx.db
          .select({ id: groups.id })
          .from(groups)
          .where(and(eq(groups.boardId, boardId), eq(groups.orgId, tx.orgId), isNull(groups.deletedAt), isNull(groups.archivedAt)))
          .orderBy(groups.position)
          .limit(1);
        if (group) groupId = group.id;
        else {
          groupId = (await createGroup(tx, boardId, { title: 'Imported' })).id;
          createdGroupId = groupId;
        }
      }
      const current = await loadBoardColumns(tx, boardId);
      for (const update of input.labelUpdates) {
        const column = current.find((entry) => entry.key === update.columnKey && entry.scope === 'item');
        if (!column) throw new NotFoundError('Column', `Column "${update.columnKey}" was not found`);
        if (column.type !== 'status' && column.type !== 'dropdown') throw new BadRequestError('Only label columns can gain labels');
        const before = labelIdsOf(column.settings);
        labelChanges.push({ columnId: column.id, key: column.key, type: column.type, before });
        addedLabels += labelIdsOf(update.settings).filter((id) => !before.includes(id)).length;
        await updateColumn(tx, boardId, column.id, { settings: update.settings });
      }
      for (const column of input.newColumns) {
        const dto = await createColumn(tx, boardId, {
          title: column.title,
          type: column.type,
          scope: 'item',
          hidden: false,
          ...(column.settings !== undefined ? { settings: column.settings } : {}),
        });
        keyByRef[column.ref] = dto.key;
        createdColumnIds.push(dto.id);
      }
    }
    const boardCreated = destination.type === 'new';
    if (input.batchId) {
      await recordAudit(
        {
          orgId: tx.orgId,
          actorId: tx.userId,
          action: PREPARED_ACTION,
          targetType: 'board',
          targetId: boardId,
          metadata: {
            batchId: input.batchId,
            boardCreated,
            createdColumnIds,
            createdGroupId,
            labelChanges,
            groupId,
            keyByRef,
            createdColumns: boardCreated ? input.newColumns.length : createdColumnIds.length,
            addedLabels,
          } satisfies PreparedMetadata,
        },
        tx.db,
      );
    }

    if (input.savedMapping && Object.keys(input.savedMapping).length) {
      const patch = { importMapping: input.savedMapping };
      await tx.db
        .update(boards)
        .set({ settings: sql`${boards.settings} || ${JSON.stringify(patch)}::jsonb` })
        .where(and(eq(boards.id, boardId), eq(boards.orgId, tx.orgId)));
    }

    const board = await requireBoard(tx, boardId, 'write');
    const columns = (await loadBoardColumns(tx, boardId)).map(toColumnDto);
    return {
      board: toBoardSummaryDto(board),
      groupId,
      columns,
      keyByRef,
      boardCreated,
      createdColumns: boardCreated ? input.newColumns.length : createdColumnIds.length,
      addedLabels,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Complete + undo
// ---------------------------------------------------------------------------------------------

/**
 * Finish a run: counts and file name are rebuilt from this actor's batch audit rows (never taken
 * from the client), and the completion is recorded once. Calling it again is a no-op.
 */
export async function completeImport(ctx: ServiceContext, input: ImportCompleteInput): Promise<{ notified: boolean }> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, input.boardId, 'write');
    await lockImportRun(tx, input.batchId);
    const audit = (await loadRunAudit(tx, input.batchId, board.id)).filter((entry) => entry.actorId === tx.userId);
    const batches = audit.filter((entry) => entry.action === BATCH_ACTION).map((entry) => entry.metadata as ImportBatchMetadata);
    if (batches.length === 0) throw new NotFoundError('Import');
    if (audit.some((entry) => entry.action === COMPLETED_ACTION)) return { notified: false };
    const created = batches.reduce((sum, entry) => sum + (entry.created?.length ?? 0), 0);
    const updated = batches.reduce((sum, entry) => sum + (entry.updated?.length ?? 0), 0);
    const skipped = batches.reduce((sum, entry) => sum + (entry.skipped ?? 0), 0);
    const failed = batches.reduce((sum, entry) => sum + (entry.failed ?? 0), 0);
    const fileName = batches.find((entry) => entry.fileName)?.fileName ?? 'import';
    const parts = [
      created ? `${created} added` : null,
      updated ? `${updated} updated` : null,
      skipped ? `${skipped} skipped` : null,
      failed ? `${failed} failed` : null,
    ].filter(Boolean);
    const notified = await notify(tx, {
      kind: 'automation',
      recipients: tx.userId ? [tx.userId] : [],
      boardId: board.id,
      includeActor: true,
      payload: {
        message: `Import of ${fileName} finished: ${parts.join(', ') || 'nothing to import'}`,
        boardName: board.name,
        importBatchId: input.batchId,
      },
    });
    await recordAudit(
      {
        orgId: tx.orgId,
        actorId: tx.userId,
        action: COMPLETED_ACTION,
        targetType: 'board',
        targetId: board.id,
        metadata: { batchId: input.batchId, fileName, created, updated, skipped, failed },
      },
      tx.db,
    );
    return { notified: notified.length > 0 };
  });
}

interface BatchMetadata {
  readonly batchId: string;
  readonly fileName?: string;
  readonly created?: string[];
  readonly updated?: { id: string; before: Record<string, unknown> }[];
  readonly failed?: number;
}

interface AuditEntry {
  readonly action: string;
  readonly metadata: unknown;
  readonly createdAt: Date;
  readonly actorId: string | null;
  readonly targetId: string | null;
}

async function loadRunAudit(ctx: ServiceContext, batchId: string, boardId?: string): Promise<AuditEntry[]> {
  return ctx.db
    .select({
      action: auditLog.action,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      targetId: auditLog.targetId,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, ctx.orgId),
        ...(boardId ? [eq(auditLog.targetId, boardId)] : []),
        inArray(auditLog.action, [PREPARED_ACTION, BATCH_ACTION, COMPLETED_ACTION, UNDO_ACTION]),
        sql`${auditLog.metadata} ->> 'batchId' = ${batchId}`,
      ),
    )
    .orderBy(desc(auditLog.createdAt));
}

/** Values in `key` on active (not archived / deleted) items. */
async function activeValues(tx: ServiceContext, boardId: string, key: string): Promise<unknown[]> {
  const rows = await tx.db
    .select({ value: sql<unknown>`${items.values} -> ${key}` })
    .from(items)
    .where(
      and(
        eq(items.orgId, tx.orgId),
        eq(items.boardId, boardId),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
        sql`${items.values} ? ${key}`,
      ),
    );
  return rows.map((row) => row.value);
}

/** Remove the columns / labels / group the import added, when nothing still uses them. */
async function removeImportSchema(
  tx: ServiceContext,
  boardId: string,
  prepared: PreparedMetadata,
): Promise<{ removedColumns: number; removedLabels: number }> {
  let removedColumns = 0;
  let removedLabels = 0;
  const current = await loadBoardColumns(tx, boardId);
  for (const columnId of prepared.createdColumnIds) {
    const column = current.find((entry) => entry.id === columnId);
    if (!column) continue;
    if ((await activeValues(tx, boardId, column.key)).length > 0) continue;
    await deleteColumn(tx, boardId, columnId);
    removedColumns += 1;
  }
  for (const change of prepared.labelChanges) {
    const column = current.find((entry) => entry.id === change.columnId);
    if (!column) continue;
    const used = new Set<string>();
    for (const value of await activeValues(tx, boardId, column.key)) {
      const record = (value ?? {}) as { labelId?: string; labelIds?: string[] };
      if (record.labelId) used.add(record.labelId);
      for (const id of record.labelIds ?? []) used.add(id);
    }
    const all = (column.settings as { labels?: { id: string }[] } | null)?.labels ?? [];
    const labels = all.filter((label) => change.before.includes(label.id) || used.has(label.id));
    if (labels.length < all.length) {
      await updateColumn(tx, boardId, column.id, { settings: { ...(column.settings as object), labels } as never });
      removedLabels += all.length - labels.length;
    }
  }
  if (prepared.createdGroupId) {
    const [anyItem] = await tx.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.orgId, tx.orgId), eq(items.groupId, prepared.createdGroupId), isNull(items.deletedAt)))
      .limit(1);
    if (!anyItem) {
      try {
        await deleteGroup(tx, boardId, prepared.createdGroupId);
      } catch (error) {
        // A board keeps its last group; anything else is unexpected.
        if (!(error instanceof BadRequestError) && !(error instanceof NotFoundError)) throw error;
      }
    }
  }
  return { removedColumns, removedLabels };
}

export async function undoImport(ctx: ServiceContext, input: ImportUndoInput): Promise<ImportUndoResult> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, input.boardId, 'write');
    const audit = await loadRunAudit(tx, input.batchId, board.id);
    if (audit.some((entry) => entry.action === UNDO_ACTION)) throw new ConflictError('This import was already undone');
    const batches = audit.filter((entry) => entry.action === BATCH_ACTION);
    const preparedRow = audit.find((entry) => entry.action === PREPARED_ACTION);
    if (batches.length === 0 && !preparedRow) throw new NotFoundError('Import');
    const owned = [...batches, ...(preparedRow ? [preparedRow] : [])];
    if (owned.some((entry) => entry.actorId !== tx.userId) && !hasPermission(tx.roles, 'board:delete')) {
      throw new ForbiddenError('Only the person who ran this import can undo it');
    }
    const oldest = Math.min(...owned.map((entry) => entry.createdAt.getTime()));
    if (Date.now() - oldest > UNDO_WINDOW_MS) throw new ConflictError('Imports can only be undone within 24 hours');

    const metadata = batches.map((batch) => batch.metadata as BatchMetadata);
    const createdIds = [...new Set(metadata.flatMap((entry) => entry.created ?? []))];
    let archived = 0;
    for (let start = 0; start < createdIds.length; start += 500) {
      const chunk = createdIds.slice(start, start + 500);
      const rows = await tx.db
        .select()
        .from(items)
        .where(and(eq(items.orgId, tx.orgId), eq(items.boardId, board.id), inArray(items.id, chunk), isNull(items.deletedAt), isNull(items.archivedAt)));
      archived += (await applyLifecycle(tx, board, rows, 'archive')).length;
    }
    const boardColumns = await loadBoardColumns(tx, board.id);
    const known = new Set(boardColumns.map((column) => column.key));
    let reverted = 0;
    for (const entry of metadata.flatMap((batch) => batch.updated ?? [])) {
      const [row] = await tx.db
        .select()
        .from(items)
        .where(and(eq(items.id, entry.id), eq(items.orgId, tx.orgId), isNull(items.deletedAt)))
        .limit(1);
      if (!row) continue;
      const patch = Object.fromEntries(Object.entries(entry.before).filter(([key]) => known.has(key))) as ValuesPatch;
      const result = await persistItemChanges(tx, row, board, boardColumns, patch);
      await finishItemMutation(tx, board, [row.id], result.events);
      reverted += 1;
    }

    const prepared = preparedRow?.metadata as PreparedMetadata | undefined;
    let schema = { removedColumns: 0, removedLabels: 0 };
    let boardDeleted = false;
    if (prepared?.boardCreated) {
      if (input.deleteBoard) {
        const [anyActive] = await tx.db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.orgId, tx.orgId), eq(items.boardId, board.id), isNull(items.deletedAt), isNull(items.archivedAt)))
          .limit(1);
        if (!anyActive) {
          await changeBoardLifecycle(tx, board.id, 'delete');
          boardDeleted = true;
        }
      }
    } else if (prepared && input.removeSchema) {
      schema = await removeImportSchema(tx, board.id, prepared);
    }
    await recordAudit(
      {
        orgId: tx.orgId,
        actorId: tx.userId,
        action: UNDO_ACTION,
        targetType: 'board',
        targetId: board.id,
        metadata: { batchId: input.batchId, archived, reverted, ...schema, boardDeleted },
      },
      tx.db,
    );
    return { archived, reverted, ...schema, boardDeleted };
  });
}

/** Summary of a past import for `/import?run=<batchId>` (only for the person who ran it). */
export async function getImportRun(ctx: ServiceContext, batchId: string): Promise<ImportRunSummary> {
  const audit = await loadRunAudit(ctx, batchId);
  const mine = audit.filter((entry) => entry.actorId === ctx.userId);
  const anchor = mine.find((entry) => entry.action !== UNDO_ACTION && entry.targetId);
  if (!anchor?.targetId) throw new NotFoundError('Import');
  const boardId = anchor.targetId;
  let boardName = 'Deleted board';
  let terminology = 'Item';
  let boardDeleted = false;
  try {
    const board = await requireBoard(ctx, boardId, 'read', { includeDeleted: true });
    boardName = board.name;
    terminology = board.itemTerminology ?? 'Item';
    boardDeleted = Boolean(board.deletedAt);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    boardDeleted = true;
  }
  const batches = mine.filter((entry) => entry.action === BATCH_ACTION).map((entry) => entry.metadata as BatchMetadata);
  const prepared = mine.find((entry) => entry.action === PREPARED_ACTION)?.metadata as PreparedMetadata | undefined;
  const undoneRow = audit.find((entry) => entry.action === UNDO_ACTION)?.metadata as { archived?: number; reverted?: number } | undefined;
  const times = mine.map((entry) => entry.createdAt.getTime());
  return {
    batchId,
    boardId,
    boardName,
    boardDeleted,
    itemTerminology: terminology,
    fileName: batches.find((entry) => entry.fileName)?.fileName ?? 'Import',
    boardCreated: Boolean(prepared?.boardCreated),
    created: batches.reduce((sum, entry) => sum + (entry.created?.length ?? 0), 0),
    updated: batches.reduce((sum, entry) => sum + (entry.updated?.length ?? 0), 0),
    failed: batches.reduce((sum, entry) => sum + (entry.failed ?? 0), 0),
    undone: undoneRow ? { archived: undoneRow.archived ?? 0, reverted: undoneRow.reverted ?? 0 } : null,
    startedAt: new Date(Math.min(...times)).toISOString(),
    finishedAt: new Date(Math.max(...times)).toISOString(),
  };
}
