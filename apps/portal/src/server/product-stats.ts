/**
 * Live operational signal for the launcher tiles, read server-side from the shared
 * database. The portal's Drizzle schema only covers `core`, so these are deliberate
 * raw-SQL reads against the sibling apps' schemas (`crm.items`/`crm.boards`,
 * `wms.shipment_orders`). Each query is defensive: any failure (schema missing on a
 * fresh environment, shape drift) resolves to `null` and the tile simply renders
 * without numbers — the launcher never breaks because a sibling app moved.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { findWmsTenantSchema, wmsTable } from '@kitstak/db/wms-tenants';
import { formatMarginBp, getOrgSummary, listJobsNeedingAttention, type BridgeExecutor, type PulseJobSummary } from '@kitstak/pulse-bridge';
import { db } from '@/server/db';

export interface TileStat {
  readonly label: string;
  readonly value: number;
  /** Text shown in place of the bare number (a percent, for example). */
  readonly display?: string;
  readonly tone?: 'default' | 'warning' | 'danger';
}

export interface LauncherStats {
  readonly crm: readonly TileStat[] | null;
  readonly wms: readonly TileStat[] | null;
  readonly projects: readonly TileStat[] | null;
  readonly pulse: readonly TileStat[] | null;
}

/**
 * Mirrors CRM's own stage heuristic (apps/crm/src/server/services/crm-model.ts): a stage
 * label id matching won/lost/dead/disqualified means the deal is closed.
 */
const CLOSED_STAGE_PATTERN = '(won|lost|dead|disqualified)';
const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}';

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Open deals + deals whose close date falls inside the next 7 days, on `kind='deals'` boards. */
async function crmStats(orgId: string): Promise<readonly TileStat[] | null> {
  try {
    const result = await db.execute<{ open_deals: unknown; due_this_week: unknown }>(sql`
      select
        count(*) filter (
          where coalesce(i.values #>> '{stage,labelId}', '') !~* ${CLOSED_STAGE_PATTERN}
        ) as open_deals,
        count(*) filter (
          where coalesce(i.values #>> '{stage,labelId}', '') !~* ${CLOSED_STAGE_PATTERN}
            and i.values #>> '{close_date,date}' ~ ${ISO_DATE_PATTERN}
            and left(i.values #>> '{close_date,date}', 10)::date
              between current_date and current_date + 6
        ) as due_this_week
      from crm.items i
      join crm.boards b on b.id = i.board_id
      where i.org_id = ${orgId}
        and b.kind = 'deals'
        and b.deleted_at is null
        and b.archived_at is null
        and i.deleted_at is null
        and i.archived_at is null
        and i.parent_item_id is null
    `);
    const row = result.rows[0];
    if (!row) return null;
    return [
      { label: 'Open deals', value: toCount(row.open_deals) },
      { label: 'Due this week', value: toCount(row.due_this_week) },
    ];
  } catch (error: unknown) {
    console.error('[portal] CRM launcher stats query failed', error);
    return null;
  }
}

/**
 * Open (not yet shipped/cancelled) shipment orders + orders shipped today, from THIS org's
 * own warehouse (one separate warehouse per organization); null when it has none.
 */
async function wmsStats(orgId: string): Promise<readonly TileStat[] | null> {
  try {
    const schema = await findWmsTenantSchema(db, orgId);
    if (!schema) return null;
    const result = await db.execute<{ open_orders: unknown; shipped_today: unknown }>(sql`
      select
        count(*) filter (
          where status not in ('Shipped', 'Delivered', 'Cancelled')
        ) as open_orders,
        count(*) filter (
          where shipped_at is not null
            and left(shipped_at, 10) = to_char(now(), 'YYYY-MM-DD')
        ) as shipped_today
      from ${wmsTable(schema, 'shipment_orders')}
    `);
    const row = result.rows[0];
    if (!row) return null;
    return [
      { label: 'Open orders', value: toCount(row.open_orders) },
      { label: 'Shipped today', value: toCount(row.shipped_today) },
    ];
  } catch (error: unknown) {
    console.error('[portal] WMS launcher stats query failed', error);
    return null;
  }
}

