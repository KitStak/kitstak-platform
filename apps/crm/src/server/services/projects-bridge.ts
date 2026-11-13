/**
 * KitStak Projects inside the CRM (item panel "Projects" tab): which projects and tasks are
 * linked to a deal / account / any board item, create a task or link a project without leaving
 * the CRM, and tell Projects when a record's stage changes so its automations can react.
 *
 * Everything goes through @kitstak/pm-bridge over the CRM's own executor (one shared Postgres,
 * no network hop). Degrades to `available: false` when the org isn't licensed for Projects or
 * the pm schema isn't installed; stage events are fire-and-forget and never break a CRM write.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  BridgeError,
  createTaskFromExternal,
  emitRecordStatusChange,
  isBridgeError,
  linkProjectToRecord,
  listLinkedWork,
  listOrgPeople,
  listWritableProjects,
  pmAvailability,
  removeLink,
  rowsOf,
  type BridgeExecutor,
  type BridgeLinkSnapshot,
  type BridgePerson,
  type BridgePriority,
  type BridgeTarget,
  type BridgeTask,
  type LinkedWork,
  type WritableProject,
} from '@kitstak/pm-bridge';
import { customerLinks, customers as coreCustomers } from '@kitstak/db/schema';
import { organization } from '@/server/db/schema';
import { env } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { logger } from '@/server/logger';
import { requireItem } from './access';
import type { ServiceContext } from './context';

const STAGE_KEYS = ['stage', 'status', 'health'] as const;

export interface ItemProjectsDto {
  /** Projects is licensed for this org and installed in this database. */
  readonly available: boolean;
  /** Why it's unavailable, in plain words (null when available). */
  readonly reason: 'not_licensed' | 'not_installed' | null;
  readonly projectsUrl: string;
  readonly target: BridgeLinkSnapshot | null;
  readonly work: LinkedWork;
  /** "Create project" deep link (Projects wizard, prefilled from this record). */
  readonly createProjectUrl: string | null;
}

export interface ProjectOptionsDto {
  readonly projects: readonly WritableProject[];
  readonly people: readonly BridgePerson[];
}

const EMPTY_WORK: LinkedWork = { projects: [], tasks: [], openTasks: 0 };

function projectsUrl(): string {
  return env.NEXT_PUBLIC_PROJECTS_URL.replace(/\/+$/, '');
}

function crmBase(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
}

const bridgeDb = (ctx: ServiceContext) => ctx.db as unknown as BridgeExecutor;

function actor(ctx: ServiceContext) {
  if (!ctx.userId) throw new ForbiddenError('Sign in to work with projects');
  return { orgId: ctx.orgId, userId: ctx.userId };
}

/** Maps bridge errors onto the CRM error envelope (plain-language messages pass through). */
function rethrow(error: unknown): never {
  if (isBridgeError(error)) {
    if (error.code === 'NOT_FOUND') throw new NotFoundError('Project', error.message);
    if (error.code === 'FORBIDDEN') throw new ForbiddenError(error.message);
    if (error.code === 'UNAVAILABLE') throw new ConflictError(error.message);
    throw new ValidationError(
      Object.entries(error.fields ?? {}).map(([path, message]) => ({ path, message })),
      error.message,
    );
  }
  throw error;
}

async function availability(ctx: ServiceContext): Promise<ItemProjectsDto['reason']> {
  const flags = await orgModuleFlags(ctx.orgId);
  if (!flags.projects) return 'not_licensed';
  return (await pmAvailability(bridgeDb(ctx))).installed ? null : 'not_installed';
}

async function orgSlug(ctx: ServiceContext): Promise<string> {
  const [row] = await ctx.db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, ctx.orgId))
    .limit(1);
  return row?.slug ?? '';
}

