/**
 * Dashboard studio service: widget insights (with dashboard-level filters), data sources for the
 * widget wizard, batch layout saves, dashboard settings, creation flow, duplicate and restore.
 * Builds on `dashboards.ts` (CRUD) and the pure builders in `dashboards-insights-builders.ts`.
 */
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { boards, columns, dashboardWidgets, dashboards, groups, items } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { requireWorkspace, visibleBoardsPredicate } from './access';
import { listOrgUsers } from './boards';
import { concurrently, inTransaction, isOrgAdmin, type ServiceContext } from './context';
import type { DashboardDto, ItemDto } from './contracts/dto';
import {
  createDashboardFlowSchema,
  parseWidgetSettings,
  widgetKindOf,
  type CreateDashboardFlowInput,
  type DashboardSettings,
  type DashboardSourcesDto,
  type InsightBatchDto,
  type InsightBatchResult,
  type InsightDto,
  type InsightFilters,
  type LayoutUpdateInput,
  type WidgetKind,
  type WidgetSettings,
} from './contracts/dashboard-insights';
import { createDashboard, getDashboard } from './dashboards';
import { computeInsight } from './dashboards-insights-builders';
import { publishDashboardChanged } from './dashboards-realtime';
import type { InsightDataset } from './dashboards-insights-core';
import { hydrateMixedItems } from './item-reads';
import { toColumnDto } from './mappers';
import { starterWidgets } from './dashboards-insights-starter';
import { DatasetCache } from './dashboards-insights-cache';

/** Upper bound of items one dataset load reads. */
const MAX_DATASET_ITEMS = 10_000;
const COMPUTED_TYPES = new Set(['formula', 'mirror', 'progress']);

/** Columns a widget reads numerically or by date; computed ones need hydration. */
function needsHydration(kind: WidgetKind, settings: WidgetSettings, columnRows: readonly { key: string; type: string }[]): boolean {
  if (kind === 'table' || kind === 'calendar' || kind === 'timeline') return true;
  const used = [settings.valueColumnKey, settings.probabilityColumnKey].filter(Boolean);
  return columnRows.some((column) => used.includes(column.key) && COMPUTED_TYPES.has(column.type));
}

type ItemRow = typeof items.$inferSelect;

function toPlainItem(row: ItemRow): ItemDto {
  return {
    id: row.id,
    boardId: row.boardId,
    groupId: row.groupId,
    parentItemId: row.parentItemId,
    name: row.name,
    position: row.position,
    values: row.values,
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as ItemDto;
}

async function loadDataset(
  ctx: ServiceContext,
  boardIds: readonly string[],
  hydrate: (columnRows: readonly { key: string; type: string }[]) => boolean,
): Promise<InsightDataset> {
  const visible = boardIds.length
    ? await ctx.db
        .select({ id: boards.id, name: boards.name })
        .from(boards)
        .where(and(inArray(boards.id, [...boardIds]), visibleBoardsPredicate(ctx)))
    : [];
  if (visible.length === 0) return { boards: [], columns: [], groups: [], items: [], users: [] };
  const ids = visible.map((board) => board.id);
  const [itemRows, columnRows, groupRows, users] = await concurrently(ctx, [
    () =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(
            inArray(items.boardId, ids),
            eq(items.orgId, ctx.orgId),
            isNull(items.deletedAt),
            isNull(items.archivedAt),
            isNull(items.parentItemId),
          ),
        )
        .orderBy(asc(items.position))
        .limit(MAX_DATASET_ITEMS),
    () =>
      ctx.db
        .select()
        .from(columns)
        .where(and(inArray(columns.boardId, ids), isNull(columns.deletedAt)))
        .orderBy(asc(columns.position)),
    () =>
      ctx.db
        .select()
        .from(groups)
        .where(and(inArray(groups.boardId, ids), isNull(groups.deletedAt), isNull(groups.archivedAt)))
        .orderBy(asc(groups.position)),
    () => listOrgUsers(ctx),
  ]);
  const liveGroups = new Set(groupRows.map((group) => group.id));
  const liveRows = itemRows.filter((row) => liveGroups.has(row.groupId));
  const hydrated = hydrate(columnRows) ? await hydrateMixedItems(ctx, liveRows) : liveRows.map(toPlainItem);
  const order = new Map(ids.map((id, index) => [id, boardIds.indexOf(id) >= 0 ? boardIds.indexOf(id) : index]));
  return {
    boards: [...visible].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    columns: columnRows.filter((column) => column.scope === 'item').map(toColumnDto),
    groups: groupRows.map((group) => ({ id: group.id, boardId: group.boardId, title: group.title, color: group.color })),
    items: hydrated,
    users,
  };
}

