/** Saved views (per project or cross-project; personal or shared) and dashboards. */
import 'server-only';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { dashboards, savedViews, type Dashboard, type DashboardWidget, type SavedView } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import type { ViewType } from '@/lib/constants';
import { rankAfter } from '@/lib/rank';
import type { DashboardDTO, SavedViewDTO } from '@/lib/types';
import type { ViewConfig } from '@/lib/view-config';
import { cleanText, type DomainContext } from './_shared';
import { requireOrg, requireProject } from './access';
import { logActivity } from './activity';

function viewDTO(row: SavedView): SavedViewDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    name: row.name,
    type: row.type,
    config: row.config,
    isDefault: row.isDefault,
    position: row.position,
  };
}

/** Views visible to the actor: shared views of the project + their personal ones. */
export async function listSavedViews(ctx: DomainContext, projectId: string | null): Promise<SavedViewDTO[]> {
  if (projectId) await requireProject(ctx, { id: projectId });
  const rows = await db
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.orgId, ctx.orgId),
        projectId ? eq(savedViews.projectId, projectId) : isNull(savedViews.projectId),
        or(isNull(savedViews.userId), eq(savedViews.userId, ctx.userId)),
      ),
    )
    .orderBy(sql`${savedViews.position} COLLATE "C"`);
  return rows.map(viewDTO);
}

export interface SavedViewInput {
  readonly projectId: string | null;
  readonly name: string;
  readonly type: ViewType;
  readonly config: ViewConfig;
  /** Shared with everyone on the project (needs edit rights) or just for me. */
  readonly shared?: boolean;
  readonly isDefault?: boolean;
}

export async function createSavedView(ctx: DomainContext, input: SavedViewInput): Promise<SavedViewDTO> {
  const shared = Boolean(input.shared && input.projectId);
  if (input.projectId) await requireProject(ctx, { id: input.projectId }, shared ? 'view:save_shared' : 'project:read');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the view a name.', { name: 'Give the view a name.' });
  const [row] = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ position: savedViews.position })
      .from(savedViews)
      .where(and(eq(savedViews.orgId, ctx.orgId), input.projectId ? eq(savedViews.projectId, input.projectId) : isNull(savedViews.projectId)))
      .orderBy(sql`${savedViews.position} COLLATE "C" desc`)
      .limit(1);
    if (input.isDefault && shared && input.projectId) {
      await tx
        .update(savedViews)
        .set({ isDefault: false })
        .where(and(eq(savedViews.projectId, input.projectId), eq(savedViews.type, input.type), isNull(savedViews.userId)));
    }
    const inserted = await tx
      .insert(savedViews)
      .values({
        orgId: ctx.orgId,
        projectId: input.projectId,
        userId: shared ? null : ctx.userId,
        name: name.slice(0, 80),
        type: input.type,
        config: input.config,
        isDefault: input.isDefault ?? false,
        position: rankAfter(existing[0]?.position),
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'view.created', entityType: 'view', entityId: inserted[0].id, projectId: input.projectId, after: { name, type: input.type, shared } });
    return inserted;
  });
  return viewDTO(row);
}

async function loadEditableView(ctx: DomainContext, viewId: string): Promise<SavedView> {
  const [row] = await db.select().from(savedViews).where(and(eq(savedViews.id, viewId), eq(savedViews.orgId, ctx.orgId)));
  if (!row) throw notFound('That view');
  if (row.userId && row.userId !== ctx.userId) throw notFound('That view');
  if (!row.userId && row.projectId) await requireProject(ctx, { id: row.projectId }, 'view:save_shared');
  if (!row.userId && !row.projectId && row.createdBy !== ctx.userId) throw forbidden();
  return row;
}

export async function updateSavedView(
  ctx: DomainContext,
  viewId: string,
  patch: { name?: string; config?: ViewConfig; isDefault?: boolean; position?: string },
): Promise<SavedViewDTO> {
  const current = await loadEditableView(ctx, viewId);
  const set: Partial<typeof savedViews.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the view a name.', { name: 'Give the view a name.' });
    set.name = name.slice(0, 80);
  }
  if (patch.config !== undefined) set.config = patch.config;
  if (patch.position !== undefined) set.position = patch.position;
  const [row] = await db.transaction(async (tx) => {
    if (patch.isDefault !== undefined) {
      if (patch.isDefault && current.projectId) {
        await tx
          .update(savedViews)
          .set({ isDefault: false })
          .where(and(eq(savedViews.projectId, current.projectId), eq(savedViews.type, current.type), current.userId ? eq(savedViews.userId, current.userId) : isNull(savedViews.userId)));
      }
      set.isDefault = patch.isDefault;
    }
    return tx.update(savedViews).set(set).where(eq(savedViews.id, viewId)).returning();
  });
  return viewDTO(row);
}

