/**
 * Duplicate management for Contacts and Accounts: scan (pure clustering in `crm-model.ts`),
 * side-by-side field compare, merge (per-field winner choice, fill empty fields, union
 * relations, re-point every incoming link, trash the duplicates) with a lossless Undo (the
 * merge diff is recorded on the `crm.merged` activity row and reversed by `restoreMerged`),
 * and "not a duplicate" dismissals stored in `boards.settings.crm`.
 */
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { activityLog, itemLinks, items } from '@/server/db/schema';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { requireBoard, type ItemRow } from './access';
import { inTransaction, type ServiceContext } from './context';
import {
  canUseCrmCache,
  connectColumnTo,
  crmSettings,
  findColumn,
  labelsOf,
  loadBoardRows,
  loadCrmBoard,
  loadItemsByIds,
  orgUsers,
  readConnect,
  readDomain,
  readEmail,
  readPeople,
  readText,
  resolveCrmBoards,
  saveCrmSettings,
} from './crm-boards';
import { boardsVersion, cachedCrm, invalidateCrmCache } from './crm-cache';
import type {
  CrmUserDto,
  DismissDuplicatesInput,
  DuplicateFieldDto,
  DuplicatesDto,
  MergeDuplicatesInput,
  MergeResultDto,
  RestoreMergedInput,
} from './crm-contracts';
import { buildPrimaryPatch, isEmptyValue, NON_COMPARABLE_TYPES } from './crm-merge';
import { clusterIds, emailDomain, pairKey, suggestPrimary, type DuplicateCandidate } from './crm-model';
import { applyLifecycle, updateItem } from './items';
import { loadBoardColumns, type ColumnRow } from './item-reads';

export const MERGED_ACTION = 'crm.merged';
const ROWS_TTL_MS = 60_000;

const NON_COMPARABLE = NON_COMPARABLE_TYPES;
const isEmpty = isEmptyValue;

async function boardFor(ctx: ServiceContext, kind: 'contacts' | 'accounts') {
  const resolved = await resolveCrmBoards(ctx);
  return { board: await loadCrmBoard(ctx, resolved.primary[kind]), resolved };
}

async function linkCounts(ctx: ServiceContext, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: itemLinks.toItemId, total: count() })
    .from(itemLinks)
    .where(and(eq(itemLinks.orgId, ctx.orgId), inArray(itemLinks.toItemId, [...ids])))
    .groupBy(itemLinks.toItemId);
  return new Map(rows.map((row) => [row.id, row.total]));
}

function comparableColumns(columns: readonly ColumnRow[]): ColumnRow[] {
  return columns.filter((column) => column.scope === 'item' && column.key !== 'name' && !NON_COMPARABLE.has(column.type));
}

/** Plain display text of a stored cell value (for the compare grid). */
export function cellText(column: ColumnRow, value: unknown, users: ReadonlyMap<string, CrmUserDto>): string | null {
  if (isEmpty(value)) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.labelId === 'string') {
    return labelsOf(column).find((label) => label.id === record.labelId)?.name ?? null;
  }
  if (Array.isArray(record.labelIds)) {
    const names = labelsOf(column)
      .filter((label) => (record.labelIds as unknown[]).includes(label.id))
      .map((label) => label.name);
    return names.length > 0 ? names.join(', ') : null;
  }
  if (Array.isArray(record.ids)) {
    const names = (record.ids as unknown[]).map((id) => (typeof id === 'string' ? users.get(id)?.name : undefined)).filter(Boolean);
    return names.length > 0 ? names.join(', ') : null;
  }
  if (typeof record.amount === 'number') {
    return `${typeof record.currency === 'string' ? `${record.currency} ` : ''}${record.amount.toLocaleString('en-US')}`;
  }
  if (typeof record.date === 'string') return `${record.date.slice(0, 10)}${typeof record.time === 'string' ? ` ${record.time}` : ''}`;
  if (typeof record.checked === 'boolean') return record.checked ? 'Checked' : null;
  if (typeof record.rating === 'number') return `${record.rating}★`;
  for (const key of ['email', 'phone', 'text', 'url', 'address', 'value']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return null;
}

