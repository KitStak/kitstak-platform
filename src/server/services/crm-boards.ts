/**
 * CRM board resolution and shared loaders. The CRM surfaces work on whatever CRM boards the
 * caller can see: one primary board per object kind (the biggest, oldest on ties), with the
 * related boards discovered through connect_boards columns of the primary deals board.
 * Column roles are resolved by stable template keys first, then by column type.
 */
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { cachedCrm } from './crm-cache';
import { boards, groups, items, member, user } from '@/server/db/schema';
import type { LabelColor } from '@/server/db/schema/cell-values';
import { BadRequestError } from '@/server/http/errors';
import { visibleBoardsPredicate, type BoardRow, type ItemRow } from './access';
import type { ServiceContext } from './context';
import type { CrmBoardRefDto, CrmBoardSettings, CrmLabelDto, CrmObjectKind, CrmUserDto } from './crm-contracts';
import { domainFromUrl, type StageLabelInput } from './crm-model';
import { loadBoardColumns, type ColumnRow } from './item-reads';

export const MAX_CRM_ITEMS = 5_000;

export interface CrmBoard {
  readonly row: BoardRow;
  readonly ref: CrmBoardRefDto;
  readonly columns: readonly ColumnRow[];
}

const KINDS: readonly CrmObjectKind[] = ['leads', 'contacts', 'accounts', 'deals', 'activities'];

export function toRef(row: BoardRow, itemCount: number): CrmBoardRefDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CrmObjectKind,
    itemTerminology: row.itemTerminology,
    itemCount,
  };
}

/** Every visible, live CRM board with its top-level item count. */
export async function listCrmBoardRows(ctx: ServiceContext): Promise<{ row: BoardRow; itemCount: number }[]> {
  const rows = await ctx.db
    .select({ board: boards })
    .from(boards)
    .where(and(visibleBoardsPredicate(ctx), isNull(boards.archivedAt), inArray(boards.kind, [...KINDS])))
    .orderBy(asc(boards.createdAt));
  if (rows.length === 0) return [];
  const counts = await ctx.db
    .select({ boardId: items.boardId, total: count() })
    .from(items)
    .where(
      and(
        eq(items.orgId, ctx.orgId),
        inArray(
          items.boardId,
          rows.map((entry) => entry.board.id),
        ),
        isNull(items.parentItemId),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
      ),
    )
    .groupBy(items.boardId);
  const byBoard = new Map(counts.map((entry) => [entry.boardId, entry.total]));
  return rows.map((entry) => ({ row: entry.board, itemCount: byBoard.get(entry.board.id) ?? 0 }));
}

function templateOf(row: BoardRow): string | undefined {
  return (row.settings as { templateId?: string }).templateId;
}

function connectTargets(columns: readonly ColumnRow[]): string[] {
  return columns
    .filter((column) => column.type === 'connect_boards')
    .flatMap((column) => (column.settings as { boardIds?: string[] }).boardIds ?? []);
}

export interface ResolvedCrmBoards {
  readonly primary: Partial<Record<CrmObjectKind, CrmBoardRefDto>>;
  readonly dealBoards: CrmBoardRefDto[];
}

/** True when `ctx` runs on the pooled db (not inside a transaction) and may use the cache. */
export function canUseCrmCache(ctx: ServiceContext): boolean {
  return !(ctx.db instanceof PgTransaction);
}

const RESOLVE_TTL_MS = 10_000;

/**
 * Primary board per kind: linked from the main deals board when possible, else the biggest.
 * Cached briefly per user (visibility is per user); CRM writes invalidate the org's entries.
 */
export async function resolveCrmBoards(ctx: ServiceContext, preferDealsBoardId?: string): Promise<ResolvedCrmBoards> {
  if (!canUseCrmCache(ctx)) return resolveCrmBoardsUncached(ctx, preferDealsBoardId);
  const key = `resolve:${ctx.userId ?? 'system'}:${[...ctx.roles].sort().join(',')}:${preferDealsBoardId ?? ''}`;
  return cachedCrm(ctx.orgId, key, 'v1', RESOLVE_TTL_MS, () => resolveCrmBoardsUncached(ctx, preferDealsBoardId));
}

