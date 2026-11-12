/**
 * Import batches: dedupe matching + bulk create/update of up to 250 rows in one transaction.
 *
 * Creates take the bulk path: every row is validated up front (shape in memory, people
 * references with one query per batch), positions are generated once per group, the rows go in
 * as a single multi-row INSERT, activity is written in one statement and realtime/automation
 * events are published once per batch. Only rows that need per-row work (relationship lookups,
 * updates of matched items) use a savepoint each, so one bad row never fails the batch.
 */
import 'server-only';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { auditLog, groups, items, member } from '@/server/db/schema';
import type { StoredCellValue } from '@/server/db/schema/cell-values';
import { recordAudit } from '@/server/audit';
import { AppError, BadRequestError, NotFoundError } from '@/server/http/errors';
import { requireBoard, type BoardRow, type ItemRow } from './access';
import { logActivity, type ActivityInput } from './activity';
import { validateValues, validateValuesShape, type ValidationColumn, type ValuesPatch } from './cell-validation';
import { inTransaction, type ServiceContext } from './context';
import { createGroup } from './groups';
import type { ItemEvent } from './item-events';
import { loadBoardColumns } from './item-reads';
import { persistItemChanges, syncConnectLinks } from './item-values';
import { finishItemMutation, insertItem } from './items';
import { notify } from './notifications';
import { positionsBetween } from './positions';
import {
  normalizeMatchKey,
  type ImportBatchInput,
  type ImportBatchResult,
  type ImportMatchInput,
  type ImportMatchResult,
} from './import-export-contracts';

export const IMPORT_BATCH_ACTION = 'data.import.batch';

/**
 * Serialize work on one import run (retries of the same request queue behind the first one
 * instead of racing it). Transaction-scoped, so it is released on commit / rollback.
 */
