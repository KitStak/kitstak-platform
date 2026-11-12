/** Dashboards, widgets and widget data aggregation across boards. */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { boards, columns, dashboardWidgets, dashboards, groups, items, user } from '@/server/db/schema';
import type { Label } from '@/server/db/schema/cell-values';
import { NotFoundError } from '@/server/http/errors';
import { filterVisibleBoardIds, requireWorkspace } from './access';
import { cellToScalar } from './computed';
import { inTransaction, isOrgAdmin, type ServiceContext, concurrently } from './context';
import type {
  DashboardDto,
  DashboardWidgetDto,
  WidgetDataDto,
  WidgetDataPoint,
  WidgetType,
} from './contracts/dto';
import { hydrateMixedItems } from './item-reads';
import { toWidgetDto } from './mappers';
import { positionAfter } from './positions';
import { publishDashboardChanged } from './dashboards-realtime';

const WIDGET_TYPES = [
  'number',
  'chart',
  'battery',
  'table',
  'calendar',
  'timeline',
  'workload',
  'leaderboard',
  'funnel',
  'text',
] as const;

export const widgetConfigSchema = z
  .object({
    boardIds: z.array(z.uuid()).max(20).optional(),
    /** Column to group by (status / dropdown / people / any). Use `$group` for board groups, `$board` for boards. */
    groupByColumnKey: z.string().max(64).optional(),
    /** Numeric column to aggregate (number / currency / formula / rating). */
    valueColumnKey: z.string().max(64).optional(),
    aggregate: z.enum(['count', 'sum', 'average', 'median', 'min', 'max']).default('count'),
    chartType: z.enum(['bar', 'horizontal_bar', 'stacked_bar', 'line', 'pie', 'donut', 'area']).optional(),
    /** Only include items whose `groupByColumnKey` label is one of these. */
    includeLabelIds: z.array(z.string().max(64)).max(100).optional(),
    excludeLabelIds: z.array(z.string().max(64)).max(100).optional(),
    /** Row filter on a status column, independent of grouping (e.g. only "Won" deals). */
    filter: z
      .object({
        columnKey: z.string().max(64),
        labelIds: z.array(z.string().max(64)).max(100),
        exclude: z.boolean().default(false),
      })
      .optional(),
    text: z.string().max(10_000).optional(),
    prefix: z.string().max(10).optional(),
    suffix: z.string().max(10).optional(),
  })
  .catchall(z.unknown())
  // Cap the serialized size so free-form keys cannot bloat a widget row.
  .refine((config) => JSON.stringify(config).length <= 32_000, { message: 'Widget config must be under 32KB' });

export const createDashboardSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2_000).nullish(),
  workspaceId: z.uuid().nullish(),
  boardIds: z.array(z.uuid()).max(20).default([]),
});
export const updateDashboardSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2_000).nullish(),
  boardIds: z.array(z.uuid()).max(20).optional(),
});
const layout = {
  x: z.number().int().min(0).max(48),
  y: z.number().int().min(0).max(1_000),
  w: z.number().int().min(1).max(24),
  h: z.number().int().min(1).max(48),
};
export const createWidgetSchema = z.object({
  type: z.enum(WIDGET_TYPES),
  title: z.string().trim().min(1).max(255),
  config: widgetConfigSchema.default({ aggregate: 'count' }),
  x: layout.x.default(0),
  y: layout.y.default(0),
  w: layout.w.default(6),
  h: layout.h.default(4),
});
export const updateWidgetSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  config: widgetConfigSchema.optional(),
  x: layout.x.optional(),
  y: layout.y.optional(),
  w: layout.w.optional(),
  h: layout.h.optional(),
});
export type CreateDashboardInput = z.infer<typeof createDashboardSchema>;
export type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;
export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

type DashboardRow = typeof dashboards.$inferSelect;

async function requireDashboard(ctx: ServiceContext, dashboardId: string): Promise<DashboardRow> {
  const [row] = await ctx.db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId), isNull(dashboards.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Dashboard');
  // Private dashboards (config.privacy, set by the dashboards feature) are visible to their
  // creator and org admins only.
  const privacy = (row.config as { privacy?: unknown } | null)?.privacy;
  if (privacy === 'private' && row.createdBy !== ctx.userId && ctx.userId !== null && !isOrgAdmin(ctx)) {
    throw new NotFoundError('Dashboard');
  }
  if (row.workspaceId) {
    try {
      await requireWorkspace(ctx, row.workspaceId);
    } catch {
      throw new NotFoundError('Dashboard');
    }
  }
  return row;
}

