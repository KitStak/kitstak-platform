/**
 * Integration links between tasks/projects and CRM/WMS/customer records (pm.integration_links).
 * Titles/statuses are cached on the link so chips render without cross-schema reads;
 * `refreshLinks` re-reads them. `findLinkedWork` answers the cross-app question
 * "which tasks/projects are linked to this CRM deal / WMS order?".
 */
import 'server-only';
import type { LinkStatusChange } from './automation-sweep';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { integrationLinks, projects, tasks } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { resolveTarget, resolveTargets } from '@/server/integrations';
import type { IntegrationTargetType } from '@/lib/constants';
import { INTEGRATION_TARGET_LABELS } from '@/lib/constants';
import type { IntegrationLinkDTO, ProjectSummary, TaskSummary } from '@/lib/types';
import { toIntegrationLinkDTO, type DomainContext } from './_shared';
import { requireProject, requireTask, visibleProjectsWhere } from './access';
import { logActivity } from './activity';
import { listProjects } from './projects';
import { selectTaskSummaries } from './task-queries';

export async function listLinks(ctx: DomainContext, owner: { taskId: string } | { projectId: string }): Promise<IntegrationLinkDTO[]> {
  if ('taskId' in owner) await requireTask(ctx, owner.taskId);
  else await requireProject(ctx, { id: owner.projectId });
  const rows = await db
    .select()
    .from(integrationLinks)
    .where('taskId' in owner ? eq(integrationLinks.taskId, owner.taskId) : eq(integrationLinks.projectId, owner.projectId))
    .orderBy(asc(integrationLinks.createdAt));
  return rows.map(toIntegrationLinkDTO);
}

/**
 * Every task-level link in a project (board/list/table chips). One query instead of one per task.
 * Added by views-a.
 */