async function boardRowsCached(ctx: ServiceContext, boardId: string): Promise<ItemRow[]> {
  if (!canUseCrmCache(ctx)) return loadBoardRows(ctx, boardId);
  const version = await boardsVersion(ctx, [boardId]);
  return cachedCrm(ctx.orgId, `rows:${boardId}`, version, ROWS_TTL_MS, () => loadBoardRows(ctx, boardId));
}

export async function listDuplicates(ctx: ServiceContext, kind: 'contacts' | 'accounts'): Promise<DuplicatesDto> {
  const { board, resolved } = await boardFor(ctx, kind);
  if (!board) return { kind, board: null, scanned: 0, clusters: [], dismissedCount: 0, canEdit: false };
  const [rows, users, canEdit] = await Promise.all([
    boardRowsCached(ctx, board.row.id),
    orgUsers(ctx),
    requireBoard(ctx, board.row.id, 'write').then(
      () => true,
      () => false,
    ),
  ]);
  const cols = board.columns;
  const compared = comparableColumns(cols);
  const emailColumn = findColumn(cols, ['email'], 'email');
  const websiteColumn = findColumn(cols, ['website', 'domain'], 'link');
  const accountColumn = kind === 'contacts' ? connectColumnTo(cols, resolved.primary.accounts?.id, ['account']) : undefined;
  const secondaryColumn =
    kind === 'contacts' ? findColumn(cols, ['job_title', 'title'], 'text') : findColumn(cols, ['hq', 'location'], ['location', 'text']);
  const ownerColumn = findColumn(cols, ['owner', 'account_owner'], 'people');
  const candidates: DuplicateCandidate[] = rows.map((row) => {
    const email = readEmail(row.values, emailColumn);
    return {
      id: row.id,
      name: row.name,
      email,
      domain: kind === 'contacts' ? emailDomain(email) : readDomain(row.values, websiteColumn),
      accountId: readConnect(row.values, accountColumn)[0] ?? null,
      linkCount: 0,
      filledFields: compared.filter((column) => !isEmpty(row.values[column.key])).length,
      createdAt: row.createdAt.toISOString(),
    };
  });
  const dismissed = new Set(crmSettings(board.row).dismissedDuplicates ?? []);
  const raw = clusterIds(kind, candidates, dismissed);
  // Link counts only for clustered records (cheap even on big boards).
  const links = await linkCounts(
    ctx,
    raw.flatMap((cluster) => cluster.records.map((record) => record.id)),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const clusters = raw.map((cluster) => {
    const records = cluster.records.map((record) => ({ ...record, linkCount: links.get(record.id) ?? 0 }));
    const texts = new Map(
      records.map((record) => {
        const row = byId.get(record.id) as ItemRow;
        return [record.id, Object.fromEntries(compared.map((column) => [column.key, cellText(column, row.values[column.key], users)]))];
      }),
    );
    const fields: DuplicateFieldDto[] = compared.flatMap((column) => {
      const values = records.map((record) => texts.get(record.id)?.[column.key] ?? null);
      const present = values.filter((value): value is string => value !== null);
      if (present.length === 0) return [];
      return [{ key: column.key, title: column.title, conflict: new Set(present.map((value) => value.toLowerCase())).size > 1 }];
    });
    return {
      key: cluster.key,
      reason: cluster.reason,
      confidence: cluster.confidence,
      suggestedPrimaryId: suggestPrimary(records),
      fields,
      records: records.map((record) => {
        const row = byId.get(record.id) as ItemRow;
        const ownerId = readPeople(row.values, ownerColumn)[0];
        return {
          id: record.id,
          name: record.name,
          boardId: board.row.id,
          email: record.email,
          domain: record.domain,
          secondary: readText(row.values, secondaryColumn),
          owner: ownerId ? (users.get(ownerId) ?? null) : null,
          linkCount: record.linkCount,
          filledFields: record.filledFields,
          updatedAt: row.updatedAt.toISOString(),
          fields: texts.get(record.id) ?? {},
        };
      }),
    };
  });
  return { kind, board: board.ref, scanned: rows.length, clusters, dismissedCount: dismissed.size, canEdit };
}

interface MergeDiff {
  readonly mergedIds: string[];
  readonly names: string[];
  /** Primary values before the merge for every key the merge wrote (null = was empty). */
  readonly primaryBefore: Record<string, unknown>;
  /** Other items whose connect cells were re-pointed: their cells before the merge. */
  readonly sources: { itemId: string; before: Record<string, unknown> }[];
}

/** Merge duplicates into the primary record. */
export async function mergeDuplicates(ctx: ServiceContext, input: MergeDuplicatesInput): Promise<MergeResultDto> {
  const duplicateIds = [...new Set(input.duplicateIds)].filter((id) => id !== input.primaryId);
  if (duplicateIds.length === 0) throw new BadRequestError('Pick at least one duplicate to merge');
  const { board } = await boardFor(ctx, input.kind);
  if (!board) throw new NotFoundError('Board');
  await requireBoard(ctx, board.row.id, 'write');
  const records = await loadItemsByIds(ctx, [input.primaryId, ...duplicateIds], [board.row.id]);
  const primary = records.find((row) => row.id === input.primaryId);
  const duplicates = records.filter((row) => row.id !== input.primaryId);
  if (!primary || duplicates.length !== duplicateIds.length) throw new NotFoundError('Item');
  const choices = Object.fromEntries(
    Object.entries(input.fieldChoices ?? {}).filter(([, id]) => id === primary.id || duplicateIds.includes(id)),
  );

  const result = await inTransaction(ctx, async (tx) => {
    // 1. Field winners / fill empty / relation union on the primary.
    const { patch, filled } = buildPrimaryPatch(board.columns, primary, duplicates, choices);
    const primaryBefore = Object.fromEntries(Object.keys(patch).map((key) => [key, primary.values[key] ?? null]));
    if (Object.keys(patch).length > 0) await updateItem(tx, primary.id, { values: patch as never });

    // 2. Re-point incoming links (other boards' connect cells that reference a duplicate).
    const incoming = await tx.db
      .select({ from: itemLinks.fromItemId, column: itemLinks.columnKey })
      .from(itemLinks)
      .where(and(eq(itemLinks.orgId, tx.orgId), inArray(itemLinks.toItemId, duplicateIds)));
    const sources = await loadItemsByIds(
      tx,
      incoming.map((link) => link.from).filter((id) => id !== primary.id && !duplicateIds.includes(id)),
    );
    let movedLinks = 0;
    const sourceDiffs: MergeDiff['sources'] = [];
    const columnCache = new Map<string, Awaited<ReturnType<typeof loadBoardColumns>>>();
    for (const source of sources) {
      const cols = columnCache.get(source.boardId) ?? (await loadBoardColumns(tx, source.boardId));
      columnCache.set(source.boardId, cols);
      const sourcePatch: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const link of incoming.filter((entry) => entry.from === source.id)) {
        const column = cols.find((entry) => entry.key === link.column && entry.type === 'connect_boards');
        if (!column || column.key in sourcePatch) continue;
        const current = readConnect(source.values, column);
        const replaced = [...new Set(current.map((id) => (duplicateIds.includes(id) ? primary.id : id)))];
        const allowMultiple = (column.settings as { allowMultiple?: boolean }).allowMultiple !== false;
        sourcePatch[column.key] = { itemIds: allowMultiple ? replaced : replaced.slice(0, 1) };
        before[column.key] = source.values[column.key] ?? null;
        movedLinks += 1;
      }
      if (Object.keys(sourcePatch).length === 0) continue;
      const writable = await requireBoard(tx, source.boardId, 'write').then(
        () => true,
        () => false,
      );
      if (!writable) continue;
      await updateItem(tx, source.id, { values: sourcePatch as never });
      sourceDiffs.push({ itemId: source.id, before });
    }

    // 3. Trash the duplicates and record the diff for a lossless Undo.
    await applyLifecycle(tx, board.row, duplicates, 'delete');
    const diff: MergeDiff = {
      mergedIds: duplicateIds,
      names: duplicates.map((row) => row.name),
      primaryBefore,
      sources: sourceDiffs,
    };
    const [logged] = await tx.db
      .insert(activityLog)
      .values({
        orgId: tx.orgId,
        boardId: board.row.id,
        itemId: primary.id,
        actorId: tx.userId,
        action: MERGED_ACTION,
        before: diff as never,
        after: { filledFields: filled, movedLinks } as never,
      })
      .returning({ id: activityLog.id });
    return {
      primary: { id: primary.id, name: primary.name, boardId: board.row.id },
      mergedIds: duplicateIds,
      movedLinks,
      filledFields: filled,
      mergeId: logged?.id ?? null,
    };
  });
  invalidateCrmCache(ctx.orgId);
  return result;
}