const EMPTY_DATASET: InsightDataset = { boards: [], columns: [], groups: [], items: [], users: [] };
const datasetCache = new DatasetCache<InsightDataset>();

type WidgetShape = { type: DashboardDto['widgets'][number]['type']; config: Record<string, unknown> };

interface PlannedWidget {
  readonly kind: WidgetKind;
  readonly settings: WidgetSettings;
  readonly boardIds: readonly string[];
}

function planWidget(dashboard: DashboardDto, widget: WidgetShape): PlannedWidget {
  const settings = parseWidgetSettings(widget.config);
  const kind = widgetKindOf(widget.type, widget.config);
  const dashboardBoards = ((dashboard.config as { boardIds?: string[] }).boardIds ?? []).filter(
    (id): id is string => typeof id === 'string',
  );
  const boardIds = settings.boardIds && settings.boardIds.length > 0 ? settings.boardIds : dashboardBoards;
  return { kind, settings, boardIds };
}

const isStatic = (kind: WidgetKind) => kind === 'text' || kind === 'countdown' || kind === 'section';
const boardSetKey = (boardIds: readonly string[]) => [...boardIds].sort().join(',');

/** Resolve the `me` person token to the caller. */
function resolveFilters(ctx: ServiceContext, filters: InsightFilters): InsightFilters {
  if (!filters.personIds.includes('me')) return filters;
  const personIds = filters.personIds.flatMap((id) => (id === 'me' ? (ctx.userId ? [ctx.userId] : []) : [id]));
  return { ...filters, personIds: [...new Set(personIds)] };
}

/** Cached dataset for a board set; a hydrated load also serves non-hydrated requests. */
function cachedDataset(
  ctx: ServiceContext,
  boardIds: readonly string[],
  hydrated: boolean,
  fresh: boolean,
): Promise<InsightDataset> {
  if (boardIds.length === 0) return Promise.resolve(EMPTY_DATASET);
  return datasetCache.get(
    { orgId: ctx.orgId, userId: ctx.userId, boardIds, hydrated },
    () => loadDataset(ctx, boardIds, () => hydrated),
    { fresh },
  );
}

/** Whether any widget reads computed columns (column types only, a cheap query). */
async function wantsHydration(ctx: ServiceContext, plans: readonly PlannedWidget[]): Promise<boolean> {
  if (plans.some((plan) => plan.kind === 'table' || plan.kind === 'calendar' || plan.kind === 'timeline')) return true;
  const used = new Set(
    plans.flatMap((plan) => [plan.settings.valueColumnKey, plan.settings.probabilityColumnKey]).filter(Boolean),
  );
  if (used.size === 0) return false;
  const boardIds = [...new Set(plans.flatMap((plan) => plan.boardIds))];
  if (boardIds.length === 0) return false;
  const columnRows = await ctx.db
    .select({ key: columns.key, type: columns.type })
    .from(columns)
    .where(and(inArray(columns.boardId, boardIds), eq(columns.orgId, ctx.orgId), isNull(columns.deletedAt)));
  return plans.some((plan) => needsHydration(plan.kind, plan.settings, columnRows));
}

export async function queryWidgetInsight(
  ctx: ServiceContext,
  dashboardId: string,
  input: { widget: WidgetShape; filters: InsightFilters },
): Promise<InsightDto> {
  const dashboard = await getDashboard(ctx, dashboardId);
  const plan = planWidget(dashboard, input.widget);
  const dataset = isStatic(plan.kind)
    ? EMPTY_DATASET
    : await cachedDataset(ctx, plan.boardIds, await wantsHydration(ctx, [plan]), false);
  return computeInsight({
    kind: plan.kind,
    settings: plan.settings,
    filters: resolveFilters(ctx, input.filters),
    dataset,
    now: new Date(),
  });
}

