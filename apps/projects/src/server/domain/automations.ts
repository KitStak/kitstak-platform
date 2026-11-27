/**
 * Automation rules: CRUD, run history and the executor that applies the pure engine's plan
 * (src/server/automations/engine.ts) through the normal domain functions. Executed actions run
 * as actorKind 'automation' (activity shows "Automation"), and may trigger further rules up to
 * MAX_AUTOMATION_DEPTH. A failing action records a failed run; it never breaks the user's change.
 */
import 'server-only';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { automationRuns, automations, labels, notifications, projects, sections, statuses, tasks, type Automation } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import {
  MAX_AUTOMATION_DEPTH,
  automationEventHeadline,
  describeAutomation,
  planAutomations,
  type EngineRule,
  type TaskEvent,
} from '@/server/automations/engine';
import type { AutomationAction, AutomationCondition, AutomationPersonTarget, AutomationTrigger } from '@/lib/automation-types';
import { addDaysIso, todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { taskKey } from '@/lib/task-key';
import type { AutomationDTO, AutomationRunDTO, AutomationRunRowDTO } from '@/lib/types';
import { cleanText, iso, isoRequired, type DomainContext } from './_shared';
import { requireOrg, requireProject } from './access';
import { logActivity } from './activity';
import { addWatchers, listWatcherIds, notify } from './notifications';
import { getPeople } from './people';

function toDTO(row: Automation): AutomationDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    trigger: row.trigger,
    conditions: row.conditions,
    actions: row.actions,
    runCount: row.runCount,
    lastRunAt: iso(row.lastRunAt),
    createdBy: row.createdBy,
    createdAt: isoRequired(row.createdAt),
  };
}

// --- CRUD -----------------------------------------------------------------------------------

/** Rules for one project (its own + org-wide), or every rule in the org when projectId is omitted. */
export async function listAutomations(ctx: DomainContext, projectId?: string | null): Promise<AutomationDTO[]> {
  if (projectId) await requireProject(ctx, { id: projectId });
  const where = projectId
    ? and(eq(automations.orgId, ctx.orgId), isNull(automations.deletedAt), or(eq(automations.projectId, projectId), isNull(automations.projectId)))
    : and(eq(automations.orgId, ctx.orgId), isNull(automations.deletedAt));
  const rows = await db.select().from(automations).where(where).orderBy(desc(automations.createdAt));
  if (projectId) return rows.map(toDTO);
  // Org-wide listing: hide rules on projects the actor cannot see.
  const visible: AutomationDTO[] = [];
  for (const row of rows) {
    if (!row.projectId) {
      visible.push(toDTO(row));
      continue;
    }
    try {
      await requireProject(ctx, { id: row.projectId });
      visible.push(toDTO(row));
    } catch {
      // not visible
    }
  }
  return visible;
}

export interface AutomationInput {
  readonly projectId: string | null;
  readonly name: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly trigger: AutomationTrigger;
  readonly conditions?: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
}

async function assertCanManage(ctx: DomainContext, projectId: string | null): Promise<void> {
  if (projectId) await requireProject(ctx, { id: projectId }, 'automation:manage');
  else requireOrg(ctx, 'automation:manage_global');
}

export async function createAutomation(ctx: DomainContext, input: AutomationInput): Promise<AutomationDTO> {
  await assertCanManage(ctx, input.projectId);
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the automation a name.', { name: 'Give the automation a name.' });
  if (input.actions.length === 0) throw invalid('Add at least one thing for the automation to do.');
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(automations)
      .values({
        orgId: ctx.orgId,
        projectId: input.projectId,
        name,
        description: cleanText(input.description),
        enabled: input.enabled ?? true,
        trigger: input.trigger,
        conditions: [...(input.conditions ?? [])],
        actions: [...input.actions],
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, {
      verb: 'automation.created',
      entityType: 'automation',
      entityId: inserted[0].id,
      projectId: input.projectId,
      after: { name },
    });
    return inserted;
  });
  return toDTO(row);
}

async function loadAutomation(ctx: DomainContext, id: string): Promise<Automation> {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.orgId, ctx.orgId), isNull(automations.deletedAt)));
  if (!row) throw notFound('That automation');
  return row;
}