async function latestMergeDiff(ctx: ServiceContext, primaryId: string, itemIds: readonly string[]): Promise<MergeDiff | null> {
  const rows = await ctx.db
    .select({ before: activityLog.before })
    .from(activityLog)
    .where(and(eq(activityLog.orgId, ctx.orgId), eq(activityLog.itemId, primaryId), eq(activityLog.action, MERGED_ACTION)))
    .orderBy(desc(activityLog.createdAt))
    .limit(5);
  for (const row of rows) {
    const diff = row.before as Partial<MergeDiff> | null;
    if (diff?.mergedIds && itemIds.every((id) => diff.mergedIds?.includes(id))) {
      return {
        mergedIds: diff.mergedIds,
        names: diff.names ?? [],
        primaryBefore: diff.primaryBefore ?? {},
        sources: diff.sources ?? [],
      };
    }
  }
  return null;
}

/**
 * Undo for a merge: restore the trashed duplicates and, when `primaryId` is given, revert the
 * primary's merged fields and point re-pointed links back at the restored records.
 */
export async function restoreMerged(ctx: ServiceContext, input: RestoreMergedInput): Promise<{ restored: number; reverted: boolean }> {
  const resolved = await resolveCrmBoards(ctx);
  const boardIds = [resolved.primary.contacts?.id, resolved.primary.accounts?.id].filter((id): id is string => Boolean(id));
  if (boardIds.length === 0) return { restored: 0, reverted: false };
  const rows = (
    await ctx.db
      .select()
      .from(items)
      .where(and(eq(items.orgId, ctx.orgId), inArray(items.id, [...input.itemIds]), inArray(items.boardId, boardIds)))
  ).filter((row) => row.deletedAt !== null);
  const diff = input.primaryId ? await latestMergeDiff(ctx, input.primaryId, input.itemIds) : null;
  // Nothing in Trash means this merge was already undone: never revert the primary twice.
  if (rows.length === 0) return { restored: 0, reverted: false };
  const result = await inTransaction(ctx, async (tx) => {
    let restored = 0;
    for (const boardId of new Set(rows.map((row) => row.boardId))) {
      const board = await requireBoard(tx, boardId, 'write');
      restored += (await applyLifecycle(tx, board, rows.filter((row) => row.boardId === boardId), 'restore')).length;
    }
    if (diff && input.primaryId) {
      if (Object.keys(diff.primaryBefore).length > 0) {
        await updateItem(tx, input.primaryId, { values: diff.primaryBefore as never });
      }
      const sourceRows = await loadItemsByIds(
        tx,
        diff.sources.map((source) => source.itemId),
      );
      for (const source of diff.sources) {
        const row = sourceRows.find((entry) => entry.id === source.itemId);
        if (!row) continue;
        const writable = await requireBoard(tx, row.boardId, 'write').then(
          () => true,
          () => false,
        );
        if (writable) await updateItem(tx, row.id, { values: source.before as never });
      }
    }
    return { restored, reverted: Boolean(diff) };
  });
  invalidateCrmCache(ctx.orgId);
  return result;
}

export async function dismissDuplicates(ctx: ServiceContext, input: DismissDuplicatesInput): Promise<{ dismissed: number }> {
  const { board } = await boardFor(ctx, input.kind);
  if (!board) throw new NotFoundError('Board');
  await requireBoard(ctx, board.row.id, 'write');
  const ids = [...new Set(input.itemIds)];
  const pairs: string[] = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) pairs.push(pairKey(ids[i] as string, ids[j] as string));
  const current = new Set(crmSettings(board.row).dismissedDuplicates ?? []);
  for (const pair of pairs) {
    if (input.undo) current.delete(pair);
    else current.add(pair);
  }
  const next = [...current].slice(-5_000);
  await saveCrmSettings(ctx, board.row.id, { dismissedDuplicates: next });
  return { dismissed: next.length };
}
