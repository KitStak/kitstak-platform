/** `GET /api/counts/[id]/ledger` — the plan's ledger `Count` transactions (timeline). */
import { sql } from "drizzle-orm";
import { defineRoute } from "@/server/api/define-route";
import { COUNT_ANY_VIEW } from "@/lib/grid-defs/counts/count-grids";
import { resolvePlanId } from "@/server/repositories/counts-plans";
import { idParamsSchema } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  params: idParamsSchema,
  handler: ({ db, auth, params }) => {
    const id = resolvePlanId(db, auth.scope, params.id);
    return db.all(sql`
      SELECT t.id, t.at AS at, t.type, pr.sku, t.uom_qty AS quantity, COALESCE(lo.code, '') || COALESCE(' · ' || t.to_lot, '') AS detail,
        COALESCE((SELECT u.name FROM users u WHERE lower(u.email) = lower(t.source)), t.source) AS source
      FROM inventory_transactions t JOIN products pr ON pr.id = t.product_id LEFT JOIN locations lo ON lo.id = COALESCE(t.to_location_id, t.from_location_id)
      WHERE t.count_plan_id = ${id} ORDER BY t.seq DESC LIMIT 200`);
  },
});
