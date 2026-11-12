/** Board columns: add / rename / reorder / resize / hide / settings (labels) / type change / delete. */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { columns, itemLinks, items } from '@/server/db/schema';
import {
  safeParseColumnSettings,
  validateCellValue,
  type ColumnType,
  type Label,
  type StoredCellValue,
} from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { filterVisibleBoardIds, requireBoard } from './access';
import { logActivity } from './activity';
import { inTransaction, type ServiceContext } from './context';
import type { ColumnDto } from './contracts/dto';
import type { CreateColumnInput, UpdateColumnInput } from './contracts/structure-inputs';
import { validateFormula } from './formula';
import { loadBoardColumns } from './item-reads';
import { toColumnDto } from './mappers';
import { resolveMovePosition } from './positions';

const keySuffix = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 5);

function slugKey(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .slice(0, 32);
  return slug.length > 0 ? slug : 'column';
}

async function validateSettings(
  ctx: ServiceContext,
  type: ColumnType,
  settings: unknown,
): Promise<Record<string, unknown>> {
  const result = safeParseColumnSettings(type, settings ?? {});
  if (!result.ok) throw new ValidationError([{ path: 'settings', message: result.message }]);
  const parsed = result.settings as Record<string, unknown>;
  if (type === 'formula') {
    const check = validateFormula(String(parsed.expression ?? ''));
    if (!check.ok) throw new ValidationError([{ path: 'settings.expression', message: check.message }]);
  }
  if (type === 'connect_boards') {
    const boardIds = (parsed.boardIds as string[] | undefined) ?? [];
    const visible = await filterVisibleBoardIds(ctx, boardIds);
    if (visible.length !== new Set(boardIds).size) {
      throw new ValidationError([
        { path: 'settings.boardIds', message: 'Connected boards must exist and be visible to you' },
      ]);
    }
  }
  return parsed;
}

function publishColumns(ctx: ServiceContext, boardId: string, ids: string[]) {
  return publish(ctx.db, { type: 'columns.changed', orgId: ctx.orgId, boardId, ids, actorId: ctx.userId });
}

export async function listColumns(ctx: ServiceContext, boardId: string): Promise<ColumnDto[]> {
  await requireBoard(ctx, boardId, 'read');
  return (await loadBoardColumns(ctx, boardId)).map(toColumnDto);
}

export async function createColumn(
  ctx: ServiceContext,
  boardId: string,
  input: CreateColumnInput,
): Promise<ColumnDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const existing = await tx.db
      .select({
        id: columns.id,
        key: columns.key,
        type: columns.type,
        position: columns.position,
        scope: columns.scope,
        deletedAt: columns.deletedAt,
      })
      .from(columns)
      .where(and(eq(columns.boardId, boardId), eq(columns.orgId, tx.orgId)))
      .orderBy(asc(columns.position));
    const definition = COLUMN_TYPE_REGISTRY[input.type];
    if (
      definition.unique &&
      existing.some((column) => column.type === input.type && column.deletedAt === null)
    ) {
      throw new ConflictError(`A board can only have one "${definition.label}" column`);
    }
    const takenKeys = new Set(existing.map((column) => column.key));
    let key = input.key ?? slugKey(input.title);
    if (takenKeys.has(key)) {
      if (input.key) throw new ConflictError('A column with this key already exists');
      key = `${key}_${keySuffix()}`;
    }
    const settings = await validateSettings(tx, input.type, input.settings ?? definition.defaultSettings());
    const siblings = existing.filter((column) => column.scope === input.scope && column.deletedAt === null);
    const position = resolveMovePosition(siblings, input);
    const [row] = await tx.db
      .insert(columns)
      .values({
        orgId: tx.orgId,
        boardId,
        key,
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        scope: input.scope,
        settings: settings as never,
        width: input.width ?? definition.defaultWidth,
        position,
        hidden: input.hidden,
        createdBy: tx.userId,
      })
      .returning();
    if (!row) throw new Error('Column insert returned no row');
    await logActivity(tx, {
      boardId,
      action: 'column.created',
      columnKey: key,
      after: { title: row.title, type: row.type },
    });
    await publishColumns(tx, boardId, [row.id]);
    return toColumnDto(row);
  });
}