export async function lockImportRun(tx: ServiceContext, batchId: string): Promise<void> {
  await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`import:${tx.orgId}:${batchId}`}))`);
}

/** Batch audit metadata; `result` is replayed verbatim when the same batch is sent again. */
export interface ImportBatchMetadata {
  readonly batchId: string;
  readonly fileName?: string;
  readonly firstRow?: number;
  readonly lastRow?: number;
  readonly created?: string[];
  readonly updated?: { id: string; before: Record<string, unknown> }[];
  readonly failed?: number;
  readonly skipped?: number;
  readonly result?: ImportBatchResult;
}

/** The stored result when this exact batch (same run, same first row) already committed. */
async function priorBatchResult(tx: ServiceContext, input: ImportBatchInput): Promise<ImportBatchResult | null> {
  const firstRow = input.rows[0]?.row ?? 0;
  const [prior] = await tx.db
    .select({ metadata: auditLog.metadata })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, tx.orgId),
        eq(auditLog.action, IMPORT_BATCH_ACTION),
        eq(auditLog.targetId, input.boardId),
        sql`${auditLog.metadata} ->> 'batchId' = ${input.batchId}`,
        sql`${auditLog.metadata} ->> 'firstRow' = ${String(firstRow)}`,
      ),
    )
    .limit(1);
  const metadata = prior?.metadata as unknown as ImportBatchMetadata | undefined;
  if (!metadata) return null;
  return (
    metadata.result ?? {
      created: metadata.created?.length ?? 0,
      updated: metadata.updated?.length ?? 0,
      skipped: metadata.skipped ?? 0,
      linkedCreated: 0,
      failed: [],
    }
  );
}

type BoardColumns = Awaited<ReturnType<typeof loadBoardColumns>>;
type BatchRow = ImportBatchInput['rows'][number];
type KeyColumn = { key: string; type: string } | 'name';

// ---------------------------------------------------------------------------------------------
// Dedupe matching
// ---------------------------------------------------------------------------------------------

function keyExpression(column: KeyColumn): SQL {
  if (column === 'name') return sql`lower(trim(${items.name}))`;
  if (column.type === 'email') return sql`lower(trim(${items.values} -> ${column.key} ->> 'email'))`;
  if (column.type === 'phone') return sql`lower(trim(${items.values} -> ${column.key} ->> 'phone'))`;
  if (column.type === 'link') return sql`lower(trim(${items.values} -> ${column.key} ->> 'url'))`;
  return sql`lower(trim(${items.values} ->> ${column.key}))`;
}

async function resolveKeyColumn(ctx: ServiceContext, boardId: string, key: string): Promise<KeyColumn> {
  if (key === 'name') return 'name';
  const column = (await loadBoardColumns(ctx, boardId)).find((entry) => entry.key === key && entry.scope === 'item');
  if (!column) throw new BadRequestError('The match column no longer exists');
  if (!['text', 'email', 'phone', 'link', 'number'].includes(column.type)) {
    throw new BadRequestError('Match on a text, email, phone or link column');
  }
  return { key: column.key, type: column.type };
}

async function findMatches(
  ctx: ServiceContext,
  boardId: string,
  column: KeyColumn,
  keys: readonly string[],
): Promise<Map<string, ItemRow>> {
  const normalized = [...new Set(keys.map(normalizeMatchKey).filter(Boolean))];
  const found = new Map<string, ItemRow>();
  const expression = keyExpression(column);
  for (let start = 0; start < normalized.length; start += 1_000) {
    const chunk = normalized.slice(start, start + 1_000);
    const rows = await ctx.db
      .select({ item: items, key: sql<string>`${expression}` })
      .from(items)
      .where(
        and(
          eq(items.boardId, boardId),
          eq(items.orgId, ctx.orgId),
          isNull(items.parentItemId),
          isNull(items.deletedAt),
          isNull(items.archivedAt),
          inArray(expression, chunk),
        ),
      );
    for (const row of rows) if (!found.has(row.key)) found.set(row.key, row.item);
  }
  return found;
}

export async function matchImportKeys(ctx: ServiceContext, input: ImportMatchInput): Promise<ImportMatchResult> {
  await requireBoard(ctx, input.boardId, 'read');
  const column = await resolveKeyColumn(ctx, input.boardId, input.key);
  const matches = await findMatches(ctx, input.boardId, column, input.values);
  return { matched: [...matches.keys()] };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function rowMessage(error: unknown): string {
  if (error instanceof AppError) {
    const details = error.toBody().details as { issues?: { path: string; message: string }[] } | undefined;
    const issues = details?.issues ?? [];
    if (issues.length) return issues.map((issue) => `${issue.path.replace(/^values\./, '')}: ${issue.message}`).join('; ');
    return error.message;
  }
  return 'This row could not be saved';
}

async function resolveLinks(
  tx: ServiceContext,
  boardColumns: BoardColumns,
  links: Record<string, string[]>,
  cache: Map<string, string>,
  createMissing: boolean,
  counter: { created: number },
): Promise<Record<string, { itemIds: string[] }>> {
  const out: Record<string, { itemIds: string[] }> = {};
  for (const [columnKey, names] of Object.entries(links)) {
    const column = boardColumns.find((entry) => entry.key === columnKey && entry.type === 'connect_boards');
    const targetBoardId = (column?.settings as { boardIds?: string[] } | null)?.boardIds?.[0];
    if (!column || !targetBoardId) throw new BadRequestError(`"${columnKey}" isn't connected to another board`);
    const ids: string[] = [];
    for (const name of names) {
      const cacheKey = `${targetBoardId}:${normalizeMatchKey(name)}`;
      let id = cache.get(cacheKey);
      if (!id) {
        const target = await requireBoard(tx, targetBoardId, createMissing ? 'write' : 'read');
        const [existing] = await tx.db
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.boardId, target.id),
              eq(items.orgId, tx.orgId),
              isNull(items.deletedAt),
              isNull(items.parentItemId),
              sql`lower(trim(${items.name})) = ${normalizeMatchKey(name)}`,
            ),
          )
          .limit(1);
        id = existing?.id;
        if (!id && createMissing) {
          const targetColumns = await loadBoardColumns(tx, target.id);
          const result = await insertItem(tx, target, targetColumns, { name, position: 'bottom' });
          await finishItemMutation(tx, target, [result.row.id], result.events);
          id = result.row.id;
          counter.created += 1;
        }
        if (!id) throw new BadRequestError(`No item named "${name}" on the connected board`);
        cache.set(cacheKey, id);
      }
      if (!ids.includes(id)) ids.push(id);
    }
    out[columnKey] = { itemIds: ids };
  }
  return out;
}

