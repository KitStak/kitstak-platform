/**
 * Drains pm.integration_events, the inbox CRM and WMS write through @kitstak/pm-bridge:
 *
 *   record_status_changed  a linked CRM deal/account moved stage, a WMS order shipped…
 *                          → "When the linked deal changes stage" / "When the linked order ships"
 *                            automations (runLinkStatusAutomations) + an inbox note to the
 *                            assignees of open linked tasks
 *   task_created           a task was created from the CRM / WMS
 *                          → "When a task is created" automations, as if it was made here
 *
 * There is no job runner, so draining is lazy (after the unread-count poll, throttled per org)
 * plus an optional cron route (`/api/v1/integrations/events`, CRON_SECRET). Rows are claimed by
 * setting processed_at first, so concurrent drains never double-process; a failing batch is
 * released for retry (max 5 attempts) with its error recorded.
 */
import 'server-only';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/server/db';
import { integrationEvents, integrationLinks, projects, statuses, tasks } from '@/server/db/schema';
import { INTEGRATION_TARGET_LABELS, type IntegrationTargetType } from '@/lib/constants';
import { taskKey } from '@/lib/task-key';
import type { DomainContext } from '@/server/domain/_shared';
import { engineTaskFromSummary, runLinkStatusAutomations, type LinkStatusChange } from '@/server/domain/automation-sweep';
import { runAutomationsForEvents } from '@/server/domain/automations';
import { notify } from '@/server/domain/notifications';
import { selectTaskSummaries } from '@/server/domain/task-queries';
import { tableExists } from './detect';

const THROTTLE_MS = 15_000;
const BATCH = 100;
const MAX_ATTEMPTS = 5;
const RETENTION_DAYS = 30;
const lastDrain = new Map<string, number>();

type EventRow = typeof integrationEvents.$inferSelect;

const SOURCE_NAMES: Readonly<Record<string, string>> = { crm: 'CRM', wms: 'WMS', portal: 'Portal', projects: 'Projects' };

/** Drains act for the org (rules run as automations), never as the request's user. */
function drainContext(ctx: DomainContext): DomainContext {
  return { ...ctx, orgRole: 'owner', actorKind: 'integration', userName: 'KitStak' };
}

async function claim(orgId: string): Promise<EventRow[]> {
  const result = await db.execute<EventRow & Record<string, unknown>>(sql`
    update pm.integration_events e set processed_at = now(), attempts = e.attempts + 1, error = null
     where e.id in (
       select id from pm.integration_events
        where org_id = ${orgId} and processed_at is null and attempts < ${MAX_ATTEMPTS}
        order by created_at limit ${BATCH} for update skip locked)
    returning e.id`);
  const ids = (result.rows as { id: string }[]).map((row) => row.id);
  if (ids.length === 0) return [];
  return db.select().from(integrationEvents).where(inArray(integrationEvents.id, ids)).orderBy(integrationEvents.createdAt);
}

async function release(ids: readonly string[], error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(integrationEvents)
    .set({ processedAt: null, error: message.slice(0, 1000) })
    .where(inArray(integrationEvents.id, [...ids]))
    .catch(() => undefined);
}

async function statusChanges(ctx: DomainContext, events: readonly EventRow[]): Promise<void> {
  const relevant = events.filter((event) => event.targetType && event.targetId);
  if (relevant.length === 0) return;
  const changes: LinkStatusChange[] = [];
  for (const event of relevant) {
    const links = await db
      .select({ taskId: integrationLinks.taskId })
      .from(integrationLinks)
      .where(
        and(
          eq(integrationLinks.orgId, ctx.orgId),
          eq(integrationLinks.targetType, event.targetType as IntegrationTargetType),
          eq(integrationLinks.targetId, event.targetId as string),
          isNotNull(integrationLinks.taskId),
        ),
      );
    for (const link of links) {
      changes.push({
        taskId: link.taskId as string,
        targetType: event.targetType as IntegrationTargetType,
        targetId: event.targetId as string,
        title: event.title,
        before: event.beforeStatus,
        after: event.afterStatus,
      });
    }
    await notifyAssignees(ctx, event, links.map((link) => link.taskId as string));
  }
  if (changes.length) await runLinkStatusAutomations(ctx, changes);
}