export async function updateAutomation(
  ctx: DomainContext,
  id: string,
  patch: Partial<Omit<AutomationInput, 'projectId'>>,
): Promise<AutomationDTO> {
  const current = await loadAutomation(ctx, id);
  await assertCanManage(ctx, current.projectId);
  const set: Partial<typeof automations.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the automation a name.', { name: 'Give the automation a name.' });
    set.name = name;
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.trigger !== undefined) set.trigger = patch.trigger;
  if (patch.conditions !== undefined) set.conditions = [...patch.conditions];
  if (patch.actions !== undefined) {
    if (patch.actions.length === 0) throw invalid('Add at least one thing for the automation to do.');
    set.actions = [...patch.actions];
  }
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(automations).set(set).where(eq(automations.id, id)).returning();
    await logActivity(tx, ctx, {
      verb: patch.enabled !== undefined && Object.keys(patch).length === 1 ? (patch.enabled ? 'automation.enabled' : 'automation.disabled') : 'automation.updated',
      entityType: 'automation',
      entityId: id,
      projectId: current.projectId,
      after: { name: updated[0].name },
    });
    return updated;
  });
  return toDTO(row);
}

export async function deleteAutomation(ctx: DomainContext, id: string): Promise<void> {
  const current = await loadAutomation(ctx, id);
  await assertCanManage(ctx, current.projectId);
  await db.transaction(async (tx) => {
    await tx.update(automations).set({ deletedAt: new Date() }).where(eq(automations.id, id));
    await logActivity(tx, ctx, {
      verb: 'automation.deleted',
      entityType: 'automation',
      entityId: id,
      projectId: current.projectId,
      before: { name: current.name },
    });
  });
}

export async function restoreAutomation(ctx: DomainContext, id: string): Promise<AutomationDTO> {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.orgId, ctx.orgId)));
  if (!row) throw notFound('That automation');
  await assertCanManage(ctx, row.projectId);
  const [restored] = await db.update(automations).set({ deletedAt: null }).where(eq(automations.id, id)).returning();
  return toDTO(restored);
}

export async function listAutomationRuns(ctx: DomainContext, automationId: string, limit = 50): Promise<AutomationRunDTO[]> {
  const rule = await loadAutomation(ctx, automationId);
  if (rule.projectId) await requireProject(ctx, { id: rule.projectId });
  const rows = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((row) => ({
    id: row.id,
    automationId: row.automationId,
    taskId: row.taskId,
    status: row.status,
    summary: row.summary,
    createdAt: isoRequired(row.createdAt),
  }));
}

/**
 * Recent runs across every rule the actor can see (newest first), with the rule name and the
 * task key, for the Run history tab. Optionally one rule or one result.
 */
export async function listRecentAutomationRuns(
  ctx: DomainContext,
  options: { readonly automationId?: string; readonly status?: 'success' | 'failed' | 'skipped'; readonly limit?: number } = {},
): Promise<AutomationRunRowDTO[]> {
  const visible = await listAutomations(ctx);
  const ids = options.automationId ? visible.filter((rule) => rule.id === options.automationId).map((rule) => rule.id) : visible.map((rule) => rule.id);
  if (ids.length === 0) return [];
  const byId = new Map(visible.map((rule) => [rule.id, rule]));
  const rows = await db
    .select({
      id: automationRuns.id,
      automationId: automationRuns.automationId,
      taskId: automationRuns.taskId,
      status: automationRuns.status,
      summary: automationRuns.summary,
      detail: automationRuns.detail,
      createdAt: automationRuns.createdAt,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      taskDeletedAt: tasks.deletedAt,
      projectKey: projects.key,
    })
    .from(automationRuns)
    .leftJoin(tasks, eq(tasks.id, automationRuns.taskId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(automationRuns.orgId, ctx.orgId),
        inArray(automationRuns.automationId, ids),
        options.status ? eq(automationRuns.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(automationRuns.createdAt))
    .limit(Math.min(options.limit ?? 100, 300));
  return rows.map((row) => {
    const rule = byId.get(row.automationId);
    const detail = (row.detail ?? {}) as { event?: unknown };
    const live = row.taskNumber !== null && row.projectKey !== null && !row.taskDeletedAt;
    return {
      id: row.id,
      automationId: row.automationId,
      taskId: row.taskId,
      status: row.status,
      summary: row.summary,
      createdAt: isoRequired(row.createdAt),
      automationName: rule?.name ?? 'Automation',
      projectId: rule?.projectId ?? null,
      taskKey: live ? taskKey(row.projectKey as string, row.taskNumber as number) : null,
      taskTitle: live ? row.taskTitle : null,
      event: typeof detail.event === 'string' ? detail.event : null,
    };
  });
}

/** Plain-language sentence for a rule, resolving names from the database. */
export async function describeAutomationRule(
  ctx: DomainContext,
  rule: Pick<AutomationDTO, 'trigger' | 'conditions' | 'actions'>,
): Promise<string> {
  const json = JSON.stringify(rule);
  const ids = [...new Set(json.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])];
  if (ids.length === 0) return describeAutomation(rule);
  const [statusRows, labelRows, sectionRows, people, projectRows] = await Promise.all([
    db.select({ id: statuses.id, name: statuses.name }).from(statuses).where(and(eq(statuses.orgId, ctx.orgId), inArray(statuses.id, ids))),
    db.select({ id: labels.id, name: labels.name }).from(labels).where(and(eq(labels.orgId, ctx.orgId), inArray(labels.id, ids))),
    db.select({ id: sections.id, name: sections.name }).from(sections).where(and(eq(sections.orgId, ctx.orgId), inArray(sections.id, ids))),
    getPeople(ids),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.orgId, ctx.orgId), inArray(projects.id, ids))),
  ]);
  const map = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  const proj = map(projectRows);
  const s = map(statusRows);
  const l = map(labelRows);
  const sec = map(sectionRows);
  return describeAutomation(rule, {
    status: (id) => s.get(id),
    label: (id) => l.get(id),
    section: (id) => sec.get(id),
    person: (id) => people.get(id)?.name,
    project: (id) => proj.get(id),
  });
}