function nonEmpty(values: ValuesPatch): Record<string, StoredCellValue> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined)) as Record<
    string,
    StoredCellValue
  >;
}

/** Values that need a per-row reference check we don't batch (files, raw relationship ids). */
function needsSlowValidation(boardColumns: BoardColumns, values: Record<string, unknown>): boolean {
  const byKey = new Map(boardColumns.map((column) => [column.key, column.type]));
  return Object.keys(values).some((key) => byKey.get(key) === 'files' || byKey.get(key) === 'connect_boards');
}

/** Resolve (and create when missing) the groups rows are routed into by title. */
async function resolveGroups(
  tx: ServiceContext,
  boardId: string,
  defaultGroupId: string,
  rows: readonly BatchRow[],
): Promise<Map<string, string>> {
  const titles = [...new Set(rows.map((row) => row.groupTitle?.trim()).filter((title): title is string => Boolean(title)))];
  const byTitle = new Map<string, string>();
  if (titles.length === 0) return byTitle;
  const existing = await tx.db
    .select({ id: groups.id, title: groups.title })
    .from(groups)
    .where(and(eq(groups.boardId, boardId), eq(groups.orgId, tx.orgId), isNull(groups.deletedAt)))
    .orderBy(groups.position);
  for (const group of existing) {
    const key = normalizeMatchKey(group.title);
    if (!byTitle.has(key)) byTitle.set(key, group.id);
  }
  for (const title of titles.slice(0, 50)) {
    const key = normalizeMatchKey(title);
    if (!byTitle.has(key)) byTitle.set(key, (await createGroup(tx, boardId, { title })).id);
  }
  // Titles beyond the cap land in the default group.
  for (const title of titles.slice(50)) if (!byTitle.has(normalizeMatchKey(title))) byTitle.set(normalizeMatchKey(title), defaultGroupId);
  return byTitle;
}

async function lastPosition(tx: ServiceContext, groupId: string): Promise<string | null> {
  const [last] = await tx.db
    .select({ position: items.position })
    .from(items)
    .where(and(eq(items.orgId, tx.orgId), eq(items.groupId, groupId), isNull(items.parentItemId), isNull(items.deletedAt)))
    .orderBy(desc(items.position))
    .limit(1);
  return last?.position ?? null;
}

interface PendingCreate {
  readonly row: BatchRow;
  readonly groupId: string;
  readonly values: Record<string, StoredCellValue>;
  readonly matchKey: string;
}

/** Validate in memory; returns per-row failures for anything that doesn't fit. */
async function validateCreates(
  tx: ServiceContext,
  boardColumns: BoardColumns,
  candidates: readonly { row: BatchRow; groupId: string; values: Record<string, unknown>; matchKey: string }[],
  failed: { row: number; message: string }[],
): Promise<PendingCreate[]> {
  const shaped: PendingCreate[] = [];
  const peopleKeys = boardColumns.filter((column) => column.type === 'people' && column.scope === 'item').map((column) => column.key);
  for (const candidate of candidates) {
    if (needsSlowValidation(boardColumns, candidate.values)) {
      try {
        const patch = await validateValues(tx, boardColumns, candidate.values, 'item');
        shaped.push({ ...candidate, values: nonEmpty(patch) });
      } catch (error) {
        failed.push({ row: candidate.row.row, message: rowMessage(error) });
      }
      continue;
    }
    const { patch, issues } = validateValuesShape(boardColumns, candidate.values, 'item');
    if (issues.length) {
      failed.push({ row: candidate.row.row, message: issues.map((issue) => `${issue.path.replace(/^values\./, '')}: ${issue.message}`).join('; ') });
      continue;
    }
    shaped.push({ ...candidate, values: nonEmpty(patch) });
  }
  // People must be members of the org: one lookup for the whole batch.
  const ids = new Set<string>();
  for (const entry of shaped) for (const key of peopleKeys) for (const id of (entry.values[key] as { ids?: string[] } | undefined)?.ids ?? []) ids.add(id);
  if (ids.size === 0) return shaped;
  const rows = await tx.db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, tx.orgId), inArray(member.userId, [...ids])));
  const found = new Set(rows.map((row) => row.userId));
  return shaped.filter((entry) => {
    const bad = peopleKeys.find((key) => ((entry.values[key] as { ids?: string[] } | undefined)?.ids ?? []).some((id) => !found.has(id)));
    if (!bad) return true;
    failed.push({ row: entry.row.row, message: `${bad}: Every person must be a member of this organization` });
    return false;
  });
}

