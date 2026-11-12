/**
 * Server support for the cells module:
 *  - resolve linked item names for connect_boards cells (batch, org + visibility scoped)
 *  - board-wide label usage counts (delete-label warnings)
 *  - atomic "save labels + reassign cells of deleted labels" (one transaction, board-wide)
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { boards, columns, groups, items } from '@/server/db/schema';
import { labelSchema } from '@/server/db/schema/column-types';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { filterVisibleBoardIds, requireBoard } from './access';
import { logActivity, type ActivityInput } from './activity';
import { updateColumn } from './columns';
import { inTransaction, type ServiceContext } from './context';
import type { ColumnDto } from './contracts/dto';
import type { ItemEvent } from './item-events';
import { finishItemMutation } from './items';

export const MAX_LINKED_LOOKUP = 500;

export const linkedItemsInputSchema = z
  .object({ itemIds: z.array(z.uuid()).min(1).max(MAX_LINKED_LOOKUP) })
  .strict();

export interface LinkedItemNameDto {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly groupTitle: string | null;
}

/** Names of the given items the caller can see. Missing / forbidden ids are simply absent. */
export async function resolveLinkedItems(
  ctx: ServiceContext,
  itemIds: readonly string[],
): Promise<LinkedItemNameDto[]> {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return [];
  const rows = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      boardId: items.boardId,
      boardName: boards.name,
      groupTitle: groups.title,
    })
    .from(items)
    .innerJoin(boards, eq(boards.id, items.boardId))
    .leftJoin(groups, eq(groups.id, items.groupId))
    .where(and(inArray(items.id, unique), eq(items.orgId, ctx.orgId), isNull(items.deletedAt)));
  const visible = new Set(await filterVisibleBoardIds(ctx, [...new Set(rows.map((row) => row.boardId))]));
  return rows.filter((row) => visible.has(row.boardId));
}

async function requireLabelColumn(ctx: ServiceContext, boardId: string, columnId: string) {
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
  if (row.type !== 'status' && row.type !== 'dropdown') {
    throw new BadRequestError('Only status and dropdown columns have labels');
  }
  return row;
}

/** labelId → number of (non-deleted) board items using it, across the WHOLE board. */
export async function labelUsage(
  ctx: ServiceContext,
  boardId: string,
  columnId: string,
): Promise<Record<string, number>> {
  await requireBoard(ctx, boardId, 'read');
  const column = await requireLabelColumn(ctx, boardId, columnId);
  const key = column.key;
  const scope = and(eq(items.boardId, boardId), eq(items.orgId, ctx.orgId), isNull(items.deletedAt));
  const result =
    column.type === 'status'
      ? await ctx.db.execute(sql`
          select ${items.values} -> ${key}::text ->> 'labelId' as label_id, count(*)::int as n
          from ${items}
          where ${scope} and ${items.values} -> ${key}::text ->> 'labelId' is not null
          group by 1`)
      : await ctx.db.execute(sql`
          select e as label_id, count(*)::int as n
          from ${items}, jsonb_array_elements_text(coalesce(${items.values} -> ${key}::text -> 'labelIds', '[]'::jsonb)) as e
          where ${scope}
          group by 1`);
  const usage: Record<string, number> = {};
  for (const row of result.rows as { label_id: string; n: number }[]) usage[row.label_id] = Number(row.n);
  return usage;
}

export const saveLabelsInputSchema = z
  .object({
    labels: z
      .array(labelSchema)
      .min(1, 'Keep at least one label')
      .max(200)
      .superRefine((labels, issue) => {
        const seen = new Set<string>();
        const ids = new Set<string>();
        labels.forEach((label, index) => {
          if (ids.has(label.id)) issue.addIssue({ code: 'custom', message: 'Duplicate label id', path: [index, 'id'] });
          ids.add(label.id);
          const name = label.name.trim().toLowerCase();
          // The blank (default) label may stay unnamed; every other label needs a unique name.
          if (!name) {
            if (!label.isDefault) issue.addIssue({ code: 'custom', message: 'Label names cannot be empty', path: [index, 'name'] });
            return;
          }
          if (seen.has(name)) issue.addIssue({ code: 'custom', message: `Duplicate label name "${label.name.trim()}"`, path: [index, 'name'] });
          seen.add(name);
        });
        if (labels.filter((label) => label.isDone).length > 1) issue.addIssue({ code: 'custom', message: 'Only one label can be the Done label' });
      }),
    /** Deleted label id → replacement label id (null = clear those cells). */
    reassign: z
      .record(z.string().min(1).max(64), z.string().min(1).max(64).nullable())
      .refine((value) => Object.keys(value).length <= 200, 'Too many reassignments'),
  })
  .strict();