// --- Executor -------------------------------------------------------------------------------

async function rulesFor(ctx: DomainContext, projectIds: readonly string[]): Promise<EngineRule[]> {
  const rows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.orgId, ctx.orgId),
        eq(automations.enabled, true),
        isNull(automations.deletedAt),
        or(isNull(automations.projectId), inArray(automations.projectId, [...projectIds])),
      ),
    )
    .orderBy(automations.createdAt);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    enabled: row.enabled,
    trigger: row.trigger,
    conditions: row.conditions,
    actions: row.actions,
  }));
}

async function resolvePeople(
  target: AutomationPersonTarget,
  userId: string | undefined,
  taskId: string,
  ctx: DomainContext,
): Promise<string[]> {
  const [row] = await db
    .select({ assigneeId: tasks.assigneeId, reporterId: tasks.reporterId, ownerId: projects.ownerId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId));
  if (!row) return [];
  switch (target) {
    case 'assignee':
      return row.assigneeId ? [row.assigneeId] : [];
    case 'reporter':
      return row.reporterId ? [row.reporterId] : [];
    case 'project_owner':
      return row.ownerId ? [row.ownerId] : [];
    case 'watchers':
      return listWatcherIds(taskId);
    case 'actor':
      return [ctx.userId];
    case 'user':
      return userId ? [userId] : [];
  }
}

function fill(template: string, taskLabel: string, projectName: string, event?: TaskEvent): string {
  return template
    .replaceAll('{task}', taskLabel)
    .replaceAll('{project}', projectName)
    .replaceAll('{stage}', event?.stage ?? 'a new stage')
    .replaceAll('{record}', event?.targetTitle ?? 'the linked record');
}

