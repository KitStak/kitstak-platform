/**
 * Projects reader: projects a person may see, and logged time per day for linked projects.
 * Read only, fail soft: when Projects is not licensed, not installed, or anything goes wrong,
 * every function answers with an empty list. Pulse never writes into `pm.*` here.
 *
 * Time comes from `pm.time_entries`: finished entries only (`ended_at` set, not deleted), summed
 * per day in the site's time zone. Projects stores no pay rate. Pulse costs the hours with its
 * own labor rate.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { scoped } from '@/server/db/scope';
import { rows, type DomainContext } from '@/server/domain/_shared';
import { integrationAvailability, tableExists, siblingDb } from './detect';
import { logSoftFail } from './log';

export interface PmProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: string;
  readonly health: string;
  readonly dueDate: string | null;
  readonly coreCustomerId: string | null;
  readonly crmItemId: string | null;
  /** Share of top level tasks that are done, 0 to 100, or null with no tasks. */
  readonly percentDone: number | null;
  /** Path inside the Projects app. */
  readonly path: string;
}

export interface PmTimeDay {
  readonly projectId: string;
  readonly workDate: string;
  readonly minutes: number;
  /** Distinct people who logged time that day. */
  readonly people: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const projectsReady = scoped(async function projectsReady(ctx: DomainContext): Promise<boolean> {
  try {
    if (!(await integrationAvailability(ctx)).projects) return false;
    return (await tableExists('pm.projects')) && (await tableExists('pm.tasks')) && (await tableExists('pm.time_entries'));
  } catch (error) {
    logSoftFail(ctx.orgId, 'projects.projectsReady', error);
    return false;
  }
});

/** Projects the reader can see in Projects itself: owners and admins all, others the org visible ones plus their own. */
function visible(ctx: DomainContext): SQL {
  if (ctx.actorKind !== 'user' || ctx.orgRole === 'owner' || ctx.orgRole === 'admin') return sql`true`;
  const mine = sql`(p.owner_id = ${ctx.userId} or exists (select 1 from pm.project_members m where m.project_id = p.id and m.user_id = ${ctx.userId}))`;
  return ctx.orgRole === 'guest' ? mine : sql`(p.visibility = 'org' or ${mine})`;
}

async function projectRows(ctx: DomainContext, where: SQL, limit: number): Promise<PmProject[]> {
  const found = await rows<{
    id: string;
    key: string;
    name: string;
    status: string;
    health: string;
    due_date: string | null;
    core_customer_id: string | null;
    crm_item_id: string | null;
    total: number;
    done: number;
  }>(
    siblingDb,
    sql`select p.id::text as id, p.key, p.name, p.status, p.health, p.due_date::text as due_date,
               p.crm_customer_id::text as core_customer_id, p.crm_item_id::text as crm_item_id,
               (select count(*)::int from pm.tasks t where t.project_id = p.id and t.deleted_at is null and t.parent_task_id is null) as total,
               (select count(*)::int from pm.tasks t join pm.statuses s on s.id = t.status_id
                 where t.project_id = p.id and t.deleted_at is null and t.parent_task_id is null and s.category = 'done') as done
          from pm.projects p
         where p.org_id = ${ctx.orgId} and p.deleted_at is null and p.is_template = false and ${visible(ctx)} and ${where}
         order by (p.status in ('completed', 'archived')), p.updated_at desc
         limit ${limit}`,
  );
  return found.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    health: row.health,
    dueDate: row.due_date,
    coreCustomerId: row.core_customer_id,
    crmItemId: row.crm_item_id,
    percentDone: row.total > 0 ? Math.round((row.done / row.total) * 100) : null,
    path: `/p/${row.key}`,
  }));
}

export const getProjects = scoped(async function getProjects(ctx: DomainContext, ids: readonly string[]): Promise<PmProject[]> {
  const clean = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (clean.length === 0 || !(await projectsReady(ctx))) return [];
  try {
    return await projectRows(ctx, sql`p.id in (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})`, clean.length);
  } catch (error) {
    logSoftFail(ctx.orgId, 'projects.getProjects', error);
    return [];
  }
});