async function requireColumn(ctx: ServiceContext, boardId: string, columnId: string) {
  const [row] = await ctx.db
    .select()
    .from(columns)
    .where(
      and(
        eq(columns.id, columnId),
        eq(columns.boardId, boardId),
        eq(columns.orgId, ctx.orgId),
        isNull(columns.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Column');
  return row;
}

/** Remove cell values that reference labels that no longer exist. */
async function clearRemovedLabels(
  ctx: ServiceContext,
  boardId: string,
  key: string,
  type: ColumnType,
  before: unknown,
  after: unknown,
) {
  const ids = (settings: unknown) =>
    new Set(((settings as { labels?: Label[] } | null)?.labels ?? []).map((label) => label.id));
  const kept = ids(after);
  const removed = [...ids(before)].filter((id) => !kept.has(id));
  if (removed.length === 0) return;
  if (type === 'status') {
    await ctx.db
      .update(items)
      .set({ values: sql`${items.values} - ${key}::text` })
      .where(
        and(
          eq(items.boardId, boardId),
          sql`(${items.values} -> ${key}::text ->> 'labelId') in ${removed}`,
        ),
      );
  } else {
    const rows = await ctx.db
      .select({ id: items.id, values: items.values })
      .from(items)
      .where(and(eq(items.boardId, boardId), sql`${items.values} ? ${key}::text`));
    for (const row of rows) {
      const current = (row.values[key] as { labelIds?: string[] } | undefined)?.labelIds ?? [];
      const next = current.filter((id) => kept.has(id));
      if (next.length === current.length) continue;
      const values: Record<string, StoredCellValue> = { ...row.values };
      if (next.length === 0) delete values[key];
      else values[key] = { labelIds: next };
      await ctx.db.update(items).set({ values }).where(eq(items.id, row.id));
    }
  }
}

/** Best-effort conversion of a stored value between column types (null = drop). */
export function convertValue(from: ColumnType, to: ColumnType, value: unknown): StoredCellValue | null {
  if (value === null || value === undefined) return null;
  const asText = (): string | null => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const record = value as Record<string, unknown>;
    for (const field of ['email', 'phone', 'url', 'address', 'date', 'code']) {
      if (typeof record[field] === 'string') return record[field] as string;
    }
    if (typeof record.amount === 'number') return String(record.amount);
    return null;
  };
  let candidate: unknown = null;
  switch (to) {
    case 'text':
      candidate = asText()?.slice(0, 2_000) ?? null;
      break;
    case 'long_text':
      candidate = asText();
      break;
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(asText());
      candidate = Number.isFinite(numeric) ? numeric : null;
      break;
    }
    case 'currency': {
      const numeric = typeof value === 'number' ? value : Number(asText());
      candidate = Number.isFinite(numeric) ? { amount: numeric, currency: 'USD' } : null;
      break;
    }
    case 'email':
      candidate = { email: asText() };
      break;
    case 'link':
      candidate = { url: asText() };
      break;
    case 'tags': {
      const text = asText();
      candidate = text
        ? {
            tags: text
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
              .slice(0, 100),
          }
        : null;
      break;
    }
    default:
      candidate = from === to ? value : null;
  }
  if (candidate === null) return null;
  const result = validateCellValue(to, candidate);
  return result.ok ? result.value : null;
}

async function convertColumnValues(
  ctx: ServiceContext,
  boardId: string,
  key: string,
  from: ColumnType,
  to: ColumnType,
) {
  const rows = await ctx.db
    .select({ id: items.id, values: items.values })
    .from(items)
    .where(and(eq(items.boardId, boardId), sql`${items.values} ? ${key}::text`));
  for (const row of rows) {
    const converted = convertValue(from, to, row.values[key]);
    const values: Record<string, StoredCellValue> = { ...row.values };
    if (converted === null) delete values[key];
    else values[key] = converted;
    await ctx.db.update(items).set({ values }).where(eq(items.id, row.id));
  }
  if (from === 'connect_boards') {
    await ctx.db
      .delete(itemLinks)
      .where(
        and(
          eq(itemLinks.orgId, ctx.orgId),
          eq(itemLinks.columnKey, key),
          sql`${itemLinks.fromItemId} in (select id from ${items} where board_id = ${boardId})`,
        ),
      );
  }
}

export async function updateColumn(
  ctx: ServiceContext,
  boardId: string,
  columnId: string,
  input: UpdateColumnInput,
): Promise<ColumnDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const column = await requireColumn(tx, boardId, columnId);
    if (input.type && input.type !== column.type) {
      if (column.type === 'name') throw new BadRequestError('The name column type cannot be changed');
      if (COLUMN_TYPE_REGISTRY[input.type].unique)
        throw new BadRequestError('Cannot convert to a unique column type');
    }
    const nextType = input.type ?? column.type;
    let settings: Record<string, unknown> | undefined;
    if (input.settings !== undefined || nextType !== column.type) {
      const source =
        input.settings ??
        (nextType === column.type ? column.settings : COLUMN_TYPE_REGISTRY[nextType].defaultSettings());
      settings = await validateSettings(tx, nextType, source);
    }
    let position: string | undefined;
    if (input.afterId || input.beforeId) {
      const siblings = await tx.db
        .select({ id: columns.id, position: columns.position })
        .from(columns)
        .where(and(eq(columns.boardId, boardId), eq(columns.scope, column.scope), isNull(columns.deletedAt)));
      position = resolveMovePosition(
        siblings.filter((entry) => entry.id !== columnId),
        input,
      );
    }
    if (nextType !== column.type) await convertColumnValues(tx, boardId, column.key, column.type, nextType);
    else if (settings && (column.type === 'status' || column.type === 'dropdown')) {
      await clearRemovedLabels(tx, boardId, column.key, column.type, column.settings, settings);
    }
    const [row] = await tx.db
      .update(columns)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.width !== undefined && { width: input.width }),
        ...(input.hidden !== undefined && { hidden: input.hidden }),
        ...(input.required !== undefined && { required: input.required }),
        ...(settings && { settings: settings as never }),
        ...(nextType !== column.type && { type: nextType }),
        ...(position && { position }),
        updatedAt: new Date(),
      })
      .where(eq(columns.id, columnId))
      .returning();
    if (!row) throw new NotFoundError('Column');
    const structural = input.title !== undefined || settings !== undefined || nextType !== column.type;
    if (structural) {
      await logActivity(tx, {
        boardId,
        action:
          nextType !== column.type
            ? 'column.type_changed'
            : input.title !== undefined
              ? 'column.renamed'
              : 'column.settings_changed',
        columnKey: column.key,
        before: { title: column.title, type: column.type },
        after: { title: row.title, type: row.type },
      });
    }
    await publishColumns(tx, boardId, [row.id]);
    return toColumnDto(row);
  });
}