/** One multi-row INSERT for the batch (positions appended per group). */
async function bulkInsert(tx: ServiceContext, board: BoardRow, pending: readonly PendingCreate[]): Promise<ItemRow[]> {
  const byGroup = new Map<string, PendingCreate[]>();
  for (const entry of pending) byGroup.set(entry.groupId, [...(byGroup.get(entry.groupId) ?? []), entry]);
  const values: (typeof items.$inferInsert)[] = [];
  for (const [groupId, entries] of byGroup) {
    const positions = positionsBetween(await lastPosition(tx, groupId), null, entries.length);
    entries.forEach((entry, index) =>
      values.push({
        orgId: tx.orgId,
        boardId: board.id,
        groupId,
        parentItemId: null,
        name: entry.row.name,
        position: positions[index] as string,
        values: entry.values,
        createdBy: tx.userId,
        updatedBy: tx.userId,
      }),
    );
  }
  return inTransaction(tx, (inner) => inner.db.insert(items).values(values).returning());
}

/** Post-insert side effects shared by the bulk and fallback paths. */
async function afterCreate(
  tx: ServiceContext,
  board: BoardRow,
  boardColumns: BoardColumns,
  created: readonly ItemRow[],
): Promise<ItemEvent[]> {
  const connectColumns = boardColumns.filter((column) => column.type === 'connect_boards');
  for (const row of created) {
    for (const column of connectColumns) {
      if (row.values[column.key] !== undefined) await syncConnectLinks(tx, row.id, column as ValidationColumn, null, row.values[column.key]);
    }
  }
  const activities: ActivityInput[] = created.map((row) => ({
    boardId: board.id,
    itemId: row.id,
    action: 'item.created',
    after: { name: row.name, groupId: row.groupId, parentItemId: null, source: 'import' },
  }));
  await logActivity(tx, activities);
  // Assignment notifications: one per person per batch (not one per row).
  const assigned = new Map<string, { column: string; items: ItemRow[] }>();
  for (const column of boardColumns.filter((entry) => entry.type === 'people')) {
    for (const row of created) {
      for (const id of (row.values[column.key] as { ids?: string[] } | undefined)?.ids ?? []) {
        const current = assigned.get(id) ?? { column: column.title, items: [] };
        assigned.set(id, { column: current.column, items: [...current.items, row] });
      }
    }
  }
  for (const [userId, entry] of assigned) {
    const first = entry.items[0] as ItemRow;
    await notify(tx, {
      kind: 'assigned',
      recipients: [userId],
      boardId: board.id,
      itemId: first.id,
      payload: {
        columnTitle: entry.column,
        itemName: entry.items.length > 1 ? `${first.name} and ${entry.items.length - 1} more` : first.name,
        boardName: board.name,
      },
    });
  }
  return created.map((row) => ({ type: 'item_created', boardId: board.id, itemId: row.id }) satisfies ItemEvent);
}

// ---------------------------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------------------------