/**
 * Open tasks (top-level, like the Projects header and Reports; subtasks count toward their parent),
 * live projects marked at risk / off track, and open tasks due in the next 7 days
 * (KitStak Projects, `pm` schema). Guarded by to_regclass: an environment without Projects
 * installed returns null quietly (no error log), like a missing sibling app should.
 */
async function projectsStats(orgId: string): Promise<readonly TileStat[] | null> {
  try {
    const installed = await db.execute<{ ok: boolean }>(sql`select to_regclass('pm.tasks') is not null as ok`);
    if (!installed.rows[0]?.ok) return null;
    const result = await db.execute<{ open_tasks: unknown; at_risk: unknown; due_this_week: unknown }>(sql`
      with open_tasks as (
        select t.due_date
          from pm.tasks t
          join pm.statuses s on s.id = t.status_id
          join pm.projects p on p.id = t.project_id
         where t.org_id = ${orgId}
           and t.deleted_at is null
           and t.parent_task_id is null
           and p.deleted_at is null
           and p.archived_at is null
           and p.is_template = false
           and s.category not in ('done', 'cancelled')
      )
      select
        (select count(*) from open_tasks) as open_tasks,
        (select count(*)
           from pm.projects p
          where p.org_id = ${orgId}
            and p.deleted_at is null
            and p.archived_at is null
            and p.is_template = false
            and p.status not in ('completed', 'archived')
            and p.health in ('at_risk', 'off_track')) as at_risk,
        (select count(*) from open_tasks where due_date between current_date and current_date + 6) as due_this_week
    `);
    const row = result.rows[0];
    if (!row) return null;
    return [
      { label: 'Open tasks', value: toCount(row.open_tasks) },
      { label: 'Due soon', value: toCount(row.due_this_week) },
      { label: 'At risk', value: toCount(row.at_risk) },
    ];
  } catch (error: unknown) {
    console.error('[portal] Projects launcher stats query failed', error);
    return null;
  }
}

/**
 * KitStak Pulse: open jobs, jobs at risk (at risk plus losing money) and the margin this month
 * so far. Read through @kitstak/pulse-bridge, which checks `to_regclass('pulse.jobs')`, answers
 * for this person's Pulse role and hides the margin from people who may not see money (they get
 * the count of jobs losing money in its place). Not installed, no role or any failure: null.
 */
async function pulseStats(orgId: string, userId: string | undefined): Promise<readonly TileStat[] | null> {
  if (!userId) return null;
  try {
    const summary = await getOrgSummary(db as unknown as BridgeExecutor, { orgId, userId });
    if (!summary.available) return null;
    // No jobs at all: all zero with no display text, so the tile shows its teaching empty state.
    if (summary.totalJobs === 0) {
      return [
        { label: 'Open jobs', value: 0 },
        { label: 'At risk', value: 0 },
      ];
    }
    const risky = summary.atRisk + summary.losing;
    const third: TileStat = summary.moneyHidden
      ? { label: 'Losing money', value: summary.losing, display: String(summary.losing), tone: summary.losing > 0 ? 'danger' : 'default' }
      : {
          label: 'Margin this month',
          value: summary.marginBp ?? 0,
          display: formatMarginBp(summary.marginBp, { empty: 'None yet' }),
          tone: summary.marginBp !== null && summary.marginBp < 0 ? 'danger' : 'default',
        };
    return [
      { label: 'Open jobs', value: summary.openJobs, display: String(summary.openJobs) },
      { label: 'At risk', value: risky, display: String(risky), tone: summary.losing > 0 ? 'danger' : risky > 0 ? 'warning' : 'default' },
      third,
    ];
  } catch (error: unknown) {
    console.error('[portal] Pulse launcher stats query failed', error);
    return null;
  }
}

