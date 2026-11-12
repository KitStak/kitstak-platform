/** `GET /api/counts/accuracy?warehouseId&days=90` - count accuracy KPIs: totals, by SKU / location / counter, weekly trend. */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_ANY_VIEW } from "@/lib/grid-defs/counts/count-grids";
import { countAccuracy, countAccuracyQuerySchema } from "@/server/repositories/counts-accuracy";

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  query: countAccuracyQuerySchema,
  handler: async ({ db, auth, query }) => await countAccuracy(db, auth.viewScope, query),
});