/** Current stage/status label of an item (same rule Projects uses for CRM chips). */
async function itemStatus(
  ctx: ServiceContext,
  itemId: string,
): Promise<{ label: string | null; color: string | null }> {
  const rows = rowsOf<{ status_id: string | null; labels: unknown }>(
    await ctx.db.execute(sql`
      select coalesce(i.values #>> '{stage,labelId}', i.values #>> '{status,labelId}', i.values #>> '{health,labelId}') as status_id,
             (select c.settings -> 'labels' from crm.columns c
               where c.board_id = i.board_id and c.key in ('stage', 'status', 'health') and c.deleted_at is null
               order by case c.key when 'stage' then 0 when 'status' then 1 else 2 end limit 1) as labels
        from crm.items i where i.id = ${itemId} and i.org_id = ${ctx.orgId}`),
  );
  const row = rows[0];
  const labels = Array.isArray(row?.labels)
    ? (row.labels as { id: string; name: string; color?: string }[])
    : [];
  const label = row?.status_id ? labels.find((entry) => entry.id === row.status_id) : undefined;
  return { label: label?.name ?? null, color: label?.color ?? null };
}

/** The bridge target(s) for an item: deals → crm_item, accounts → crm_account (+ its WMS customer). */
async function targetsFor(ctx: ServiceContext, itemId: string) {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  const type: BridgeTarget['type'] = board.kind === 'accounts' ? 'crm_account' : 'crm_item';
  const slug = await orgSlug(ctx);
  const status = await itemStatus(ctx, item.id);
  const snapshot: BridgeLinkSnapshot = {
    type,
    id: item.id,
    title: item.name,
    status: status.label,
    url: `${crmBase()}/${slug}/boards/${board.id}?item=${item.id}`,
    meta: { boardId: board.id, kind: board.kind, statusColor: status.color },
  };
  const targets: BridgeTarget[] = [{ type, id: item.id }];
  // A deal could have been linked as an account (or vice versa) by older clients: read both.
  targets.push({ type: type === 'crm_item' ? 'crm_account' : 'crm_item', id: item.id });
  let customerId: string | null = null;
  if (board.kind === 'accounts') {
    const [link] = await ctx.db
      .select({ id: customerLinks.coreCustomerId })
      .from(customerLinks)
      .innerJoin(coreCustomers, eq(coreCustomers.id, customerLinks.coreCustomerId))
      .where(and(eq(customerLinks.itemId, item.id), isNull(coreCustomers.deletedAt)))
      .limit(1);
    customerId = link?.id ?? null;
    if (customerId) targets.push({ type: 'core_customer', id: customerId });
  }
  return { item, board, snapshot, targets, customerId };
}

export async function getItemProjects(ctx: ServiceContext, itemId: string): Promise<ItemProjectsDto> {
  const reason = await availability(ctx);
  const base = { projectsUrl: projectsUrl() };
  if (reason) {
    await requireItem(ctx, itemId, 'read');
    return { ...base, available: false, reason, target: null, work: EMPTY_WORK, createProjectUrl: null };
  }
  const { snapshot, targets, customerId } = await targetsFor(ctx, itemId);
  const work = ctx.userId
    ? await listLinkedWork(bridgeDb(ctx), actor(ctx), targets, { projectsUrl: base.projectsUrl })
    : EMPTY_WORK;
  const params = new URLSearchParams({
    template: 'builtin:client-onboarding',
    crmItem: snapshot.id,
    name: snapshot.title,
  });
  if (customerId) params.set('customer', customerId);
  return {
    ...base,
    available: true,
    reason: null,
    target: snapshot,
    work,
    createProjectUrl: `${base.projectsUrl}/projects/new?${params.toString()}`,
  };
}

export async function getProjectOptions(ctx: ServiceContext, query?: string): Promise<ProjectOptionsDto> {
  if (await availability(ctx)) return { projects: [], people: [] };
  const [projects, people] = await Promise.all([
    listWritableProjects(bridgeDb(ctx), actor(ctx), { query, limit: 100 }),
    listOrgPeople(bridgeDb(ctx), ctx.orgId),
  ]);
  return { projects, people };
}

export interface CreateItemTaskInput {
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly statusId?: string | null;
  readonly priority?: BridgePriority;
  readonly assigneeId?: string | null;
  readonly dueDate?: string | null;
}