async function toDashboardDto(ctx: ServiceContext, row: DashboardRow): Promise<DashboardDto> {
  const widgets = await ctx.db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, row.id))
    .orderBy(asc(dashboardWidgets.y), asc(dashboardWidgets.x));
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    position: row.position,
    description: row.description,
    config: row.config as Record<string, unknown>,
    createdBy: row.createdBy,
    widgets: widgets.map(toWidgetDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDashboards(ctx: ServiceContext, workspaceId?: string): Promise<DashboardDto[]> {
  const rows = await ctx.db
    .select()
    .from(dashboards)
    .where(
      and(
        eq(dashboards.orgId, ctx.orgId),
        isNull(dashboards.deletedAt),
        ...(workspaceId ? [eq(dashboards.workspaceId, workspaceId)] : []),
      ),
    )
    .orderBy(asc(dashboards.position));
  const out: DashboardDto[] = [];
  for (const row of rows) {
    try {
      out.push(await toDashboardDto(ctx, await requireDashboard(ctx, row.id)));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return out;
}

export async function getDashboard(ctx: ServiceContext, dashboardId: string): Promise<DashboardDto> {
  return toDashboardDto(ctx, await requireDashboard(ctx, dashboardId));
}

export async function createDashboard(
  ctx: ServiceContext,
  input: CreateDashboardInput,
): Promise<DashboardDto> {
  return inTransaction(ctx, async (tx) => {
    if (input.workspaceId) await requireWorkspace(tx, input.workspaceId);
    const boardIds = await filterVisibleBoardIds(tx, input.boardIds);
    const [last] = await tx.db
      .select({ position: dashboards.position })
      .from(dashboards)
      .where(eq(dashboards.orgId, tx.orgId))
      .orderBy(desc(dashboards.position))
      .limit(1);
    const [row] = await tx.db
      .insert(dashboards)
      .values({
        orgId: tx.orgId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        description: input.description ?? null,
        config: { boardIds },
        position: positionAfter(last?.position),
        createdBy: tx.userId,
      })
      .returning();
    if (!row) throw new Error('Dashboard insert returned no row');
    return toDashboardDto(tx, row);
  });
}

export async function updateDashboard(
  ctx: ServiceContext,
  dashboardId: string,
  input: UpdateDashboardInput,
): Promise<DashboardDto> {
  return inTransaction(ctx, async (tx) => {
    const existing = await requireDashboard(tx, dashboardId);
    const boardIds = input.boardIds ? await filterVisibleBoardIds(tx, input.boardIds) : undefined;
    const [row] = await tx.db
      .update(dashboards)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(boardIds && { config: { ...(existing.config as Record<string, unknown>), boardIds } }),
        updatedAt: new Date(),
      })
      .where(eq(dashboards.id, dashboardId))
      .returning();
    if (!row) throw new NotFoundError('Dashboard');
    await publishDashboardChanged(tx, dashboardId);
    return toDashboardDto(tx, row);
  });
}

export async function deleteDashboard(ctx: ServiceContext, dashboardId: string): Promise<{ id: string }> {
  await requireDashboard(ctx, dashboardId);
  await ctx.db.update(dashboards).set({ deletedAt: new Date() }).where(eq(dashboards.id, dashboardId));
  return { id: dashboardId };
}

export async function addWidget(
  ctx: ServiceContext,
  dashboardId: string,
  input: CreateWidgetInput,
): Promise<DashboardWidgetDto> {
  await requireDashboard(ctx, dashboardId);
  const [row] = await ctx.db
    .insert(dashboardWidgets)
    .values({
      orgId: ctx.orgId,
      dashboardId,
      type: input.type,
      title: input.title,
      config: input.config,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
    })
    .returning();
  if (!row) throw new Error('Widget insert returned no row');
  await publishDashboardChanged(ctx, dashboardId, [row.id]);
  return toWidgetDto(row);
}

async function requireWidget(ctx: ServiceContext, widgetId: string) {
  const [row] = await ctx.db
    .select()
    .from(dashboardWidgets)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.orgId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Widget');
  const dashboard = await requireDashboard(ctx, row.dashboardId);
  return { widget: row, dashboard };
}

export async function updateWidget(
  ctx: ServiceContext,
  widgetId: string,
  input: UpdateWidgetInput,
): Promise<DashboardWidgetDto> {
  const { dashboard } = await requireWidget(ctx, widgetId);
  const [row] = await ctx.db
    .update(dashboardWidgets)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(dashboardWidgets.id, widgetId))
    .returning();
  if (!row) throw new NotFoundError('Widget');
  await publishDashboardChanged(ctx, dashboard.id, [widgetId]);
  return toWidgetDto(row);
}