export type SaveLabelsInput = z.infer<typeof saveLabelsInputSchema>;

/**
 * Save a label list and move every board item off deleted labels in ONE transaction:
 * reassign first (board-wide UPDATE), then `updateColumn` clears whatever still points at a
 * removed label. Either everything lands or nothing does.
 */
export async function saveLabelsWithReassign(
  ctx: ServiceContext,
  boardId: string,
  columnId: string,
  input: SaveLabelsInput,
): Promise<ColumnDto> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, boardId, 'write');
    const column = await requireLabelColumn(tx, boardId, columnId);
    if (column.type === 'status' && !input.labels.some((label) => label.isDefault)) {
      throw new BadRequestError('A status column must keep its blank (default) label');
    }
    const key = column.key;
    const kept = new Set(input.labels.map((label) => label.id));
    const scope = and(eq(items.boardId, boardId), eq(items.orgId, tx.orgId), isNull(items.deletedAt));
    const activities: ActivityInput[] = [];
    const events: ItemEvent[] = [];
    const changedIds = new Set<string>();
    for (const [fromId, toId] of Object.entries(input.reassign)) {
      if (!toId || kept.has(fromId)) continue;
      if (!kept.has(toId)) throw new BadRequestError('Replacement label does not exist');
      const match =
        column.type === 'status'
          ? sql`${items.values} -> ${key}::text ->> 'labelId' = ${fromId}::text`
          : sql`(${items.values} -> ${key}::text -> 'labelIds') ? ${fromId}::text`;
      // Capture the old values (row-locked) so every moved item gets a real history entry.
      const before = await tx.db
        .select({ id: items.id, value: sql<unknown>`${items.values} -> ${key}::text` })
        .from(items)
        .where(and(scope, match))
        .for('update');
      if (before.length === 0) continue;
      const nextValue =
        column.type === 'status'
          ? sql`jsonb_build_object('labelId', ${toId}::text)`
          : // Replace fromId with toId, de-duplicate, keep first-seen order.
            sql`jsonb_build_object('labelIds', (
              select coalesce(jsonb_agg(g.x order by g.o), '[]'::jsonb) from (
                select x, min(o) as o from (
                  select case when e = ${fromId}::text then ${toId}::text else e end as x, o
                  from jsonb_array_elements_text(${items.values} -> ${key}::text -> 'labelIds') with ordinality as t(e, o)
                ) s group by x
              ) g))`;
      const after = await tx.db
        .update(items)
        .set({
          values: sql`jsonb_set(${items.values}, array[${key}::text], ${nextValue})`,
          updatedBy: tx.userId,
          updatedAt: new Date(),
        })
        .where(and(scope, match))
        .returning({ id: items.id, value: sql<unknown>`${items.values} -> ${key}::text` });
      const afterById = new Map(after.map((row) => [row.id, row.value]));
      for (const row of before) {
        const next = afterById.get(row.id);
        if (next === undefined) continue;
        changedIds.add(row.id);
        activities.push({ boardId, itemId: row.id, action: 'item.value_changed', columnKey: key, before: row.value, after: next });
        events.push({ type: 'column_changed', boardId, itemId: row.id, columnKey: key, columnType: column.type, before: row.value, after: next });
      }
    }
    const current = (column.settings ?? {}) as Record<string, unknown>;
    const saved = await updateColumn(tx, boardId, columnId, { settings: { ...current, labels: input.labels } });
    if (changedIds.size > 0) {
      await logActivity(tx, activities);
      // Same path as any cell edit: items.changed realtime event + automations ("when status
      // changes") run for reassigned items, exactly as if each had been changed by hand.
      await finishItemMutation(tx, board, [...changedIds], events);
    }
    return saved;
  });
}