export async function listProjectTaskLinks(ctx: DomainContext, projectId: string): Promise<IntegrationLinkDTO[]> {
  await requireProject(ctx, { id: projectId });
  const rows = await db
    .select({ link: integrationLinks })
    .from(integrationLinks)
    .innerJoin(tasks, eq(tasks.id, integrationLinks.taskId))
    .where(and(eq(integrationLinks.orgId, ctx.orgId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .orderBy(asc(integrationLinks.createdAt));
  return rows.map((row) => toIntegrationLinkDTO(row.link));
}

export interface AddLinkInput {
  readonly taskId?: string | null;
  readonly projectId?: string | null;
  readonly targetType: IntegrationTargetType;
  readonly targetId: string;
}

export async function addLink(ctx: DomainContext, input: AddLinkInput): Promise<IntegrationLinkDTO> {
  if (Boolean(input.taskId) === Boolean(input.projectId)) throw invalid('Link either a task or a project.');
  let projectId: string;
  if (input.taskId) {
    const { task } = await requireTask(ctx, input.taskId, 'task:update');
    projectId = task.projectId;
  } else {
    await requireProject(ctx, { id: input.projectId as string }, 'project:update');
    projectId = input.projectId as string;
  }
  const target = await resolveTarget(ctx, input.targetType, input.targetId);
  if (!target) throw invalid(`That ${INTEGRATION_TARGET_LABELS[input.targetType].toLowerCase()} can't be found or isn't available to this workspace.`);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(integrationLinks)
      .values({
        orgId: ctx.orgId,
        taskId: input.taskId ?? null,
        projectId: input.taskId ? null : projectId,
        targetType: input.targetType,
        targetId: input.targetId,
        cachedTitle: target.title,
        cachedStatus: target.status,
        cachedUrl: target.url,
        cachedAt: new Date(),
        meta: target.meta ?? {},
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning();
    const link =
      inserted ??
      (
        await tx
          .select()
          .from(integrationLinks)
          .where(
            and(
              input.taskId ? eq(integrationLinks.taskId, input.taskId) : eq(integrationLinks.projectId, projectId),
              eq(integrationLinks.targetType, input.targetType),
              eq(integrationLinks.targetId, input.targetId),
            ),
          )
      )[0];
    if (inserted) {
      await logActivity(tx, ctx, {
        verb: 'task.link_added',
        entityType: input.taskId ? 'task' : 'project',
        entityId: input.taskId ?? projectId,
        projectId,
        taskId: input.taskId ?? null,
        after: { targetType: input.targetType, targetId: input.targetId, title: target.title },
      });
      // Mirror the primary CRM/customer pointer on the project for quick filters.
      if (!input.taskId && input.targetType === 'core_customer') {
        await tx.update(projects).set({ crmCustomerId: input.targetId }).where(and(eq(projects.id, projectId), isNull(projects.crmCustomerId)));
      }
      if (!input.taskId && (input.targetType === 'crm_item' || input.targetType === 'crm_account')) {
        await tx.update(projects).set({ crmItemId: input.targetId }).where(and(eq(projects.id, projectId), isNull(projects.crmItemId)));
      }
    }
    return link;
  });
  return toIntegrationLinkDTO(row);
}

export async function removeLink(ctx: DomainContext, linkId: string): Promise<void> {
  const [link] = await db.select().from(integrationLinks).where(and(eq(integrationLinks.id, linkId), eq(integrationLinks.orgId, ctx.orgId)));
  if (!link) throw notFound('That link');
  let projectId = link.projectId;
  if (link.taskId) projectId = (await requireTask(ctx, link.taskId, 'task:update')).task.projectId;
  else if (link.projectId) await requireProject(ctx, { id: link.projectId }, 'project:update');
  await db.transaction(async (tx) => {
    await tx.delete(integrationLinks).where(eq(integrationLinks.id, linkId));
    await logActivity(tx, ctx, {
      verb: 'task.link_removed',
      entityType: link.taskId ? 'task' : 'project',
      entityId: link.taskId ?? link.projectId,
      projectId,
      taskId: link.taskId,
      before: { targetType: link.targetType, targetId: link.targetId, title: link.cachedTitle },
    });
  });
}

/** Re-reads cached title/status/url for the given links (or every link of a task/project). */
export async function refreshLinks(ctx: DomainContext, owner: { taskId: string } | { projectId: string }): Promise<IntegrationLinkDTO[]> {
  const links = await listLinks(ctx, owner);
  const byType = new Map<IntegrationTargetType, string[]>();
  for (const link of links) byType.set(link.targetType, [...(byType.get(link.targetType) ?? []), link.targetId]);
  const changes: LinkStatusChange[] = [];
  for (const [type, ids] of byType) {
    const resolved = await resolveTargets(ctx, type, ids);
    for (const link of links.filter((l) => l.targetType === type)) {
      const target = resolved.get(link.targetId);
      if (!target) continue;
      if (link.taskId && (link.status ?? '') !== (target.status ?? '')) {
        changes.push({ taskId: link.taskId, targetType: type, targetId: link.targetId, title: target.title, before: link.status, after: target.status });
      }
      await db
        .update(integrationLinks)
        .set({ cachedTitle: target.title, cachedStatus: target.status, cachedUrl: target.url, cachedAt: new Date(), meta: target.meta ?? {} })
        .where(eq(integrationLinks.id, link.id));
    }
  }
  // Linked CRM stage / WMS shipment changes can trigger automations (studio team).
  if (changes.length) {
    const { runLinkStatusAutomations } = await import('./automation-sweep');
    await runLinkStatusAutomations(ctx, changes).catch((error) => console.error('[automations] link triggers failed', error));
  }
  return listLinks(ctx, owner);
}

export interface LinkedWork {
  readonly target: { readonly type: IntegrationTargetType; readonly id: string };
  readonly projects: readonly ProjectSummary[];
  readonly tasks: readonly TaskSummary[];
}

/**
 * Everything in Projects linked to one external record (CRM item panel, WMS order page).
 * Includes projects whose crm_item_id / crm_customer_id point at it.
 */
export async function findLinkedWork(ctx: DomainContext, type: IntegrationTargetType, targetId: string): Promise<LinkedWork> {
  const links = await db
    .select({ projectId: integrationLinks.projectId, taskId: integrationLinks.taskId })
    .from(integrationLinks)
    .where(and(eq(integrationLinks.orgId, ctx.orgId), eq(integrationLinks.targetType, type), eq(integrationLinks.targetId, targetId)));
  const direct: string[] = [];
  if (type === 'crm_item' || type === 'crm_account' || type === 'core_customer') {
    const column = type === 'core_customer' ? projects.crmCustomerId : projects.crmItemId;
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt), sql`${column}::text = ${targetId}`));
    direct.push(...rows.map((row) => row.id));
  }
  const projectIds = [...new Set([...links.flatMap((l) => (l.projectId ? [l.projectId] : [])), ...direct])];
  const taskIds = links.flatMap((l) => (l.taskId ? [l.taskId] : []));
  const [projectList, taskList] = await Promise.all([
    projectIds.length ? listProjects(ctx, { ids: projectIds, includeArchived: true }) : Promise.resolve([]),
    taskIds.length
      ? selectTaskSummaries(and(inArray(tasks.id, taskIds), eq(tasks.orgId, ctx.orgId), visibleProjectsWhere(ctx)))
      : Promise.resolve([] as TaskSummary[]),
  ]);
  return { target: { type, id: targetId }, projects: projectList, tasks: taskList };
}

/** Tasks + projects linked to any of many targets of one type (bulk badges in sibling apps). */
export async function countLinkedWork(
  ctx: DomainContext,
  type: IntegrationTargetType,
  targetIds: readonly string[],
): Promise<Record<string, { tasks: number; projects: number }>> {
  if (targetIds.length === 0) return {};
  const rows = await db
    .select({ targetId: integrationLinks.targetId, taskId: integrationLinks.taskId, projectId: integrationLinks.projectId })
    .from(integrationLinks)
    .leftJoin(tasks, eq(tasks.id, integrationLinks.taskId))
    .leftJoin(projects, or(eq(projects.id, integrationLinks.projectId), eq(projects.id, tasks.projectId)))
    .where(
      and(
        eq(integrationLinks.orgId, ctx.orgId),
        eq(integrationLinks.targetType, type),
        inArray(integrationLinks.targetId, [...targetIds]),
        isNull(projects.deletedAt),
        visibleProjectsWhere(ctx),
      ),
    );
  const out: Record<string, { tasks: number; projects: number }> = {};
  for (const row of rows) {
    const entry = (out[row.targetId] ??= { tasks: 0, projects: 0 });
    if (row.taskId) entry.tasks += 1;
    else entry.projects += 1;
  }
  return out;
}
