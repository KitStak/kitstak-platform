/**
 * Writes into Projects from a sibling app: create a task linked to a record, link/unlink a
 * project or task, all with the same permission rules, numbering, ordering, activity log,
 * watchers and notifications as the Projects domain layer. Automations for the new task run
 * in Projects when it drains the `task_created` event this writes (pm.integration_events).
 */
import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { BridgeError, orgRoleOf, projectAccess } from './access';
import { isUuid, pmAvailability, query, queryOne, storedLinkPath, type BridgeExecutor } from './executor';
import { canEditProject } from './permissions';
import { loadTasks, taskUrl } from './read';
import {
  BRIDGE_TARGET_TYPES,
  type BridgeActor,
  type BridgeLinkSnapshot,
  type BridgePriority,
  type BridgeSource,
  type BridgeUrls,
  type CreateExternalTaskInput,
  type CreatedExternalTask,
} from './types';

const PRIORITIES: readonly BridgePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_LABEL: Readonly<Record<BridgeSource, string>> = { crm: 'CRM', wms: 'WMS', portal: 'Portal' };

function validDate(value: string | null | undefined, field: string): string | null {
  if (!value) return null;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BridgeError('VALIDATION', 'Pick a real date.', { [field]: 'Pick a real date.' });
  }
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Plain text → the sanitized-HTML shape Projects stores (one paragraph per line). */
export function plainTextToHtml(text: string | null | undefined): string | null {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
  if (!lines.some(Boolean)) return null;
  return lines.map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>')).join('');
}

function assertTarget(link: BridgeLinkSnapshot): void {
  if (!(BRIDGE_TARGET_TYPES as readonly string[]).includes(link.type) || !link.id) {
    throw new BridgeError('VALIDATION', 'That record can’t be linked.');
  }
}

async function requireInstalled(db: BridgeExecutor): Promise<{ events: boolean }> {
  const availability = await pmAvailability(db);
  if (!availability.installed) throw new BridgeError('UNAVAILABLE', 'KitStak Projects isn’t set up for this workspace yet.');
  return { events: availability.events };
}

async function actorName(db: BridgeExecutor, userId: string): Promise<string> {
  const row = await queryOne<{ name: string | null; email: string }>(db, sql`select name, email from core."user" where id = ${userId}::uuid`);
  return row?.name || row?.email || 'Someone';
}

async function isActiveMember(db: BridgeExecutor, orgId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    db,
    sql`select exists (select 1 from core.member where organization_id = ${orgId}::uuid and user_id = ${userId}::uuid
                        and role not like 'deactivated:%') as ok`,
  );
  return row?.ok === true;
}

async function insertLink(
  tx: BridgeExecutor,
  actor: BridgeActor,
  owner: { readonly taskId: string } | { readonly projectId: string },
  link: BridgeLinkSnapshot,
): Promise<{ id: string; created: boolean }> {
  const taskId = 'taskId' in owner ? owner.taskId : null;
  const projectId = 'projectId' in owner ? owner.projectId : null;
  const inserted = await queryOne<{ id: string }>(
    tx,
    sql`insert into pm.integration_links (org_id, project_id, task_id, target_type, target_id, cached_title, cached_status, cached_url, cached_at, meta, created_by)
        values (${actor.orgId}::uuid, ${projectId}::uuid, ${taskId}::uuid, ${link.type}, ${link.id}, ${link.title.slice(0, 300)},
                ${link.status ?? null}, ${storedLinkPath(link.url)}, now(), ${JSON.stringify(link.meta ?? {})}::jsonb, ${actor.userId}::uuid)
        on conflict do nothing
        returning id`,
  );
  if (inserted) return { id: inserted.id, created: true };
  const existing = await queryOne<{ id: string }>(
    tx,
    sql`select id from pm.integration_links
         where ${taskId ? sql`task_id = ${taskId}::uuid` : sql`project_id = ${projectId}::uuid`}
           and target_type = ${link.type} and target_id = ${link.id}`,
  );
  if (!existing) throw new BridgeError('VALIDATION', 'That record couldn’t be linked. Try again.');
  return { id: existing.id, created: false };
}