/**
 * Batched widget data: one dashboard read, one dataset load per distinct board set, then every
 * widget is computed in memory. A failing widget does not fail the batch.
 */
export async function queryWidgetInsights(
  ctx: ServiceContext,
  dashboardId: string,
  input: { widgets: readonly (WidgetShape & { key: string })[]; filters: InsightFilters; fresh?: boolean },
): Promise<InsightBatchDto> {
  const dashboard = await getDashboard(ctx, dashboardId);
  const filters = resolveFilters(ctx, input.filters);
  const plans = input.widgets.map((widget) => ({ key: widget.key, plan: planWidget(dashboard, widget) }));
  const byBoards = new Map<string, PlannedWidget[]>();
  for (const { plan } of plans) {
    if (isStatic(plan.kind) || plan.boardIds.length === 0) continue;
    const setKey = boardSetKey(plan.boardIds);
    byBoards.set(setKey, [...(byBoards.get(setKey) ?? []), plan]);
  }
  const loaded = await Promise.all(
    [...byBoards.entries()].map(async ([setKey, group]) => {
      const hydrated = await wantsHydration(ctx, group);
      const dataset = await cachedDataset(ctx, group[0]!.boardIds, hydrated, input.fresh ?? false);
      return [setKey, dataset] as const;
    }),
  );
  const datasets = new Map(loaded);
  const now = new Date();
  const results: Record<string, InsightBatchResult> = {};
  for (const { key, plan } of plans) {
    try {
      const dataset = isStatic(plan.kind) ? EMPTY_DATASET : (datasets.get(boardSetKey(plan.boardIds)) ?? EMPTY_DATASET);
      results[key] = { ok: true, data: computeInsight({ kind: plan.kind, settings: plan.settings, filters, dataset, now }) };
    } catch (error) {
      results[key] = { ok: false, error: error instanceof Error ? error.message : 'Could not compute this widget' };
    }
  }
  return { results };
}

/** Boards (with columns and groups) the caller can pick as widget sources. */
export async function listDashboardSources(ctx: ServiceContext): Promise<DashboardSourcesDto> {
  const boardRows = await ctx.db
    .select()
    .from(boards)
    .where(and(visibleBoardsPredicate(ctx), isNull(boards.archivedAt)))
    .orderBy(asc(boards.position));
  if (boardRows.length === 0) return { boards: [], users: await listOrgUsers(ctx) };
  const ids = boardRows.map((board) => board.id);
  const [columnRows, groupRows, users] = await concurrently(ctx, [
    () =>
      ctx.db
        .select()
        .from(columns)
        .where(and(inArray(columns.boardId, ids), isNull(columns.deletedAt), eq(columns.scope, 'item')))
        .orderBy(asc(columns.position)),
    () =>
      ctx.db
        .select()
        .from(groups)
        .where(and(inArray(groups.boardId, ids), isNull(groups.deletedAt), isNull(groups.archivedAt)))
        .orderBy(asc(groups.position)),
    () => listOrgUsers(ctx),
  ]);
  return {
    boards: boardRows.map((board) => ({
      id: board.id,
      name: board.name,
      kind: board.kind,
      workspaceId: board.workspaceId,
      itemTerminology: board.itemTerminology,
      columns: columnRows.filter((column) => column.boardId === board.id).map(toColumnDto),
      groups: groupRows
        .filter((group) => group.boardId === board.id)
        .map((group) => ({ id: group.id, title: group.title, color: group.color })),
    })),
    users,
  };
}

export async function saveDashboardLayout(
  ctx: ServiceContext,
  dashboardId: string,
  input: LayoutUpdateInput,
): Promise<DashboardDto> {
  await getDashboard(ctx, dashboardId);
  return inTransaction(ctx, async (tx) => {
    let updated = 0;
    for (const widget of input.widgets) {
      const rows = await tx.db
        .update(dashboardWidgets)
        .set({ x: widget.x, y: widget.y, w: widget.w, h: widget.h, updatedAt: new Date() })
        .where(
          and(
            eq(dashboardWidgets.id, widget.id),
            eq(dashboardWidgets.dashboardId, dashboardId),
            eq(dashboardWidgets.orgId, tx.orgId),
          ),
        )
        .returning({ id: dashboardWidgets.id });
      updated += rows.length;
    }
    // Every widget must belong to this dashboard; otherwise the whole batch rolls back.
    if (updated !== input.widgets.length) throw new NotFoundError('Widget');
    await publishDashboardChanged(tx, dashboardId, input.widgets.map((widget) => widget.id));
    return getDashboard(tx, dashboardId);
  });
}