export const searchProjects = scoped(async function searchProjects(ctx: DomainContext, query: string, limit = 12): Promise<PmProject[]> {
  if (!(await projectsReady(ctx))) return [];
  try {
    const text = query.trim().slice(0, 80);
    return await projectRows(ctx, text ? sql`(p.name ilike ${`%${text}%`} or p.key ilike ${`${text}%`})` : sql`true`, Math.min(limit, 50));
  } catch (error) {
    logSoftFail(ctx.orgId, 'projects.searchProjects', error);
    return [];
  }
});

/**
 * Finished time entries of the given projects, summed per day in `timezone`. A day is the day
 * the entry started. Entries still running and deleted entries are left out. With
 * `throwOnError` a failed read throws (after the log line) instead of reading as "no time", for a
 * caller that takes rows away when time is gone.
 */
export const projectTimeByDay = scoped(async function projectTimeByDay(ctx: DomainContext, projectIds: readonly string[], timezone: string, options: { throwOnError?: boolean } = {}): Promise<PmTimeDay[]> {
  const clean = [...new Set(projectIds.filter((id) => UUID.test(id)))];
  if (clean.length === 0 || !(await projectsReady(ctx))) return [];
  try {
    const found = await rows<{ project_id: string; work_date: string; minutes: number; people: number }>(
      siblingDb,
      sql`select te.project_id::text as project_id, ((te.started_at at time zone ${timezone})::date)::text as work_date,
                 sum(te.duration_minutes)::int as minutes, count(distinct te.user_id)::int as people
            from pm.time_entries te
           where te.org_id = ${ctx.orgId} and te.deleted_at is null and te.ended_at is not null and coalesce(te.duration_minutes, 0) > 0
             and te.project_id in (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})
           group by 1, 2
           order by 1, 2`,
    );
    return found.map((row) => ({ projectId: row.project_id, workDate: row.work_date, minutes: Number(row.minutes) || 0, people: Number(row.people) || 0 }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'projects.projectTimeByDay', error);
    if (options.throwOnError) throw error;
    return [];
  }
});

export interface PmTask {
  readonly id: string;
  readonly projectId: string;
  readonly projectKey: string;
  /** Task number inside its project, like 12 in ADV-12. */
  readonly number: number;
  readonly title: string;
  /** True when its status is in the done group. */
  readonly done: boolean;
  /** True when the task was deleted in Projects. Kept so old entries still show its name. */
  readonly gone: boolean;
}

/**
 * The tasks of the given projects, for tagging production entries (0014). Read as the system:
 * the job's link to the project already decides who works on it, so the picker is the same for
 * everyone who can log the job. Deleted tasks are left out unless their id is in `keepIds`
 * (an entry already points at it, so its name must still show). Fail soft: an empty list.
 */
export const tasksOfProjects = scoped(async function tasksOfProjects(ctx: DomainContext, projectIds: readonly string[], keepIds: readonly string[] = []): Promise<PmTask[]> {
  const clean = [...new Set(projectIds.filter((id) => UUID.test(id)))];
  if (clean.length === 0 || !(await projectsReady(ctx))) return [];
  const keep = [...new Set(keepIds.filter((id) => UUID.test(id)))];
  const kept = keep.length > 0 ? sql`or t.id in (${sql.join(keep.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  try {
    const found = await rows<{ id: string; project_id: string; key: string; number: number; title: string; done: boolean; gone: boolean }>(
      siblingDb,
      sql`select t.id::text as id, t.project_id::text as project_id, p.key, t.number, t.title,
                 coalesce(s.category = 'done', false) as done, (t.deleted_at is not null) as gone
            from pm.tasks t
            join pm.projects p on p.id = t.project_id
            left join pm.statuses s on s.id = t.status_id
           where t.org_id = ${ctx.orgId}
             and t.project_id in (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})
             and (t.deleted_at is null ${kept})
           order by p.key, t.position, t.number`,
    );
    return found.map((row) => ({ id: row.id, projectId: row.project_id, projectKey: row.key, number: Number(row.number), title: row.title, done: Boolean(row.done), gone: Boolean(row.gone) }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'projects.tasksOfProjects', error);
    return [];
  }
});