async function logActivity(
  tx: BridgeExecutor,
  actor: BridgeActor,
  entry: {
    readonly verb: string;
    readonly entityType: 'task' | 'project';
    readonly entityId: string;
    readonly projectId: string;
    readonly taskId: string | null;
    readonly before?: unknown;
    readonly after?: unknown;
    readonly meta?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.execute(
    sql`insert into pm.activity (org_id, project_id, task_id, actor_id, actor_kind, verb, entity_type, entity_id, before, after, meta)
        values (${actor.orgId}::uuid, ${entry.projectId}::uuid, ${entry.taskId}::uuid, ${actor.userId}::uuid, 'user', ${entry.verb},
                ${entry.entityType}, ${entry.entityId}::uuid,
                ${entry.before === undefined ? null : JSON.stringify(entry.before)}::jsonb,
                ${entry.after === undefined ? null : JSON.stringify(entry.after)}::jsonb,
                ${JSON.stringify(entry.meta ?? {})}::jsonb)`,
  );
}

/** Creates a task in a Projects project, linked to the sibling-app record it came from. */
export async function createTaskFromExternal(
  db: BridgeExecutor,
  actor: BridgeActor,
  input: CreateExternalTaskInput,
  urls: BridgeUrls,
): Promise<CreatedExternalTask> {
  const { events } = await requireInstalled(db);
  assertTarget(input.link);
  if (!isUuid(input.projectId)) throw new BridgeError('VALIDATION', 'Pick a project.', { projectId: 'Pick a project.' });
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!title) throw new BridgeError('VALIDATION', 'Give the task a name.', { title: 'Give the task a name.' });
  if (title.length > 500) throw new BridgeError('VALIDATION', 'Task names can be up to 500 characters.', { title: 'Too long.' });
  const priority = input.priority ?? 'none';
  if (!PRIORITIES.includes(priority)) throw new BridgeError('VALIDATION', 'Pick a priority.', { priority: 'Pick a priority.' });
  const dueDate = validDate(input.dueDate, 'dueDate');
  const startDate = validDate(input.startDate, 'startDate');
  if (startDate && dueDate && startDate > dueDate) {
    throw new BridgeError('VALIDATION', 'The start date must be on or before the due date.', { dueDate: 'Must be on or after the start date.' });
  }
  const orgRole = await orgRoleOf(db, actor);
  if (!orgRole) throw new BridgeError('FORBIDDEN', 'You’re not a member of this workspace.');
  const { project, role } = await projectAccess(db, actor, input.projectId, orgRole);
  if (!canEditProject(role)) throw new BridgeError('FORBIDDEN', `You can view ${project.name} but not add tasks to it. Ask a project owner for edit access.`);
  if (project.archived) throw new BridgeError('VALIDATION', `${project.name} is archived. Restore it in Projects to add tasks.`);
  const assigneeId = input.assigneeId || null;
  if (assigneeId && !(await isActiveMember(db, actor.orgId, assigneeId))) {
    throw new BridgeError('VALIDATION', 'That person isn’t in this workspace.', { assigneeId: 'Pick someone in this workspace.' });
  }
  const name = await actorName(db, actor.userId);

  const result = await db.transaction(async (tx) => {
    const statuses = await query<{ id: string; category: string; is_default: boolean }>(
      tx,
      sql`select id, category, is_default from pm.statuses where project_id = ${project.id}::uuid order by position collate "C"`,
    );
    const status = input.statusId
      ? statuses.find((s) => s.id === input.statusId)
      : (statuses.find((s) => s.is_default) ?? statuses.find((s) => s.category === 'todo') ?? statuses[0]);
    if (!status) throw new BridgeError('VALIDATION', 'That status isn’t part of this project.', { statusId: 'Pick a status.' });
    const seq = await queryOne<{ task_seq: number }>(
      tx,
      sql`update pm.projects set task_seq = task_seq + 1, updated_at = now() where id = ${project.id}::uuid returning task_seq`,
    );
    if (!seq) throw new BridgeError('NOT_FOUND', 'That project no longer exists.');
    const number = Number(seq.task_seq);
    const last = await queryOne<{ position: string }>(
      tx,
      sql`select position from pm.tasks where project_id = ${project.id}::uuid and parent_task_id is null
           order by position collate "C" desc limit 1`,
    );
    const position = generateKeyBetween(last?.position ?? null, null);
    const closed = status.category === 'done' || status.category === 'cancelled';
    const task = await queryOne<{ id: string }>(
      tx,
      sql`insert into pm.tasks (org_id, project_id, number, title, description, status_id, priority, assignee_id, reporter_id,
                                start_date, due_date, position, completed_at, created_by)
          values (${actor.orgId}::uuid, ${project.id}::uuid, ${number}, ${title}, ${plainTextToHtml(input.description)},
                  ${status.id}::uuid, ${priority}, ${assigneeId}::uuid, ${actor.userId}::uuid,
                  ${startDate}::date, ${dueDate}::date, ${position}, ${closed ? sql`now()` : sql`null`}, ${actor.userId}::uuid)
          returning id`,
    );
    if (!task) throw new BridgeError('VALIDATION', 'The task couldn’t be created. Try again.');
    const watcherIds = [...new Set([actor.userId, assigneeId].filter((id): id is string => Boolean(id)))];
    for (const userId of watcherIds) {
      await tx.execute(
        sql`insert into pm.watchers (task_id, user_id, org_id) values (${task.id}::uuid, ${userId}::uuid, ${actor.orgId}::uuid) on conflict do nothing`,
      );
    }
    const via = { source: input.source, target: { type: input.link.type, id: input.link.id, title: input.link.title } };
    await logActivity(tx, actor, {
      verb: 'task.created',
      entityType: 'task',
      entityId: task.id,
      projectId: project.id,
      taskId: task.id,
      after: { title, number, statusId: status.id, parentTaskId: null },
      meta: { createdFrom: via },
    });
    const link = await insertLink(tx, actor, { taskId: task.id }, input.link);
    await logActivity(tx, actor, {
      verb: 'task.link_added',
      entityType: 'task',
      entityId: task.id,
      projectId: project.id,
      taskId: task.id,
      after: { targetType: input.link.type, targetId: input.link.id, title: input.link.title },
    });
    if (assigneeId && assigneeId !== actor.userId) {
      const muted = await queryOne<{ muted: boolean }>(
        tx,
        sql`select coalesce((prefs -> 'notifications' ->> 'assigned') = 'false', false) as muted from pm.user_prefs
             where org_id = ${actor.orgId}::uuid and user_id = ${assigneeId}::uuid`,
      );
      if (!muted?.muted) {
        const key = `${project.key}-${number}`;
        await tx.execute(
          sql`insert into pm.notifications (org_id, user_id, actor_id, kind, project_id, task_id, title, body, url)
              values (${actor.orgId}::uuid, ${assigneeId}::uuid, ${actor.userId}::uuid, 'assigned', ${project.id}::uuid, ${task.id}::uuid,
                      ${`${name} assigned you ${key}: ${title}`.slice(0, 300)},
                      ${`From ${SOURCE_LABEL[input.source]}: ${input.link.title}`.slice(0, 1000)},
                      ${`/p/${project.key}/${number}`})`,
        );
      }
    }
    if (events) {
      await tx.execute(
        sql`insert into pm.integration_events (org_id, source, kind, target_type, target_id, task_id, title, after_status, url, actor_id)
            values (${actor.orgId}::uuid, ${input.source}, 'task_created', ${input.link.type}, ${input.link.id}, ${task.id}::uuid,
                    ${input.link.title.slice(0, 300)}, ${input.link.status ?? null}, ${input.link.url ?? null}, ${actor.userId}::uuid)`,
      );
    }
    return { taskId: task.id, linkId: link.id, number };
  });

  const [task] = await loadTasks(db, actor.orgId, sql`l.id = ${result.linkId}::uuid`, urls, 1);
  if (!task) {
    // Visible to the creator by construction; fall back to a minimal shape rather than failing.
    throw new BridgeError('NOT_FOUND', `Created ${project.key}-${result.number}, but it couldn’t be loaded. Open ${taskUrl(urls, project.key, result.number)}.`);
  }
  return { task, linkId: result.linkId };
}