export async function deleteWidget(ctx: ServiceContext, widgetId: string): Promise<{ id: string }> {
  const { dashboard } = await requireWidget(ctx, widgetId);
  await ctx.db.delete(dashboardWidgets).where(eq(dashboardWidgets.id, widgetId));
  await publishDashboardChanged(ctx, dashboard.id, [widgetId]);
  return { id: widgetId };
}

// ---------------------------------------------------------------------------------------------
// Widget data
// ---------------------------------------------------------------------------------------------

const MAX_WIDGET_ITEMS = 10_000;

function aggregate(
  values: number[],
  fn: 'count' | 'sum' | 'average' | 'median' | 'min' | 'max',
  count: number,
): number {
  switch (fn) {
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length === 0) return 0;
      return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }
    case 'count':
      return count;
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0);
    case 'average':
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    case 'min':
      return values.length ? Math.min(...values) : 0;
    case 'max':
      return values.length ? Math.max(...values) : 0;
  }
}

export async function getWidgetData(ctx: ServiceContext, widgetId: string): Promise<WidgetDataDto> {
  const { widget, dashboard } = await requireWidget(ctx, widgetId);
  const config = widgetConfigSchema.parse(widget.config ?? {});
  const type = widget.type as WidgetType;
  if (type === 'text') return { widgetId, type, total: 0, series: [], itemCount: 0 };
  const requested = config.boardIds ?? (dashboard.config as { boardIds?: string[] }).boardIds ?? [];
  const boardIds = await filterVisibleBoardIds(ctx, requested);
  if (boardIds.length === 0) return { widgetId, type, total: 0, series: [], itemCount: 0 };

  const [rows, columnRows, groupRows, boardRows] = await concurrently(ctx, [
    () =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(
            inArray(items.boardId, boardIds),
            eq(items.orgId, ctx.orgId),
            isNull(items.deletedAt),
            isNull(items.archivedAt),
            isNull(items.parentItemId),
          ),
        )
        .limit(MAX_WIDGET_ITEMS),
    () =>
      ctx.db
        .select()
        .from(columns)
        .where(and(inArray(columns.boardId, boardIds), isNull(columns.deletedAt))),
    () =>
      ctx.db
        .select()
        .from(groups)
        .where(and(inArray(groups.boardId, boardIds), isNull(groups.deletedAt))),
    () =>
      ctx.db.select({ id: boards.id, name: boards.name }).from(boards).where(inArray(boards.id, boardIds)),
  ]);
  const liveGroups = new Map(
    groupRows.filter((group) => group.archivedAt === null).map((group) => [group.id, group]),
  );
  const liveItems = rows.filter((row) => liveGroups.has(row.groupId));

  // Formula / mirror values need hydration; plain numeric columns read stored values directly.
  const valueColumnTypes = new Set(
    columnRows.filter((column) => column.key === config.valueColumnKey).map((column) => column.type),
  );
  const needsComputed = valueColumnTypes.has('formula') || valueColumnTypes.has('mirror');
  const computed = needsComputed
    ? new Map((await hydrateMixedItems(ctx, liveItems)).map((dto) => [dto.id, dto.computed]))
    : null;

  const columnFor = (boardId: string, key: string | undefined) =>
    key ? columnRows.find((column) => column.boardId === boardId && column.key === key) : undefined;

  const numberOf = (row: (typeof liveItems)[number]): number | null => {
    if (!config.valueColumnKey) return null;
    const column = columnFor(row.boardId, config.valueColumnKey);
    if (!column) return null;
    if (column.type === 'formula') {
      const result = (computed?.get(row.id)?.[column.key] as { result?: unknown } | undefined)?.result;
      return typeof result === 'number' ? result : null;
    }
    if (column.type === 'mirror') {
      const values =
        (computed?.get(row.id)?.[column.key] as { values?: unknown[] } | undefined)?.values ?? [];
      return values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
    }
    const scalar = cellToScalar(column, row.values[column.key]);
    return typeof scalar === 'number' ? scalar : null;
  };

  const buckets = new Map<
    string,
    { label: string; color?: string; order: number; values: number[]; count: number }
  >();
  const userIds = new Set<string>();
  const bucket = (key: string, label: string, order: number, color?: string) => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = { label, color, order, values: [] as number[], count: 0 };
    buckets.set(key, created);
    return created;
  };

  let included = 0;
  const allValues: number[] = [];
  const passesFilter = (row: (typeof liveItems)[number]): boolean => {
    if (!config.filter) return true;
    const labelId =
      (row.values[config.filter.columnKey] as { labelId?: string } | undefined)?.labelId ?? 'default';
    const hit = config.filter.labelIds.includes(labelId);
    return config.filter.exclude ? !hit : hit;
  };
  for (const row of liveItems) {
    if (!passesFilter(row)) continue;
    const value = numberOf(row);
    const keys: { key: string; label: string; order: number; color?: string }[] = [];
    const groupKey = config.groupByColumnKey;
    if (groupKey === '$group') {
      const group = liveGroups.get(row.groupId);
      keys.push({ key: row.groupId, label: group?.title ?? 'Group', order: 0, color: group?.color });
    } else if (groupKey === '$board') {
      keys.push({
        key: row.boardId,
        label: boardRows.find((board) => board.id === row.boardId)?.name ?? 'Board',
        order: 0,
      });
    } else if (groupKey) {
      const column = columnFor(row.boardId, groupKey);
      const raw = column ? row.values[column.key] : undefined;
      if (column?.type === 'status' || column?.type === 'dropdown') {
        const labels = ((column.settings as { labels?: Label[] }).labels ?? []) as Label[];
        const ids =
          column.type === 'status'
            ? [(raw as { labelId?: string } | undefined)?.labelId ?? 'default']
            : ((raw as { labelIds?: string[] } | undefined)?.labelIds ?? []);
        for (const id of ids) {
          const label = labels.find((entry) => entry.id === id);
          keys.push({
            key: id,
            label: label?.name || 'Blank',
            order: label?.position ?? 999,
            color: label?.color ?? 'gray',
          });
        }
      } else if (column?.type === 'people') {
        const ids = (raw as { ids?: string[] } | undefined)?.ids ?? [];
        if (ids.length === 0) keys.push({ key: 'unassigned', label: 'Unassigned', order: 9_999 });
        for (const id of ids) {
          userIds.add(id);
          keys.push({ key: id, label: id, order: 0 });
        }
      } else if (column) {
        const scalar = cellToScalar(column, raw);
        const label = scalar === null || scalar === '' ? 'Blank' : String(scalar);
        keys.push({ key: label, label, order: 0 });
      }
    }
    if (
      groupKey &&
      config.includeLabelIds &&
      !keys.some((entry) => config.includeLabelIds?.includes(entry.key))
    )
      continue;
    if (
      groupKey &&
      config.excludeLabelIds &&
      keys.some((entry) => config.excludeLabelIds?.includes(entry.key))
    )
      continue;
    included += 1;
    if (value !== null) allValues.push(value);
    for (const entry of keys) {
      const target = bucket(entry.key, entry.label, entry.order, entry.color);
      target.count += 1;
      if (value !== null) target.values.push(value);
    }
  }

  if (userIds.size > 0) {
    const people = await ctx.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...userIds]));
    for (const person of people) {
      const entry = buckets.get(person.id);
      if (entry) entry.label = person.name;
    }
  }

  let series: WidgetDataPoint[] = [...buckets.entries()].map(([key, entry]) => ({
    key,
    label: entry.label,
    value: Math.round(aggregate(entry.values, config.aggregate, entry.count) * 100) / 100,
    count: entry.count,
    ...(entry.color ? { color: entry.color } : {}),
  }));
  const orderOf = (key: string) => buckets.get(key)?.order ?? 0;
  series =
    type === 'leaderboard' || type === 'workload'
      ? series.sort((a, b) => b.value - a.value)
      : series.sort((a, b) => orderOf(a.key) - orderOf(b.key) || b.value - a.value);

  const total = Math.round(aggregate(allValues, config.aggregate, included) * 100) / 100;
  const result: WidgetDataDto = { widgetId, type, total, series, itemCount: included };
  if (type === 'table' || type === 'calendar' || type === 'timeline') {
    return { ...result, rows: await hydrateMixedItems(ctx, liveItems.slice(0, 200)) };
  }
  return result;
}
