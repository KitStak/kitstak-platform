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
import { db } from '@/server/db';

export interface TileStat {
  readonly label: string;
  readonly value: number;
}

export interface LauncherStats {
  readonly crm: readonly TileStat[] | null;
  readonly wms: readonly TileStat[] | null;
  readonly projects: readonly TileStat[] | null;
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

/** Open (not yet shipped/cancelled) shipment orders + orders shipped today. */
async function wmsStats(): Promise<readonly TileStat[] | null> {
  try {
    const result = await db.execute<{ open_orders: unknown; shipped_today: unknown }>(sql`
      select
        count(*) filter (
          where status not in ('Shipped', 'Delivered', 'Cancelled')
        ) as open_orders,
        count(*) filter (
          where shipped_at is not null
            and left(shipped_at, 10) = to_char(now(), 'YYYY-MM-DD')
        ) as shipped_today
      from wms.shipment_orders
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

/** Open tasks (status not done/cancelled) + live projects marked at risk or off track. */
async function projectsStats(orgId: string): Promise<readonly TileStat[] | null> {
  try {
    const result = await db.execute<{ open_tasks: unknown; at_risk: unknown }>(sql`
      select
        (select count(*)
           from pm.tasks t
           join pm.statuses s on s.id = t.status_id
           join pm.projects p on p.id = t.project_id
          where t.org_id = ${orgId}
            and t.deleted_at is null
            and p.deleted_at is null
            and p.archived_at is null
            and s.category not in ('done', 'cancelled')) as open_tasks,
        (select count(*)
           from pm.projects p
          where p.org_id = ${orgId}
            and p.deleted_at is null
            and p.archived_at is null
            and p.is_template = false
            and p.status not in ('completed', 'archived')
            and p.health in ('at_risk', 'off_track')) as at_risk
    `);
    const row = result.rows[0];
    if (!row) return null;
    return [
      { label: 'Open tasks', value: toCount(row.open_tasks) },
      { label: 'Projects at risk', value: toCount(row.at_risk) },
    ];
  } catch (error: unknown) {
    console.error('[portal] Projects launcher stats query failed', error);
    return null;
  }
}

/** Every tile's stats in parallel; a failed side degrades to `null`, never throws. */
export async function getLauncherStats(orgId: string): Promise<LauncherStats> {
  const [crm, wms, projects] = await Promise.all([crmStats(orgId), wmsStats(), projectsStats(orgId)]);
  return { crm, wms, projects };
}