/** Links an existing project to a record (CRM "Link a project"). Idempotent. */
export async function linkProjectToRecord(
  db: BridgeExecutor,
  actor: BridgeActor,
  projectId: string,
  link: BridgeLinkSnapshot,
): Promise<{ linkId: string; created: boolean }> {
  await requireInstalled(db);
  assertTarget(link);
  if (!isUuid(projectId)) throw new BridgeError('VALIDATION', 'Pick a project.');
  const { project, role } = await projectAccess(db, actor, projectId);
  if (!canEditProject(role)) throw new BridgeError('FORBIDDEN', `You can view ${project.name} but not change it.`);
  return db.transaction(async (tx) => {
    const result = await insertLink(tx, actor, { projectId: project.id }, link);
    if (result.created) {
      await logActivity(tx, actor, {
        verb: 'task.link_added',
        entityType: 'project',
        entityId: project.id,
        projectId: project.id,
        taskId: null,
        after: { targetType: link.type, targetId: link.id, title: link.title },
      });
      if (link.type === 'core_customer' && isUuid(link.id)) {
        await tx.execute(sql`update pm.projects set crm_customer_id = ${link.id}::uuid where id = ${project.id}::uuid and crm_customer_id is null`);
      }
      if ((link.type === 'crm_item' || link.type === 'crm_account') && isUuid(link.id)) {
        await tx.execute(sql`update pm.projects set crm_item_id = ${link.id}::uuid where id = ${project.id}::uuid and crm_item_id is null`);
      }
    }
    return { linkId: result.id, created: result.created };
  });
}