async function resolveCrmBoardsUncached(ctx: ServiceContext, preferDealsBoardId?: string): Promise<ResolvedCrmBoards> {
  const all = await listCrmBoardRows(ctx);
  const ofKind = (kind: CrmObjectKind) =>
    all
      .filter((entry) => entry.row.kind === kind)
      .sort(
        (a, b) =>
          Number(templateOf(b.row) === `crm-${kind}`) - Number(templateOf(a.row) === `crm-${kind}`) ||
          b.itemCount - a.itemCount ||
          a.row.createdAt.getTime() - b.row.createdAt.getTime(),
      );
  const primary: Partial<Record<CrmObjectKind, CrmBoardRefDto>> = {};
  // Deals: prefer the board wired into the CRM (connect columns to other CRM boards), then the
  // oldest — a big ad-hoc import must not hijack the pipeline.
  const crmIds = new Set(all.filter((entry) => entry.row.kind !== 'deals').map((entry) => entry.row.id));
  const wired = new Map<string, number>();
  const dealColumnsById = new Map(
    await Promise.all(
      ofKind('deals').map(async (entry) => [entry.row.id, await loadBoardColumns(ctx, entry.row.id)] as const),
    ),
  );
  for (const [boardId, columns] of dealColumnsById) {
    wired.set(boardId, connectTargets(columns).filter((id) => crmIds.has(id)).length);
  }
  const deals = ofKind('deals').sort(
    (a, b) =>
      (wired.get(b.row.id) ?? 0) - (wired.get(a.row.id) ?? 0) ||
      Number(templateOf(b.row) === 'crm-deals') - Number(templateOf(a.row) === 'crm-deals') ||
      a.row.createdAt.getTime() - b.row.createdAt.getTime(),
  );
  const mainDeals = deals.find((entry) => entry.row.id === preferDealsBoardId) ?? deals[0];
  const linked = new Set<string>();
  if (mainDeals) {
    primary.deals = toRef(mainDeals.row, mainDeals.itemCount);
    for (const id of connectTargets(dealColumnsById.get(mainDeals.row.id) ?? [])) linked.add(id);
  }
  for (const kind of KINDS) {
    if (kind === 'deals') continue;
    const candidates = ofKind(kind);
    let choice = candidates.find((entry) => linked.has(entry.row.id));
    if (!choice && kind === 'activities' && mainDeals) {
      // Activities link *to* deals, so look for the activities board pointing at the main deals board.
      for (const entry of candidates) {
        if (connectTargets(await loadBoardColumns(ctx, entry.row.id)).includes(mainDeals.row.id)) {
          choice = entry;
          break;
        }
      }
    }
    choice = choice ?? candidates[0];
    if (choice) primary[kind] = toRef(choice.row, choice.itemCount);
  }
  return { primary, dealBoards: deals.map((entry) => toRef(entry.row, entry.itemCount)) };
}

export async function loadCrmBoard(ctx: ServiceContext, ref: CrmBoardRefDto | undefined): Promise<CrmBoard | null> {
  if (!ref) return null;
  const [row] = await ctx.db
    .select()
    .from(boards)
    .where(and(eq(boards.id, ref.id), eq(boards.orgId, ctx.orgId)))
    .limit(1);
  if (!row) return null;
  return { row, ref, columns: await loadBoardColumns(ctx, row.id) };
}

/** Live top-level items of a board (bounded), oldest group/position order. */
export async function loadBoardRows(ctx: ServiceContext, boardId: string): Promise<ItemRow[]> {
  const rows = await ctx.db
    .select({ item: items })
    .from(items)
    .innerJoin(groups, eq(groups.id, items.groupId))
    .where(
      and(
        eq(items.boardId, boardId),
        eq(items.orgId, ctx.orgId),
        isNull(items.parentItemId),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
        isNull(groups.deletedAt),
      ),
    )
    .orderBy(asc(groups.position), asc(items.position))
    .limit(MAX_CRM_ITEMS);
  return rows.map((entry) => entry.item);
}