/** "Acme renewal (CRM deal) moved to Won" for the assignees of open linked tasks. */
async function notifyAssignees(ctx: DomainContext, event: EventRow, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0 || !event.afterStatus) return;
  const rows = await db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title, assigneeId: tasks.assigneeId, projectId: tasks.projectId, key: projects.key })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        inArray(tasks.id, [...new Set(taskIds)]),
        isNull(tasks.deletedAt),
        isNotNull(tasks.assigneeId),
        sql`${statuses.category} not in ('done', 'cancelled')`,
      ),
    );
  const label = INTEGRATION_TARGET_LABELS[event.targetType as IntegrationTargetType] ?? 'Linked record';
  const name = event.title ?? label;
  for (const row of rows) {
    if (row.assigneeId === event.actorId) continue;
    const key = taskKey(row.key, row.number);
    await notify(db, ctx, {
      recipients: [row.assigneeId],
      kind: 'integration',
      title: `${name} moved to ${event.afterStatus}`.slice(0, 300),
      body: `${label} linked to ${key}: ${row.title}${event.beforeStatus ? ` · was ${event.beforeStatus}` : ''} · updated in ${SOURCE_NAMES[event.source] ?? 'another app'}`,
      url: `/p/${row.key}/${row.number}`,
      projectId: row.projectId,
      taskId: row.id,
    });
  }
}

async function createdTasks(ctx: DomainContext, events: readonly EventRow[]): Promise<void> {
  const ids = [...new Set(events.flatMap((event) => (event.taskId ? [event.taskId] : [])))];
  if (ids.length === 0) return;
  const summaries = await selectTaskSummaries(and(eq(tasks.orgId, ctx.orgId), inArray(tasks.id, ids)));
  if (summaries.length === 0) return;
  await runAutomationsForEvents(
    ctx,
    summaries.map((summary) => ({ type: 'task_created' as const, task: engineTaskFromSummary(summary), dedupeKey: `external-created:${summary.id}` })),
  );
}

/**
 * Processes pending events for the org. Returns how many were handled. Never throws.
 * `force` skips the per-org throttle (cron, tests).
 */
export async function drainIntegrationEvents(ctx: DomainContext, options: { readonly force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!options.force && now - (lastDrain.get(ctx.orgId) ?? 0) < THROTTLE_MS) return 0;
  lastDrain.set(ctx.orgId, now);
  if (lastDrain.size > 5000) lastDrain.clear();
  if (!(await tableExists('pm.integration_events'))) return 0;
  const runCtx = drainContext(ctx);
  let handled = 0;
  try {
    for (let round = 0; round < 5; round += 1) {
      const batch = await claim(ctx.orgId);
      if (batch.length === 0) break;
      try {
        await statusChanges(runCtx, batch.filter((event) => event.kind === 'record_status_changed'));
        await createdTasks(runCtx, batch.filter((event) => event.kind === 'task_created'));
        handled += batch.length;
      } catch (error) {
        console.error('[integrations] event batch failed', error);
        await release(batch.map((event) => event.id), error);
        break;
      }
      if (batch.length < BATCH) break;
    }
    if (handled > 0) {
      await db.execute(
        sql`delete from pm.integration_events where org_id = ${ctx.orgId} and processed_at < now() - make_interval(days => ${RETENTION_DAYS})`,
      );
    }
  } catch (error) {
    console.error('[integrations] event drain failed', error);
  }
  return handled;
}

/** Cheap check + drain after the current response (unread-count poll, page loads). */
export function scheduleIntegrationEvents(ctx: DomainContext): void {
  if (Date.now() - (lastDrain.get(ctx.orgId) ?? 0) < THROTTLE_MS) return;
  const run = async () => {
    try {
      if (!(await tableExists('pm.integration_events'))) return;
      const pending = await db
        .select({ id: integrationEvents.id })
        .from(integrationEvents)
        .where(and(eq(integrationEvents.orgId, ctx.orgId), isNull(integrationEvents.processedAt)))
        .limit(1);
      if (pending.length) await drainIntegrationEvents(ctx);
      else lastDrain.set(ctx.orgId, Date.now());
    } catch (error) {
      console.error('[integrations] event check failed', error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Orgs with pending events (cron route). */
export async function orgsWithPendingEvents(limit = 50): Promise<string[]> {
  if (!(await tableExists('pm.integration_events'))) return [];
  const rows = await db
    .selectDistinct({ orgId: integrationEvents.orgId })
    .from(integrationEvents)
    .where(and(isNull(integrationEvents.processedAt), sql`${integrationEvents.attempts} < ${MAX_ATTEMPTS}`))
    .limit(limit);
  return rows.map((row) => row.orgId);
}
