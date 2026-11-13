/**
 * Scheduled automation triggers (studio team). There is no background job runner, so the
 * sweep runs lazily: after a page or the unread-count poll is served (throttled per org), when
 * the Automations page loads, and whenever linked CRM/WMS records are refreshed.
 *
 *   - due_date_approaching / task_overdue: open tasks with a due date; once per (rule, task, due date)
 *   - crm_stage_changed: a CRM deal/account linked to a task has a new stage
 *   - wms_order_shipped: a WMS order linked to a task became Shipped or Delivered
 *
 * Events go through the normal executor (runAutomationsForEvents), which records each run and
 * skips repeats using the event's dedupe key.
 */
import 'server-only';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/server/db';
import { automations, integrationLinks, tasks } from '@/server/db/schema';
import type { TaskEvent } from '@/server/automations/engine';
import { SCHEDULED_TRIGGER_TYPES, WMS_SHIPPED_STATUSES, type AutomationTrigger } from '@/lib/automation-types';
import type { IntegrationTargetType } from '@/lib/constants';
import { addDaysIso, diffDays, todayIso } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';
import type { DomainContext } from './_shared';
import { runAutomationsForEvents } from './automations';
import { selectTaskSummaries } from './task-queries';

const THROTTLE_MS = 5 * 60_000;
const lastSweep = new Map<string, number>();
const CRM_TYPES: readonly IntegrationTargetType[] = ['crm_item', 'crm_account'];

export function engineTaskFromSummary(summary: TaskSummary): TaskEvent['task'] {
  return {
    id: summary.id,
    projectId: summary.projectId,
    title: summary.title,
    statusId: summary.statusId,
    statusCategory: summary.statusCategory,
    priority: summary.priority,
    assigneeId: summary.assigneeId,
    sectionId: summary.sectionId,
    dueDate: summary.dueDate,
    labelIds: summary.labelIds,
    parentTaskId: summary.parentTaskId,
  };
}

/** The sweep acts for the org, not for whoever's request happened to start it. */
function sweepContext(ctx: DomainContext): DomainContext {
  return { ...ctx, orgRole: 'owner', userName: 'Automation' };
}

interface ScheduledRule {
  readonly projectId: string | null;
  readonly trigger: AutomationTrigger;
}

async function scheduledRules(orgId: string): Promise<ScheduledRule[]> {
  const rows = await db
    .select({ projectId: automations.projectId, trigger: automations.trigger })
    .from(automations)
    .where(
      and(
        eq(automations.orgId, orgId),
        eq(automations.enabled, true),
        isNull(automations.deletedAt),
        inArray(sql<string>`${automations.trigger} ->> 'type'`, [...SCHEDULED_TRIGGER_TYPES]),
      ),
    );
  return rows;
}

/** Orgs with at least one enabled scheduled rule (for the cron route; capped). */
export async function orgsWithScheduledAutomations(limit = 200): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orgId: automations.orgId })
    .from(automations)
    .where(
      and(
        eq(automations.enabled, true),
        isNull(automations.deletedAt),
        inArray(sql<string>`${automations.trigger} ->> 'type'`, [...SCHEDULED_TRIGGER_TYPES]),
      ),
    )
    .limit(limit);
  return rows.map((row) => row.orgId);
}

/** Projects a set of rules can see (null = every project). */
function scopeOf(rules: readonly ScheduledRule[]): string[] | null {
  if (rules.some((rule) => rule.projectId === null)) return null;
  return [...new Set(rules.map((rule) => rule.projectId as string))];
}

async function dueDateEvents(ctx: DomainContext, rules: readonly ScheduledRule[]): Promise<TaskEvent[]> {
  const soonRules = rules.filter((rule) => rule.trigger.type === 'due_date_approaching');
  const overdueRules = rules.filter((rule) => rule.trigger.type === 'task_overdue');
  if (soonRules.length === 0 && overdueRules.length === 0) return [];
  const today = todayIso();
  const maxDays = Math.max(0, ...soonRules.map((rule) => (rule.trigger.type === 'due_date_approaching' ? rule.trigger.days : 0)));
  const scope = scopeOf([...soonRules, ...overdueRules]);
  const from = overdueRules.length ? addDaysIso(today, -60) : today;
  const to = soonRules.length ? addDaysIso(today, Math.min(maxDays, 60)) : addDaysIso(today, -1);
  const summaries = await selectTaskSummaries(
    and(
      eq(tasks.orgId, ctx.orgId),
      isNull(tasks.deletedAt),
      isNotNull(tasks.dueDate),
      sql`${tasks.dueDate} between ${from} and ${to}`,
      scope ? inArray(tasks.projectId, scope) : undefined,
      sql`exists (select 1 from pm.statuses s where s.id = ${tasks.statusId} and s.category not in ('done', 'cancelled'))`,
      sql`exists (select 1 from pm.projects p where p.id = ${tasks.projectId} and p.deleted_at is null and p.archived_at is null)`,
    ),
    { limit: 500 },
  );
  const events: TaskEvent[] = [];
  for (const summary of summaries) {
    if (!summary.dueDate) continue;
    const days = diffDays(today, summary.dueDate);
    if (days < 0) {
      if (overdueRules.length) events.push({ type: 'overdue', task: engineTaskFromSummary(summary), dedupeKey: `overdue:${summary.dueDate}` });
    } else if (soonRules.length) {
      events.push({ type: 'due_soon', task: engineTaskFromSummary(summary), daysUntilDue: days, dedupeKey: `due_soon:${summary.dueDate}` });
    }
  }
  return events;
}