export async function deleteSavedView(ctx: DomainContext, viewId: string): Promise<void> {
  const current = await loadEditableView(ctx, viewId);
  await db.transaction(async (tx) => {
    await tx.delete(savedViews).where(eq(savedViews.id, viewId));
    await logActivity(tx, ctx, { verb: 'view.deleted', entityType: 'view', entityId: viewId, projectId: current.projectId, before: { name: current.name } });
  });
}

// --- Dashboards -----------------------------------------------------------------------------

function dashboardDTO(row: Dashboard): DashboardDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    widgets: row.widgets,
    filters: row.filters,
    position: row.position,
  };
}

export async function listDashboards(ctx: DomainContext, projectId?: string | null): Promise<DashboardDTO[]> {
  if (projectId) await requireProject(ctx, { id: projectId });
  const rows = await db
    .select()
    .from(dashboards)
    .where(
      and(
        eq(dashboards.orgId, ctx.orgId),
        isNull(dashboards.deletedAt),
        projectId === undefined ? undefined : projectId === null ? isNull(dashboards.projectId) : eq(dashboards.projectId, projectId),
      ),
    )
    .orderBy(sql`${dashboards.position} COLLATE "C"`);
  return rows.map(dashboardDTO);
}

export async function getDashboard(ctx: DomainContext, id: string): Promise<DashboardDTO> {
  const [row] = await db.select().from(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.orgId, ctx.orgId), isNull(dashboards.deletedAt)));
  if (!row) throw notFound('That dashboard');
  if (row.projectId) await requireProject(ctx, { id: row.projectId });
  return dashboardDTO(row);
}

export interface DashboardInput {
  readonly projectId?: string | null;
  readonly name: string;
  readonly description?: string | null;
  readonly widgets?: readonly DashboardWidget[];
  readonly filters?: Record<string, unknown>;
}

export async function createDashboard(ctx: DomainContext, input: DashboardInput): Promise<DashboardDTO> {
  if (input.projectId) await requireProject(ctx, { id: input.projectId }, 'project:update');
  else requireOrg(ctx, 'dashboard:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the dashboard a name.', { name: 'Give the dashboard a name.' });
  const [last] = await db.select({ position: dashboards.position }).from(dashboards).where(eq(dashboards.orgId, ctx.orgId)).orderBy(sql`${dashboards.position} COLLATE "C" desc`).limit(1);
  const [row] = await db
    .insert(dashboards)
    .values({
      orgId: ctx.orgId,
      projectId: input.projectId ?? null,
      name,
      description: cleanText(input.description),
      widgets: [...(input.widgets ?? [])],
      filters: input.filters ?? {},
      position: rankAfter(last?.position),
      createdBy: ctx.userId,
    })
    .returning();
  return dashboardDTO(row);
}

export async function updateDashboard(ctx: DomainContext, id: string, patch: Partial<DashboardInput> & { position?: string }): Promise<DashboardDTO> {
  const current = await getDashboard(ctx, id);
  if (current.projectId) await requireProject(ctx, { id: current.projectId }, 'project:update');
  else requireOrg(ctx, 'dashboard:manage');
  const set: Partial<typeof dashboards.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the dashboard a name.');
    set.name = name;
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.widgets !== undefined) set.widgets = [...patch.widgets];
  if (patch.filters !== undefined) set.filters = patch.filters;
  if (patch.position !== undefined) set.position = patch.position;
  const [row] = await db.update(dashboards).set(set).where(eq(dashboards.id, id)).returning();
  return dashboardDTO(row);
}

export async function deleteDashboard(ctx: DomainContext, id: string): Promise<void> {
  const current = await getDashboard(ctx, id);
  if (current.projectId) await requireProject(ctx, { id: current.projectId }, 'project:update');
  else requireOrg(ctx, 'dashboard:manage');
  await db.update(dashboards).set({ deletedAt: new Date() }).where(eq(dashboards.id, id));
}