export async function deleteColumn(
  ctx: ServiceContext,
  boardId: string,
  columnId: string,
): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const column = await requireColumn(tx, boardId, columnId);
    if (column.type === 'name') throw new BadRequestError('The name column cannot be deleted');
    await tx.db.update(columns).set({ deletedAt: new Date() }).where(eq(columns.id, columnId));
    if (column.type === 'connect_boards') {
      await tx.db
        .delete(itemLinks)
        .where(
          and(
            eq(itemLinks.orgId, tx.orgId),
            eq(itemLinks.columnKey, column.key),
            sql`${itemLinks.fromItemId} in (select id from ${items} where board_id = ${boardId})`,
          ),
        );
    }
    await logActivity(tx, {
      boardId,
      action: 'column.deleted',
      columnKey: column.key,
      before: { title: column.title, type: column.type },
    });
    await publishColumns(tx, boardId, [columnId]);
    return { id: columnId };
  });
}

/** Undo a column delete (values are retained while soft-deleted). */
export async function restoreColumn(
  ctx: ServiceContext,
  boardId: string,
  columnId: string,
): Promise<ColumnDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const [row] = await tx.db
      .update(columns)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(columns.id, columnId), eq(columns.boardId, boardId), eq(columns.orgId, tx.orgId)))
      .returning();
    if (!row) throw new NotFoundError('Column');
    await logActivity(tx, {
      boardId,
      action: 'column.restored',
      columnKey: row.key,
      after: { title: row.title },
    });
    await publishColumns(tx, boardId, [row.id]);
    return toColumnDto(row);
  });
}