/** Every tile's stats in parallel; a failed side degrades to `null`, never throws. */
export async function getLauncherStats(orgId: string, userId?: string): Promise<LauncherStats> {
  const [crm, wms, projects, pulse] = await Promise.all([
    crmStats(orgId),
    wmsStats(orgId),
    projectsStats(orgId),
    pulseStats(orgId, userId),
  ]);
  return { crm, wms, projects, pulse };
}

export interface PulseAttention {
  /** Jobs that are losing money or at risk, worst first. */
  readonly jobs: readonly PulseJobSummary[];
  /** All such jobs, not only the ones listed. */
  readonly total: number;
  readonly moneyHidden: boolean;
}

/** "Jobs that need you" on the launcher. Null when Pulse is absent or the person has no role. */
export async function getPulseAttention(orgId: string, userId: string, limit = 5): Promise<PulseAttention | null> {
  try {
    const result = await listJobsNeedingAttention(db as unknown as BridgeExecutor, { orgId, userId }, { limit });
    if (!result.available) return null;
    return { jobs: result.jobs, total: result.totals.jobs, moneyHidden: result.moneyHidden };
  } catch (error: unknown) {
    console.error('[portal] Pulse attention query failed', error);
    return null;
  }
}

export interface CustomerWork {
  readonly customerId: string;
  readonly name: string;
  readonly code: string;
  readonly projects: number;
  readonly openTasks: number;
  readonly atRisk: number;
  readonly offTrack: number;
}

/**
 * KitStak Projects work per shared customer (core.customers): live projects that serve the
 * customer (their own `crm_customer_id` or a project-level `core_customer` link), open top-level
 * tasks and how many of those projects are at risk / off track. Busiest customers first. Guarded
 * like `projectsStats`: no pm schema or any failure resolves to [].
 */
export async function getCustomerWork(orgId: string, limit = 6): Promise<readonly CustomerWork[]> {
  try {
    const installed = await db.execute<{ ok: boolean }>(
      sql`select to_regclass('pm.projects') is not null and to_regclass('pm.integration_links') is not null as ok`,
    );
    if (!installed.rows[0]?.ok) return [];
    const result = await db.execute<{
      customer_id: string;
      name: string;
      code: string;
      projects: unknown;
      open_tasks: unknown;
      at_risk: unknown;
      off_track: unknown;
    }>(sql`
      with live as (
        select p.id, p.health, p.crm_customer_id::text as customer_id
          from pm.projects p
         where p.org_id = ${orgId} and p.deleted_at is null and p.archived_at is null
           and p.is_template = false and p.status not in ('completed', 'archived')
      ),
      pairs as (
        select id, health, customer_id from live where customer_id is not null
        union
        select l.id, l.health, il.target_id from live l
          join pm.integration_links il on il.project_id = l.id and il.task_id is null and il.target_type = 'core_customer'
      ),
      per as (
        select pr.customer_id,
               count(distinct pr.id) as projects,
               count(distinct pr.id) filter (where pr.health = 'at_risk') as at_risk,
               count(distinct pr.id) filter (where pr.health = 'off_track') as off_track,
               (select count(*) from pm.tasks t join pm.statuses s on s.id = t.status_id
                 where t.project_id = any(array_agg(pr.id)) and t.deleted_at is null and t.parent_task_id is null
                   and s.category not in ('done', 'cancelled')) as open_tasks
          from pairs pr group by pr.customer_id
      )
      select per.customer_id, c.name, c.code, per.projects, per.open_tasks, per.at_risk, per.off_track
        from per join core.customers c on c.id::text = per.customer_id and c.deleted_at is null
       order by (per.at_risk + per.off_track) desc, per.open_tasks desc, c.name
       limit ${limit}
    `);
    return result.rows.map((row) => ({
      customerId: row.customer_id,
      name: row.name,
      code: row.code,
      projects: toCount(row.projects),
      openTasks: toCount(row.open_tasks),
      atRisk: toCount(row.at_risk),
      offTrack: toCount(row.off_track),
    }));
  } catch (error: unknown) {
    console.error('[portal] Projects customer work query failed', error);
    return [];
  }
}