/** Load specific items by id (org-scoped, live), keeping only the given boards. */
export async function loadItemsByIds(
  ctx: ServiceContext,
  ids: readonly string[],
  boardIds?: readonly string[],
): Promise<ItemRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.orgId, ctx.orgId), inArray(items.id, unique), isNull(items.deletedAt)));
  return boardIds ? rows.filter((row) => boardIds.includes(row.boardId)) : rows;
}

/** Org members (read-only map; cached for 30s since every CRM read needs it). */
export async function orgUsers(ctx: ServiceContext): Promise<ReadonlyMap<string, CrmUserDto>> {
  if (!canUseCrmCache(ctx)) return loadOrgUsers(ctx);
  return cachedCrm(ctx.orgId, 'users', 'v1', 30_000, () => loadOrgUsers(ctx));
}

async function loadOrgUsers(ctx: ServiceContext): Promise<Map<string, CrmUserDto>> {
  const rows = await ctx.db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name));
  return new Map(rows.map((row) => [row.id, row]));
}

export function crmSettings(board: BoardRow): CrmBoardSettings {
  const raw = (board.settings as { crm?: unknown }).crm;
  return raw && typeof raw === 'object' ? (raw as CrmBoardSettings) : {};
}

/** Merge a patch into `boards.settings.crm` without touching any other settings key. */
export async function saveCrmSettings(
  ctx: ServiceContext,
  boardId: string,
  patch: Partial<CrmBoardSettings>,
): Promise<CrmBoardSettings> {
  const [row] = await ctx.db
    .update(boards)
    .set({
      settings: sql`jsonb_set(coalesce(${boards.settings}, '{}'::jsonb), '{crm}', coalesce(${boards.settings} -> 'crm', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(and(eq(boards.id, boardId), eq(boards.orgId, ctx.orgId)))
    .returning();
  if (!row) throw new BadRequestError('Board not found');
  return crmSettings(row);
}

// ---------------------------------------------------------------------------------------------
// Column roles
// ---------------------------------------------------------------------------------------------

export function findColumn(
  columns: readonly ColumnRow[],
  keys: readonly string[],
  type?: ColumnRow['type'] | readonly ColumnRow['type'][],
): ColumnRow | undefined {
  const itemColumns = columns.filter((column) => column.scope === 'item');
  const types = type === undefined ? null : Array.isArray(type) ? type : [type];
  const typed = (column: ColumnRow) => !types || types.includes(column.type);
  for (const key of keys) {
    const hit = itemColumns.find((column) => column.key === key && typed(column));
    if (hit) return hit;
  }
  return types ? itemColumns.find(typed) : undefined;
}

/** connect_boards column on `columns` that points at `targetBoardId`. */
export function connectColumnTo(
  columns: readonly ColumnRow[],
  targetBoardId: string | undefined,
  preferredKeys: readonly string[] = [],
): ColumnRow | undefined {
  if (!targetBoardId) return undefined;
  const candidates = columns.filter(
    (column) =>
      column.scope === 'item' &&
      column.type === 'connect_boards' &&
      ((column.settings as { boardIds?: string[] }).boardIds ?? []).includes(targetBoardId),
  );
  return candidates.find((column) => preferredKeys.includes(column.key)) ?? candidates[0];
}

export function statusColumnFor(board: BoardRow, columns: readonly ColumnRow[], keys: readonly string[]) {
  const primaryKey = (board.settings as { primaryStatusColumnKey?: string }).primaryStatusColumnKey;
  return findColumn(columns, [...(primaryKey ? [primaryKey] : []), ...keys], 'status');
}

export function labelsOf(column: ColumnRow | undefined): StageLabelInput[] {
  const labels = (column?.settings as { labels?: StageLabelInput[] } | undefined)?.labels;
  return Array.isArray(labels) ? labels : [];
}

export function labelDto(column: ColumnRow | undefined, labelId: unknown): CrmLabelDto | null {
  if (typeof labelId !== 'string') return null;
  const label = labelsOf(column).find((entry) => entry.id === labelId);
  return label && !label.isDefault ? { id: label.id, name: label.name, color: label.color as LabelColor } : null;
}

// ---------------------------------------------------------------------------------------------
// Value readers (stored CellValue shapes)
// ---------------------------------------------------------------------------------------------

type Values = Record<string, unknown>;

export function readText(values: Values, column: ColumnRow | undefined): string | null {
  if (!column) return null;
  const value = values[column.key];
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['email', 'phone', 'url', 'address', 'text']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  return null;
}

export function readEmail(values: Values, column: ColumnRow | undefined): string | null {
  const value = column ? values[column.key] : undefined;
  return value && typeof value === 'object' && typeof (value as { email?: unknown }).email === 'string'
    ? (value as { email: string }).email
    : null;
}

export function readPhone(values: Values, column: ColumnRow | undefined): string | null {
  const value = column ? values[column.key] : undefined;
  return value && typeof value === 'object' && typeof (value as { phone?: unknown }).phone === 'string'
    ? (value as { phone: string }).phone
    : null;
}

export function readUrl(values: Values, column: ColumnRow | undefined): string | null {
  const value = column ? values[column.key] : undefined;
  return value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'
    ? (value as { url: string }).url
    : null;
}

export function readDomain(values: Values, column: ColumnRow | undefined): string | null {
  return domainFromUrl(readUrl(values, column));
}

export function readLabelId(values: Values, column: ColumnRow | undefined): string | null {
  const value = column ? values[column.key] : undefined;
  return value && typeof value === 'object' && typeof (value as { labelId?: unknown }).labelId === 'string'
    ? (value as { labelId: string }).labelId
    : null;
}

export function readLabelIds(values: Values, column: ColumnRow | undefined): string[] {
  const value = column ? values[column.key] : undefined;
  const ids = value && typeof value === 'object' ? (value as { labelIds?: unknown }).labelIds : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function readPeople(values: Values, column: ColumnRow | undefined): string[] {
  const value = column ? values[column.key] : undefined;
  const ids = value && typeof value === 'object' ? (value as { ids?: unknown }).ids : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function readConnect(values: Values, column: ColumnRow | undefined): string[] {
  const value = column ? values[column.key] : undefined;
  const ids = value && typeof value === 'object' ? (value as { itemIds?: unknown }).itemIds : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function readDate(values: Values, column: ColumnRow | undefined): string | null {
  const value = column ? values[column.key] : undefined;
  const date = value && typeof value === 'object' ? (value as { date?: unknown }).date : undefined;
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
}

export function readTime(values: Values, column: ColumnRow | undefined): string | null {
  const value = column ? values[column.key] : undefined;
  const time = value && typeof value === 'object' ? (value as { time?: unknown }).time : undefined;
  return typeof time === 'string' ? time : null;
}

export function readAmount(values: Values, column: ColumnRow | undefined): number {
  const value = column ? values[column.key] : undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const amount = value && typeof value === 'object' ? (value as { amount?: unknown }).amount : undefined;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}

export function readNumber(values: Values, column: ColumnRow | undefined): number | null {
  const value = column ? values[column.key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function currencyOf(column: ColumnRow | undefined): string {
  const currency = (column?.settings as { currency?: unknown } | undefined)?.currency;
  return typeof currency === 'string' && currency.length === 3 ? currency : 'USD';
}

/** Number of non-empty stored values (record completeness). */
export function filledFieldCount(values: Values): number {
  return Object.values(values).filter((value) => value !== null && value !== undefined && value !== '').length;
}