export interface LinkStatusChange {
  readonly taskId: string;
  readonly targetType: IntegrationTargetType;
  readonly targetId: string;
  readonly title: string | null;
  readonly before: string | null;
  readonly after: string | null;
}

const norm = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/** Turns linked-record status changes into automation events and runs them. */
export async function runLinkStatusAutomations(ctx: DomainContext, changes: readonly LinkStatusChange[]): Promise<void> {
  const relevant = changes.filter((change) => norm(change.before) !== norm(change.after));
  if (relevant.length === 0) return;
  const summaries = await selectTaskSummaries(
    and(eq(tasks.orgId, ctx.orgId), isNull(tasks.deletedAt), inArray(tasks.id, [...new Set(relevant.map((c) => c.taskId))])),
  );
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const today = todayIso();
  const events: TaskEvent[] = [];
  for (const change of relevant) {
    const summary = byId.get(change.taskId);
    if (!summary) continue;
    if (CRM_TYPES.includes(change.targetType) && change.after) {
      events.push({
        type: 'crm_stage_changed',
        task: engineTaskFromSummary(summary),
        stage: change.after,
        previousStage: change.before,
        targetTitle: change.title,
        dedupeKey: `crm:${change.targetId}:${norm(change.before)}>${norm(change.after)}:${today}`,
      });
    }
    if (change.targetType === 'wms_order' && WMS_SHIPPED_STATUSES.includes(norm(change.after)) && !WMS_SHIPPED_STATUSES.includes(norm(change.before))) {
      events.push({
        type: 'wms_order_shipped',
        task: engineTaskFromSummary(summary),
        stage: change.after,
        previousStage: change.before,
        targetTitle: change.title,
        dedupeKey: `wms:${change.targetId}:shipped`,
      });
    }
  }
  if (events.length) await runAutomationsForEvents(sweepContext(ctx), events);
}

async function linkedRecordChanges(ctx: DomainContext, rules: readonly ScheduledRule[]): Promise<LinkStatusChange[]> {
  const wantCrm = rules.some((rule) => rule.trigger.type === 'crm_stage_changed');
  const wantWms = rules.some((rule) => rule.trigger.type === 'wms_order_shipped');
  const types: IntegrationTargetType[] = [...(wantCrm ? CRM_TYPES : []), ...(wantWms ? (['wms_order'] as const) : [])];
  if (types.length === 0) return [];
  const scope = scopeOf(rules.filter((rule) => rule.trigger.type === 'crm_stage_changed' || rule.trigger.type === 'wms_order_shipped'));
  const links = await db
    .select({
      id: integrationLinks.id,
      taskId: integrationLinks.taskId,
      targetType: integrationLinks.targetType,
      targetId: integrationLinks.targetId,
      cachedStatus: integrationLinks.cachedStatus,
    })
    .from(integrationLinks)
    .innerJoin(tasks, eq(tasks.id, integrationLinks.taskId))
    .where(
      and(
        eq(integrationLinks.orgId, ctx.orgId),
        isNotNull(integrationLinks.taskId),
        inArray(integrationLinks.targetType, types),
        isNull(tasks.deletedAt),
        scope ? inArray(tasks.projectId, scope) : undefined,
      ),
    )
    .limit(500);
  if (links.length === 0) return [];
  const { resolveTargets } = await import('@/server/integrations');
  const changes: LinkStatusChange[] = [];
  for (const type of types) {
    const ofType = links.filter((link) => link.targetType === type);
    if (ofType.length === 0) continue;
    const resolved = await resolveTargets(ctx, type, [...new Set(ofType.map((link) => link.targetId))]);
    for (const link of ofType) {
      const target = resolved.get(link.targetId);
      if (!target || norm(target.status) === norm(link.cachedStatus)) continue;
      await db
        .update(integrationLinks)
        .set({ cachedTitle: target.title, cachedStatus: target.status, cachedUrl: target.url, cachedAt: new Date() })
        .where(eq(integrationLinks.id, link.id));
      changes.push({
        taskId: link.taskId as string,
        targetType: type,
        targetId: link.targetId,
        title: target.title,
        before: link.cachedStatus,
        after: target.status,
      });
    }
  }
  return changes;
}

/**
 * Runs scheduled triggers for the org. Throttled to once every 5 minutes per org unless
 * `force`. Never throws: a failing sweep must not break the request that started it.
 * Returns how many events were checked.
 */
export async function sweepAutomations(ctx: DomainContext, options: { readonly force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!options.force && now - (lastSweep.get(ctx.orgId) ?? 0) < THROTTLE_MS) return 0;
  lastSweep.set(ctx.orgId, now);
  if (lastSweep.size > 5000) lastSweep.clear();
  try {
    // Cross-app recipes (CRM deal won, WMS receipt discrepancy, count variance): own throttle, never throws.
    const { runRecordTriggers } = await import('@/server/integrations/record-triggers');
    await runRecordTriggers(ctx, options);
    const rules = await scheduledRules(ctx.orgId);
    if (rules.length === 0) return 0;
    const runCtx = sweepContext(ctx);
    const events = await dueDateEvents(runCtx, rules);
    if (events.length) await runAutomationsForEvents(runCtx, events);
    const changes = await linkedRecordChanges(runCtx, rules);
    await runLinkStatusAutomations(runCtx, changes);
    return events.length + changes.length;
  } catch (error) {
    console.error('[automations] scheduled sweep failed', error);
    return 0;
  }
}

/** Schedules a sweep after the current response (falls back to a detached promise outside a request). */
export function scheduleAutomationSweep(ctx: DomainContext): void {
  if (Date.now() - (lastSweep.get(ctx.orgId) ?? 0) < THROTTLE_MS) return;
  const run = () => sweepAutomations(ctx).then(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}
