/**
 * Status summary for the count grids (M07): how many plans / lines sit in each status,
 * within the viewer's scope. Drives the status chips above each grid. Row sets are the grids'
 * own (`SKU_LINES_SOURCE`, `LOCATION_LINES_ONLY`), so a chip always equals its filtered grid total.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { Scope } from '@/server/auth/scope';
import { inList, raw } from './counts-grid';
import { LOCATION_LINES_ONLY, SKU_LINES_SOURCE } from './counts-grids';
import { dbAll } from '@/server/db/sql';

export type SummaryKind = 'plans' | 'locations' | 'skus';

export interface StatusSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  /** Plans / lines currently holding locked locations. */
  readonly locked: number;
}

export async function countStatusSummary(db: AppDb, scope: Scope, kind: SummaryKind): Promise<StatusSummary> {
  const scoped = inList(raw('p.warehouse_id'), scope.warehouseIds);
  const rows =
    kind === 'plans'
      ? await dbAll<{ status: string; n: number; locked: number }>(
          db,
          sql`
        SELECT p.status AS status, COUNT(*) AS n,
          SUM(CASE WHEN p.lock_locations = true AND p.status IN ('Pending','Ready To Count','Count Started','Count Completed') THEN 1 ELSE 0 END) AS locked
        FROM count_plans p WHERE ${scoped} GROUP BY p.status`,
        )
      : await dbAll<{ status: string; n: number; locked: number }>(
          db,
          sql`
        SELECT l.status AS status, COUNT(*) AS n,
          SUM(CASE WHEN p.lock_locations = true AND p.status IN ('Pending','Ready To Count','Count Started','Count Completed')
            AND l.status NOT IN ('Cancelled','Inventory Updated','Recount Created') THEN 1 ELSE 0 END) AS locked
        FROM ${kind === 'skus' ? raw(`${SKU_LINES_SOURCE} l`) : raw('count_plan_lines l')} JOIN count_plans p ON p.id = l.plan_id
        WHERE ${scoped} ${kind === 'locations' ? sql`AND ${raw(LOCATION_LINES_ONLY)}` : sql``} GROUP BY l.status`,
        );
  const byStatus: Record<string, number> = {};
  let total = 0;
  let locked = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.n);
    total += Number(r.n);
    locked += Number(r.locked ?? 0);
  }
  return { total, byStatus, locked };
}