async function applyAction(
  autoCtx: DomainContext,
  originalCtx: DomainContext,
  action: AutomationAction,
  taskId: string,
  ruleName: string,
  event?: TaskEvent,
): Promise<string> {
  // Lazy imports avoid a module cycle (tasks.ts → automations.ts → tasks.ts).
  const taskApi = await import('./tasks');
  const [row] = await db
    .select({ number: tasks.number, title: tasks.title, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId, key: projects.key, projectName: projects.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId));
  if (!row) throw notFound('That task');
  const label = taskKey(row.key, row.number);
  switch (action.type) {
    case 'set_status':
      await taskApi.updateTask(autoCtx, taskId, { statusId: action.statusId });
      return `Moved ${label} to a new status`;
    case 'set_assignee': {
      const assigneeId =
        action.target === 'none'
          ? null
          : action.target === 'actor'
            ? originalCtx.userId
            : action.target === 'reporter'
              ? ((await resolvePeople('reporter', undefined, taskId, originalCtx))[0] ?? null)
              : (action.userId ?? null);
      await taskApi.updateTask(autoCtx, taskId, { assigneeId });
      return assigneeId ? `Assigned ${label}` : `Unassigned ${label}`;
    }
    case 'set_priority':
      await taskApi.updateTask(autoCtx, taskId, { priority: action.priority });
      return `Set ${label} priority to ${action.priority}`;
    case 'set_due_date':
      await taskApi.updateTask(autoCtx, taskId, { dueDate: addDaysIso(todayIso(), action.offsetDays) });
      return `Set the due date on ${label}`;
    case 'add_label':
      await taskApi.addTaskLabel(autoCtx, taskId, action.labelId);
      return `Added a label to ${label}`;
    case 'remove_label':
      await taskApi.removeTaskLabel(autoCtx, taskId, action.labelId);
      return `Removed a label from ${label}`;
    case 'move_to_section':
      await taskApi.updateTask(autoCtx, taskId, { sectionId: action.sectionId });
      return `Moved ${label} to another section`;
    case 'notify': {
      let recipients = await resolvePeople(action.target, action.userId, taskId, originalCtx);
      const taskLabel = `${label} ${row.title}`;
      let statusName: string | null = null;
      if (!action.message && event?.type === 'status_changed') {
        const [status] = await db.select({ name: statuses.name }).from(statuses).where(eq(statuses.id, event.task.statusId));
        statusName = status?.name ?? null;
      }
      // Headline says what happened; the rule name is the secondary line.
      const title = action.message ? fill(action.message, taskLabel, row.projectName, event) : automationEventHeadline(event, taskLabel, statusName);
      // Due-date rules share the built-in reminder's kind, so one overdue task gives one inbox
      // item per person per day: skip anyone already reminded today (ensureDueReminders does the
      // same check the other way round).
      const reminderKind = event?.type === 'overdue' || event?.type === 'due_soon' ? event.type : null;
      if (reminderKind && recipients.length > 0) {
        const already = await db
          .select({ userId: notifications.userId })
          .from(notifications)
          .where(
            and(
              eq(notifications.orgId, autoCtx.orgId),
              eq(notifications.taskId, taskId),
              eq(notifications.kind, reminderKind),
              inArray(notifications.userId, recipients),
              sql`${notifications.createdAt} >= current_date`,
            ),
          );
        const reminded = new Set(already.map((entry) => entry.userId));
        recipients = recipients.filter((id) => !reminded.has(id));
      }
      const sent = await notify(db, autoCtx, {
        recipients,
        kind: reminderKind ?? 'automation',
        title,
        body: `Automation: ${ruleName}`,
        url: routes.task(row.key, row.number),
        projectId: row.projectId,
        taskId,
      });
      return `Notified ${sent} ${sent === 1 ? 'person' : 'people'} about ${label}`;
    }
    case 'add_comment': {
      const { addComment } = await import('./comments');
      await addComment(autoCtx, { taskId, body: fill(action.body, label, row.projectName, event) });
      return `Commented on ${label}`;
    }
    case 'create_subtask':
      await taskApi.createSubtask(autoCtx, taskId, { title: action.title });
      return `Added a subtask to ${label}`;
    case 'add_watcher': {
      const people = await resolvePeople(action.target, action.userId, taskId, originalCtx);
      await addWatchers(db, autoCtx, taskId, people);
      return `Added followers to ${label}`;
    }
    case 'complete_parent': {
      if (!row.parentTaskId) return `${label} has no parent task`;
      const [done] = await db
        .select({ id: statuses.id })
        .from(statuses)
        .where(and(eq(statuses.projectId, row.projectId), eq(statuses.category, 'done')))
        .orderBy(sql`${statuses.position} COLLATE "C"`)
        .limit(1);
      if (!done) return 'No done status to move the parent to';
      await taskApi.updateTask(autoCtx, row.parentTaskId, { statusId: done.id });
      return `Marked the parent of ${label} done`;
    }
    case 'move_to_project': {
      if (row.parentTaskId) return `${label} is a subtask, so it stays with its parent`;
      if (action.projectId === row.projectId) return `${label} is already in that project`;
      const moved = await taskApi.moveTaskToProject(autoCtx, taskId, action.projectId);
      return `Moved ${label} to ${moved.key}`;
    }
    case 'create_follow_up': {
      const assigneeId =
        action.assignTo === 'none'
          ? null
          : action.assignTo === 'user'
            ? (action.userId ?? null)
            : ((await resolvePeople(action.assignTo === 'reporter' ? 'reporter' : 'assignee', undefined, taskId, originalCtx))[0] ?? null);
      const title = (cleanText(fill(action.title.replaceAll('{task}', row.title), label, row.projectName, event)) ?? `Follow up on ${row.title}`).slice(0, 500);
      const created = await taskApi.createTask(autoCtx, {
        projectId: action.projectId ?? row.projectId,
        title,
        description: `<p>Follow-up to ${label} “${row.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}”, created by the automation “${ruleName.replace(/</g, '&lt;')}”.</p>`,
        assigneeId,
        dueDate: action.dueInDays === undefined ? null : addDaysIso(todayIso(), action.dueInDays),
        at: 'top',
      });
      return `Created the follow-up task ${created.key}`;
    }
  }
}

