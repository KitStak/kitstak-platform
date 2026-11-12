/**
 * `GET /api/counts/[id]/actors` — display names for the sources on the plan's timeline
 * (change log + ledger rows store the login email). Returns `{ "<source>": "<user name>" }`.
 */
import { sql } from 'drizzle-orm';
import { defineRoute } from '@/server/api/define-route';
import { COUNT_ANY_VIEW } from '@/lib/grid-defs/counts/count-grids';
import { resolvePlanId } from '@/server/repositories/counts-plans';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { dbAll } from '@/server/db/sql';

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => {
    const id = await resolvePlanId(db, auth.scope, params.id);
    const rows = await dbAll<{ source: string; name: string | null }>(
      db,
      sql`
      SELECT s.source AS source, (SELECT u.name FROM users u WHERE lower(u.email) = lower(s.source)) AS name FROM (
        SELECT DISTINCT c.source AS source FROM change_log c
        WHERE (c.entity_type = 'count_plan' AND c.entity_id = ${id}) OR (c.parent_entity_type = 'count_plan' AND c.parent_entity_id = ${id})
        UNION SELECT DISTINCT t.source FROM inventory_transactions t WHERE t.count_plan_id = ${id}
        UNION SELECT DISTINCT e.counted_by FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id WHERE l.plan_id = ${id} AND e.counted_by IS NOT NULL
      ) s`,
    );
    return Object.fromEntries(rows.filter((r) => r.name).map((r) => [r.source, r.name as string]));
  },
});
