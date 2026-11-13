/**
 * Reads: "what in Projects is linked to this CRM deal / WMS order?" and pickers for creating
 * tasks. Every read respects the actor's project visibility and returns empty results (never
 * throws) when the pm schema is missing.
 */
import { sql, type SQL } from 'drizzle-orm';
import { orgRoleOf, visibleProjects } from './access';
import { isUuid, list, pmAvailability, query, queryOne, type BridgeExecutor } from './executor';
import { canEditProject, effectiveProjectRole, isProjectRole } from './permissions';
import type {
  BridgeActor,
  BridgeHealth,
  BridgePerson,
  BridgePriority,
  BridgeProject,
  BridgeProjectStatus,
  BridgeStatusCategory,
  BridgeTarget,
  BridgeTask,
  BridgeUrls,
  LinkedWork,
  WritableProject,
} from './types';

const EMPTY: LinkedWork = { projects: [], tasks: [], openTasks: 0 };
const CRM_TYPES = new Set(['crm_item', 'crm_account']);

export function projectsBase(urls: BridgeUrls): string {
  return urls.projectsUrl.replace(/\/+$/, '');
}

export function projectUrl(urls: BridgeUrls, key: string): string {
  return `${projectsBase(urls)}/p/${encodeURIComponent(key)}`;
}

export function taskUrl(urls: BridgeUrls, key: string, number: number): string {
  return `${projectsBase(urls)}/p/${encodeURIComponent(key)}/${number}`;
}

function person(id: string | null, name: string | null, email: string | null, image: string | null): BridgePerson | null {
  return id ? { id, name: name || email || 'Someone', email: email ?? '', image } : null;
}

function targetMatch(alias: string, targets: readonly BridgeTarget[]): SQL {
  const a = sql.raw(alias);
  return sql`(${sql.join(
    targets.map((target) => sql`(${a}.target_type = ${target.type} and ${a}.target_id = ${target.id})`),
    sql` or `,
  )})`;
}