export async function runImportBatch(ctx: ServiceContext, input: ImportBatchInput): Promise<ImportBatchResult> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, input.boardId, 'write');
    // Idempotent per (run, first row): a retry after a lost response replays the stored result
    // instead of inserting every row a second time.
    await lockImportRun(tx, input.batchId);
    const replay = await priorBatchResult(tx, input);
    if (replay) return replay;
    const boardColumns = await loadBoardColumns(tx, board.id);
    const [group] = await tx.db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, input.groupId), eq(groups.boardId, board.id), eq(groups.orgId, tx.orgId), isNull(groups.deletedAt)))
      .limit(1);
    if (!group) throw new NotFoundError('Group');
    const groupByTitle = await resolveGroups(tx, board.id, group.id, input.rows);

    const dedupe = input.dedupe.mode !== 'create' && input.dedupe.key ? input.dedupe : null;
    const keyColumn = dedupe?.key ? await resolveKeyColumn(tx, board.id, dedupe.key) : null;
    const matches =
      keyColumn && dedupe
        ? await findMatches(tx, board.id, keyColumn, input.rows.map((row) => row.key ?? '').filter(Boolean))
        : new Map<string, ItemRow>();

    const updated: { id: string; before: Record<string, unknown> }[] = [];
    const failed: { row: number; message: string }[] = [];
    const events: ItemEvent[] = [];
    const linkCache = new Map<string, string>();
    const linkCounter = { created: 0 };
    const seenKeys = new Set<string>();
    const candidates: { row: BatchRow; groupId: string; values: Record<string, unknown>; matchKey: string }[] = [];
    let skipped = 0;

    for (const row of input.rows) {
      const matchKey = row.key ? normalizeMatchKey(row.key) : '';
      const match = matchKey ? matches.get(matchKey) : undefined;
      // Repeats inside the file collapse onto the first occurrence when deduping.
      if (dedupe && matchKey && !match && seenKeys.has(matchKey)) {
        skipped += 1;
        continue;
      }
      if (matchKey) seenKeys.add(matchKey);
      if (match && dedupe?.mode === 'skip') {
        skipped += 1;
        continue;
      }
      try {
        const linkValues = row.links
          ? await inTransaction(tx, (rowTx) => resolveLinks(rowTx, boardColumns, row.links as Record<string, string[]>, linkCache, input.createMissingLinks, linkCounter))
          : {};
        const values = { ...row.values, ...linkValues };
        if (match && dedupe?.mode === 'update') {
          await inTransaction(tx, async (rowTx) => {
            const patch = await validateValues(rowTx, boardColumns, nonEmpty(values as ValuesPatch), 'item');
            const before = Object.fromEntries(Object.keys(patch).map((key) => [key, match.values[key] ?? null]));
            const result = await persistItemChanges(rowTx, match, board, boardColumns, patch);
            events.push(...result.events);
            updated.push({ id: match.id, before });
          });
          continue;
        }
        const groupId = row.groupTitle ? (groupByTitle.get(normalizeMatchKey(row.groupTitle)) ?? group.id) : group.id;
        candidates.push({ row, groupId, values, matchKey });
      } catch (error) {
        failed.push({ row: row.row, message: rowMessage(error) });
      }
    }

    const pending = await validateCreates(tx, boardColumns, candidates, failed);
    let created: ItemRow[] = [];
    if (pending.length) {
      try {
        created = await bulkInsert(tx, board, pending);
      } catch {
        // Something the in-memory checks missed: isolate the offending rows one by one.
        for (const entry of pending) {
          try {
            const result = await inTransaction(tx, (rowTx) =>
              insertItem(rowTx, board, boardColumns, { name: entry.row.name, groupId: entry.groupId, values: entry.values, position: 'bottom' }),
            );
            created.push(result.row);
          } catch (error) {
            failed.push({ row: entry.row.row, message: rowMessage(error) });
          }
        }
      }
      events.push(...(await afterCreate(tx, board, boardColumns, created)));
    }

    const createdIds = created.map((row) => row.id);
    const touched = [...createdIds, ...updated.map((entry) => entry.id)];
    if (touched.length) await finishItemMutation(tx, board, touched, events);
    failed.sort((a, b) => a.row - b.row);
    const result: ImportBatchResult = { created: createdIds.length, updated: updated.length, skipped, linkedCreated: linkCounter.created, failed };
    await recordAudit(
      {
        orgId: tx.orgId,
        actorId: tx.userId,
        action: IMPORT_BATCH_ACTION,
        targetType: 'board',
        targetId: board.id,
        metadata: {
          batchId: input.batchId,
          fileName: input.fileName,
          firstRow: input.rows[0]?.row ?? 0,
          lastRow: input.rows[input.rows.length - 1]?.row ?? 0,
          created: createdIds,
          updated,
          failed: failed.length,
          skipped,
          result,
        } satisfies ImportBatchMetadata,
      },
      tx.db,
    );
    return result;
  });
}