/** Removes a task- or project-level link (the task/project itself stays). */
export async function removeLink(db: BridgeExecutor, actor: BridgeActor, linkId: string): Promise<void> {
  await requireInstalled(db);
  if (!isUuid(linkId)) throw new BridgeError('NOT_FOUND', 'That link no longer exists.');
  const link = await queryOne<{ id: string; project_id: string | null; task_id: string | null; task_project_id: string | null; target_type: string; target_id: string; cached_title: string | null }>(
    db,
    sql`select l.id, l.project_id, l.task_id, t.project_id as task_project_id, l.target_type, l.target_id, l.cached_title
          from pm.integration_links l left join pm.tasks t on t.id = l.task_id
         where l.id = ${linkId}::uuid and l.org_id = ${actor.orgId}::uuid`,
  );
  if (!link) throw new BridgeError('NOT_FOUND', 'That link no longer exists.');
  const projectId = link.project_id ?? link.task_project_id;
  if (!projectId) throw new BridgeError('NOT_FOUND', 'That link no longer exists.');
  const { role } = await projectAccess(db, actor, projectId);
  if (!canEditProject(role)) throw new BridgeError('FORBIDDEN', 'You can view this project but not change it.');
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from pm.integration_links where id = ${linkId}::uuid`);
    // Unlinking a project from its primary CRM record also clears the project's pointer.
    if (link.project_id) {
      await tx.execute(
        sql`update pm.projects set crm_item_id = null where id = ${link.project_id}::uuid and crm_item_id::text = ${link.target_id}`,
      );
      await tx.execute(
        sql`update pm.projects set crm_customer_id = null where id = ${link.project_id}::uuid and crm_customer_id::text = ${link.target_id}`,
      );
    }
    await logActivity(tx, actor, {
      verb: 'task.link_removed',
      entityType: link.task_id ? 'task' : 'project',
      entityId: link.task_id ?? projectId,
      projectId,
      taskId: link.task_id,
      before: { targetType: link.target_type, targetId: link.target_id, title: link.cached_title },
    });
  });
}