function cleanTargets(targets: readonly BridgeTarget[]): BridgeTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.type}:${target.id}`;
    if (!target.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ProjectQueryRow {
  id: string;
  key: string;
  name: string;
  status: BridgeProjectStatus;
  health: BridgeHealth;
  color: string;
  icon: string;
  due_date: string | null;
  archived: boolean;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_image: string | null;
  total: number | string;
  done: number | string;
  overdue: number | string;
}

async function loadProjects(db: BridgeExecutor, orgId: string, where: SQL, urls: BridgeUrls): Promise<Omit<BridgeProject, 'linkId'>[]> {
  const rows = await query<ProjectQueryRow>(
    db,
    sql`select p.id, p.key, p.name, p.status, p.health, p.color, p.icon, p.due_date::text as due_date,
               p.archived_at is not null as archived,
               u.id as owner_id, u.name as owner_name, u.email as owner_email, u.image as owner_image,
               coalesce(pr.total, 0) as total, coalesce(pr.done, 0) as done, coalesce(pr.overdue, 0) as overdue
          from pm.projects p
          left join core."user" u on u.id = p.owner_id
          left join lateral (
            select count(*) filter (where s.category <> 'cancelled')::int as total,
                   count(*) filter (where s.category = 'done')::int as done,
                   count(*) filter (where s.category not in ('done', 'cancelled') and t.due_date < current_date)::int as overdue
              from pm.tasks t join pm.statuses s on s.id = t.status_id
             where t.project_id = p.id and t.deleted_at is null and t.parent_task_id is null
          ) pr on true
         where p.org_id = ${orgId}::uuid and p.is_template = false and ${where}
         order by (p.archived_at is not null), (p.status = 'completed'), p.name
         limit 50`,
  );
  return rows.map((row) => {
    const total = Number(row.total);
    const done = Number(row.done);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      status: row.status,
      health: row.health,
      color: row.color,
      icon: row.icon,
      dueDate: row.due_date,
      archived: row.archived === true,
      owner: person(row.owner_id, row.owner_name, row.owner_email, row.owner_image),
      progress: { total, done, overdue: Number(row.overdue), percent: total === 0 ? 0 : Math.round((done / total) * 100) },
      url: projectUrl(urls, row.key),
    };
  });
}

interface TaskQueryRow {
  link_id: string;
  id: string;
  number: number;
  title: string;
  priority: BridgePriority;
  due_date: string | null;
  overdue: boolean;
  project_id: string;
  project_key: string;
  project_name: string;
  project_color: string;
  status_id: string;
  status_name: string;
  status_category: BridgeStatusCategory;
  status_color: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assignee_image: string | null;
}

export async function loadTasks(db: BridgeExecutor, orgId: string, where: SQL, urls: BridgeUrls, limit = 200): Promise<BridgeTask[]> {
  const rows = await query<TaskQueryRow>(
    db,
    sql`select l.id as link_id, t.id, t.number, t.title, t.priority, t.due_date::text as due_date,
               (t.due_date < current_date and s.category not in ('done', 'cancelled')) as overdue,
               p.id as project_id, p.key as project_key, p.name as project_name, p.color as project_color,
               s.id as status_id, s.name as status_name, s.category as status_category, s.color as status_color,
               a.id as assignee_id, a.name as assignee_name, a.email as assignee_email, a.image as assignee_image
          from pm.integration_links l
          join pm.tasks t on t.id = l.task_id
          join pm.projects p on p.id = t.project_id
          join pm.statuses s on s.id = t.status_id
          left join core."user" a on a.id = t.assignee_id
         where l.org_id = ${orgId}::uuid and t.deleted_at is null and ${where}
         order by (s.category in ('done', 'cancelled')), t.due_date nulls last, t.created_at desc
         limit ${limit}`,
  );
  const seen = new Set<string>();
  const tasks: BridgeTask[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const done = row.status_category === 'done' || row.status_category === 'cancelled';
    tasks.push({
      id: row.id,
      key: `${row.project_key}-${row.number}`,
      number: Number(row.number),
      title: row.title,
      projectId: row.project_id,
      projectKey: row.project_key,
      projectName: row.project_name,
      projectColor: row.project_color,
      status: { id: row.status_id, name: row.status_name, category: row.status_category, color: row.status_color },
      priority: row.priority,
      assignee: person(row.assignee_id, row.assignee_name, row.assignee_email, row.assignee_image),
      dueDate: row.due_date,
      done,
      overdue: row.overdue === true,
      linkId: row.link_id,
      url: taskUrl(urls, row.project_key, Number(row.number)),
    });
  }
  return tasks;
}

/**
 * Projects and tasks linked to any of `targets` (e.g. a CRM account and its shared customer).
 * Projects also match through their own `crm_item_id` / `crm_customer_id` fields.
 */
export async function listLinkedWork(
  db: BridgeExecutor,
  actor: BridgeActor,
  targets: readonly BridgeTarget[],
  urls: BridgeUrls,
): Promise<LinkedWork> {
  const wanted = cleanTargets(targets);
  if (wanted.length === 0 || !(await pmAvailability(db)).installed) return EMPTY;
  try {
    const role = await orgRoleOf(db, actor);
    if (!role) return EMPTY;
    const visible = visibleProjects(role, actor.userId);
    const linkRows = await query<{ id: string; project_id: string }>(
      db,
      sql`select l.id, l.project_id from pm.integration_links l
           where l.org_id = ${actor.orgId}::uuid and l.project_id is not null and ${targetMatch('l', wanted)}`,
    );
    const crmIds = wanted.filter((t) => CRM_TYPES.has(t.type) && isUuid(t.id)).map((t) => t.id);
    const customerIds = wanted.filter((t) => t.type === 'core_customer' && isUuid(t.id)).map((t) => t.id);
    const direct: SQL[] = [];
    if (crmIds.length) direct.push(sql`p.crm_item_id::text in ${list(crmIds)}`);
    if (customerIds.length) direct.push(sql`p.crm_customer_id::text in ${list(customerIds)}`);
    const linkedIds = [...new Set(linkRows.map((row) => row.project_id))];
    if (linkedIds.length) direct.push(sql`p.id::text in ${list(linkedIds)}`);
    const [projectRows, tasks] = await Promise.all([
      direct.length
        ? loadProjects(db, actor.orgId, sql`${visible} and (${sql.join(direct, sql` or `)})`, urls)
        : Promise.resolve([]),
      loadTasks(db, actor.orgId, sql`${targetMatch('l', wanted)} and ${visible}`, urls),
    ]);
    const linkByProject = new Map(linkRows.map((row) => [row.project_id, row.id]));
    return {
      projects: projectRows.map((project) => ({ ...project, linkId: linkByProject.get(project.id) ?? null })),
      tasks,
      openTasks: tasks.filter((task) => !task.done).length,
    };
  } catch (error) {
    console.warn('[pm-bridge] listLinkedWork failed', error);
    return EMPTY;
  }
}

export interface LinkedCounts {
  readonly tasks: number;
  readonly openTasks: number;
  readonly projects: number;
}

/** Linked task/project counts for many records of one type (list badges). */
export async function countLinkedWork(
  db: BridgeExecutor,
  actor: BridgeActor,
  type: BridgeTarget['type'],
  ids: readonly string[],
): Promise<Record<string, LinkedCounts>> {
  const wanted = [...new Set(ids.filter(Boolean))].slice(0, 500);
  if (wanted.length === 0 || !(await pmAvailability(db)).installed) return {};
  try {
    const role = await orgRoleOf(db, actor);
    if (!role) return {};
    const rows = await query<{ target_id: string; tasks: number | string; open_tasks: number | string; projects: number | string }>(
      db,
      sql`select l.target_id,
                 count(*) filter (where l.task_id is not null)::int as tasks,
                 count(*) filter (where l.task_id is not null and s.category not in ('done', 'cancelled'))::int as open_tasks,
                 count(*) filter (where l.project_id is not null)::int as projects
            from pm.integration_links l
            left join pm.tasks t on t.id = l.task_id
            left join pm.statuses s on s.id = t.status_id
            join pm.projects p on p.id = coalesce(l.project_id, t.project_id)
           where l.org_id = ${actor.orgId}::uuid and l.target_type = ${type} and l.target_id in ${list(wanted)}
             and (l.task_id is null or t.deleted_at is null) and ${visibleProjects(role, actor.userId)}
           group by l.target_id`,
    );
    return Object.fromEntries(
      rows.map((row) => [row.target_id, { tasks: Number(row.tasks), openTasks: Number(row.open_tasks), projects: Number(row.projects) }]),
    );
  } catch (error) {
    console.warn('[pm-bridge] countLinkedWork failed', error);
    return {};
  }
}

/** Projects the actor can add tasks to, best matches first (create-task pickers). */
export async function listWritableProjects(
  db: BridgeExecutor,
  actor: BridgeActor,
  options: { readonly query?: string; readonly limit?: number } = {},
): Promise<WritableProject[]> {
  if (!(await pmAvailability(db)).installed) return [];
  try {
    const role = await orgRoleOf(db, actor);
    if (!role) return [];
    const term = (options.query ?? '').trim();
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await query<{
      id: string;
      key: string;
      name: string;
      color: string;
      icon: string;
      visibility: string;
      owner_id: string | null;
      member_role: string | null;
      space_name: string | null;
    }>(
      db,
      sql`select p.id, p.key, p.name, p.color, p.icon, p.visibility, p.owner_id, sp.name as space_name,
                 (select m.role from pm.project_members m where m.project_id = p.id and m.user_id = ${actor.userId}::uuid) as member_role
            from pm.projects p
            left join pm.spaces sp on sp.id = p.space_id and sp.deleted_at is null
           where p.org_id = ${actor.orgId}::uuid and p.archived_at is null and p.is_template = false
             and p.status not in ('completed', 'archived') and ${visibleProjects(role, actor.userId)}
             ${term ? sql`and (p.name ilike ${like} or p.key ilike ${like})` : sql``}
           order by (select max(r.visited_at) from pm.recents r where r.user_id = ${actor.userId}::uuid and r.entity_id = p.id) desc nulls last,
                    p.name
           limit 200`,
    );
    const writable = rows
      .filter((row) =>
        canEditProject(
          effectiveProjectRole({
            orgRole: role,
            memberRole: isProjectRole(row.member_role) ? row.member_role : null,
            visibility: row.visibility,
            isProjectOwner: row.owner_id === actor.userId,
          }),
        ),
      )
      .slice(0, Math.min(options.limit ?? 50, 100));
    if (writable.length === 0) return [];
    const statuses = await query<{ project_id: string; id: string; name: string; category: BridgeStatusCategory; color: string }>(
      db,
      sql`select project_id, id, name, category, color from pm.statuses
           where project_id::text in ${list(writable.map((row) => row.id))}
           order by position collate "C"`,
    );
    return writable.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      color: row.color,
      icon: row.icon,
      spaceName: row.space_name,
      statuses: statuses
        .filter((status) => status.project_id === row.id)
        .map((status) => ({ id: status.id, name: status.name, category: status.category, color: status.color })),
    }));
  } catch (error) {
    console.warn('[pm-bridge] listWritableProjects failed', error);
    return [];
  }
}

/** Active members of the org (assignee pickers). */
export async function listOrgPeople(db: BridgeExecutor, orgId: string): Promise<BridgePerson[]> {
  try {
    // System accounts (WMS `is_api_user`, e.g. the shared Integration Service login) are not teammates.
    const wmsUsers = await queryOne<{ ok: boolean }>(db, sql`select to_regclass('wms.users') is not null as ok`);
    const notService = wmsUsers?.ok
      ? sql`and lower(u.email) not in (select lower(w.email) from wms.users w where w.is_api_user = true)`
      : sql``;
    const rows = await query<{ id: string; name: string | null; email: string; image: string | null }>(
      db,
      sql`select u.id, u.name, u.email, u.image from core.member m join core."user" u on u.id = m.user_id
           where m.organization_id = ${orgId}::uuid and m.role not like 'deactivated:%' ${notService}
           order by lower(coalesce(nullif(u.name, ''), u.email)) limit 500`,
    );
    return rows.map((row) => person(row.id, row.name, row.email, row.image) as BridgePerson);
  } catch (error) {
    console.warn('[pm-bridge] listOrgPeople failed', error);
    return [];
  }
}