export async function updateDashboardSettings(
  ctx: ServiceContext,
  dashboardId: string,
  settings: DashboardSettings,
): Promise<DashboardDto> {
  const existing = await getDashboard(ctx, dashboardId);
  const clean = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
  await ctx.db
    .update(dashboards)
    .set({ config: { ...existing.config, ...clean }, updatedAt: new Date() })
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId)));
  await publishDashboardChanged(ctx, dashboardId);
  return getDashboard(ctx, dashboardId);
}

export async function createDashboardFlow(ctx: ServiceContext, raw: CreateDashboardFlowInput): Promise<DashboardDto> {
  const input = createDashboardFlowSchema.parse(raw);
  return inTransaction(ctx, async (tx) => {
    const created = await createDashboard(tx, {
      name: input.name,
      description: input.description,
      workspaceId: input.workspaceId,
      boardIds: input.boardIds,
    });
    await tx.db
      .update(dashboards)
      .set({ config: { ...created.config, privacy: input.privacy, autoIncludeBoards: true } })
      .where(eq(dashboards.id, created.id));
    if (input.starter === 'sales') {
      const sources = await listDashboardSources(tx);
      const widgets = starterWidgets(sources.boards.filter((board) => input.boardIds.includes(board.id)));
      if (widgets.length > 0) {
        await tx.db.insert(dashboardWidgets).values(
          widgets.map((widget) => ({ ...widget, orgId: tx.orgId, dashboardId: created.id })),
        );
      }
    }
    return getDashboard(tx, created.id);
  });
}

export async function duplicateDashboard(
  ctx: ServiceContext,
  dashboardId: string,
  name?: string,
): Promise<DashboardDto> {
  const source = await getDashboard(ctx, dashboardId);
  return inTransaction(ctx, async (tx) => {
    const created = await createDashboard(tx, {
      name: name ?? `${source.name} (copy)`,
      description: source.description,
      workspaceId: source.workspaceId,
      boardIds: ((source.config as { boardIds?: string[] }).boardIds ?? []).filter((id) => typeof id === 'string'),
    });
    await tx.db
      .update(dashboards)
      .set({ config: { ...source.config, boardIds: (created.config as { boardIds?: string[] }).boardIds ?? [] } })
      .where(eq(dashboards.id, created.id));
    if (source.widgets.length > 0) {
      await tx.db.insert(dashboardWidgets).values(
        source.widgets.map((widget) => ({
          orgId: tx.orgId,
          dashboardId: created.id,
          type: widget.type,
          title: widget.title,
          config: widget.config,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
        })),
      );
    }
    return getDashboard(tx, created.id);
  });
}

/** Undo for a soft-deleted dashboard (same privacy + workspace rule as reads). */
export async function restoreDashboard(ctx: ServiceContext, dashboardId: string): Promise<DashboardDto> {
  const [existing] = await ctx.db
    .select({ config: dashboards.config, createdBy: dashboards.createdBy, workspaceId: dashboards.workspaceId })
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId), isNotNull(dashboards.deletedAt)))
    .limit(1);
  if (!existing) throw new NotFoundError('Dashboard');
  const privacy = (existing.config as { privacy?: unknown } | null)?.privacy;
  if (privacy === 'private' && existing.createdBy !== ctx.userId && ctx.userId !== null && !isOrgAdmin(ctx)) {
    throw new NotFoundError('Dashboard');
  }
  if (existing.workspaceId) {
    try {
      await requireWorkspace(ctx, existing.workspaceId);
    } catch {
      throw new NotFoundError('Dashboard');
    }
  }
  const [row] = await ctx.db
    .update(dashboards)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId), isNotNull(dashboards.deletedAt)))
    .returning({ id: dashboards.id });
  if (!row) throw new NotFoundError('Dashboard');
  return getDashboard(ctx, dashboardId);
}