async function requireAvailable(ctx: ServiceContext): Promise<void> {
  const reason = await availability(ctx);
  if (reason === 'not_licensed')
    throw new ForbiddenError(
      'KitStak Projects isn’t part of this workspace’s plan yet. Add it in Portal billing.',
      { reason: 'projects_not_licensed' },
    );
  if (reason) throw new ConflictError('KitStak Projects isn’t set up for this workspace yet.');
}

export async function createItemTask(
  ctx: ServiceContext,
  itemId: string,
  input: CreateItemTaskInput,
): Promise<BridgeTask> {
  await requireAvailable(ctx);
  const { item, snapshot } = await targetsFor(ctx, itemId);
  if (item.deletedAt || item.archivedAt)
    throw new ConflictError('Restore this record before adding tasks to it.');
  try {
    const created = await createTaskFromExternal(
      bridgeDb(ctx),
      actor(ctx),
      { ...input, link: snapshot, source: 'crm' },
      { projectsUrl: projectsUrl() },
    );
    return created.task;
  } catch (error) {
    rethrow(error);
  }
}

export async function linkItemProject(
  ctx: ServiceContext,
  itemId: string,
  projectId: string,
): Promise<{ linkId: string }> {
  await requireAvailable(ctx);
  const { snapshot } = await targetsFor(ctx, itemId);
  try {
    const result = await linkProjectToRecord(bridgeDb(ctx), actor(ctx), projectId, snapshot);
    return { linkId: result.linkId };
  } catch (error) {
    rethrow(error);
  }
}

export async function unlinkItemWork(ctx: ServiceContext, itemId: string, linkId: string): Promise<void> {
  await requireAvailable(ctx);
  const { targets } = await targetsFor(ctx, itemId);
  // Only links that point at this record can be removed from its panel.
  const rows = rowsOf<{ target_type: string; target_id: string }>(
    await ctx.db.execute(
      sql`select target_type, target_id from pm.integration_links where id = ${linkId} and org_id = ${ctx.orgId}`,
    ),
  );
  const link = rows[0];
  if (!link || !targets.some((target) => target.type === link.target_type && target.id === link.target_id)) {
    throw new NotFoundError('Link', 'That link no longer exists.');
  }
  try {
    await removeLink(bridgeDb(ctx), actor(ctx), linkId);
  } catch (error) {
    rethrow(error);
  }
}

/**
 * Automation hook: a status-type stage/status/health column changed on an item. Refreshes the
 * cached stage on every Projects link to it and queues an event for Projects automations.
 * Runs inside the CRM write's transaction (the bridge uses a SAVEPOINT) and never throws.
 */
export async function notifyProjectsOfStageChange(
  ctx: ServiceContext,
  change: { readonly itemId: string; readonly columnKey: string; readonly columnType: string },
): Promise<void> {
  if (change.columnType !== 'status' || !(STAGE_KEYS as readonly string[]).includes(change.columnKey)) return;
  try {
    const db = bridgeDb(ctx);
    if (!(await pmAvailability(db)).installed) return;
    const rows = rowsOf<{ name: string; board_id: string; kind: string; slug: string }>(
      await ctx.db.execute(sql`
        select i.name, i.board_id, b.kind, o.slug from crm.items i
          join crm.boards b on b.id = i.board_id join core.organization o on o.id = i.org_id
         where i.id = ${change.itemId} and i.org_id = ${ctx.orgId}`),
    );
    const item = rows[0];
    if (!item) return;
    const status = await itemStatus(ctx, change.itemId);
    const url = `${crmBase()}/${item.slug}/boards/${item.board_id}?item=${change.itemId}`;
    for (const type of ['crm_item', 'crm_account'] as const) {
      await emitRecordStatusChange(db, {
        orgId: ctx.orgId,
        source: 'crm',
        target: { type, id: change.itemId },
        title: item.name,
        status: status.label,
        url,
        actorId: ctx.userId,
      });
    }
  } catch (error) {
    logger.warn('projects.stage_event_failed', {
      orgId: ctx.orgId,
      itemId: change.itemId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export { BridgeError };