/** Evaluate and execute rules for task events. Safe to call after any committed mutation. */
export async function runAutomationsForEvents(ctx: DomainContext, events: readonly TaskEvent[]): Promise<void> {
  const depth = ctx.automationDepth ?? 0;
  if (depth >= MAX_AUTOMATION_DEPTH || events.length === 0) return;
  const rules = await rulesFor(ctx, [...new Set(events.map((event) => event.task.projectId))]);
  if (rules.length === 0) return;
  const today = todayIso();
  const autoCtx: DomainContext = { ...ctx, actorKind: 'automation', userName: 'Automation', automationDepth: depth + 1 };
  const names = new Map(
    (await db.select({ id: automations.id, name: automations.name }).from(automations).where(inArray(automations.id, rules.map((r) => r.id)))).map(
      (r) => [r.id, r.name],
    ),
  );
  for (const event of events) {
    const planned = planAutomations(event, rules, today);
    if (planned.length === 0) continue;
    // Scheduled events repeat on every sweep: run each rule once per (task, key). Run events key
    // on the run id alone, so a run whose first build changed or went away never fires twice.
    let alreadyRan = new Set<string>();
    if (event.dedupeKey) {
      const byRun = event.type === 'run_done' || event.type === 'run_below_plan';
      const previous = await db
        .select({ automationId: automationRuns.automationId })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.orgId, ctx.orgId),
            byRun ? undefined : eq(automationRuns.taskId, event.task.id),
            inArray(automationRuns.automationId, planned.map((p) => p.ruleId)),
            sql`${automationRuns.detail} ->> 'dedupe' = ${event.dedupeKey}`,
          ),
        );
      alreadyRan = new Set(previous.map((p) => p.automationId));
    }
    for (const run of planned) {
      if (alreadyRan.has(run.ruleId)) continue;
      // A rule's own changes never set it off again (no loops like "subtask created → add subtask").
      if (ctx.automationChain?.includes(run.ruleId)) continue;
      const runCtx: DomainContext = { ...autoCtx, automationChain: [...(ctx.automationChain ?? []), run.ruleId] };
      const ruleName = names.get(run.ruleId) ?? 'Automation';
      const summaries: string[] = [];
      let status: 'success' | 'failed' = 'success';
      let errorMessage: string | undefined;
      for (const action of run.actions) {
        try {
          summaries.push(await applyAction(runCtx, ctx, action, event.task.id, ruleName, event));
        } catch (error) {
          status = 'failed';
          errorMessage = error instanceof Error ? error.message : String(error);
          break;
        }
      }
      await db.transaction(async (tx) => {
        await tx.insert(automationRuns).values({
          orgId: ctx.orgId,
          automationId: run.ruleId,
          taskId: event.task.id,
          status,
          summary: status === 'success' ? summaries.join('. ') : `Stopped: ${errorMessage}`,
          detail: {
            event: event.type,
            actions: run.actions.map((a) => a.type),
            error: errorMessage ?? null,
            dedupe: event.dedupeKey ?? null,
            stage: event.stage ?? null,
            target: event.targetTitle ?? null,
          },
        });
        await tx
          .update(automations)
          .set({ runCount: sql`${automations.runCount} + 1`, lastRunAt: new Date() })
          .where(eq(automations.id, run.ruleId));
        await logActivity(tx, autoCtx, {
          verb: 'automation.ran',
          entityType: 'automation',
          entityId: run.ruleId,
          projectId: event.task.projectId,
          taskId: event.task.id,
          meta: { name: ruleName, status, summary: summaries.join('. ') },
        });
      });
    }
  }
}
