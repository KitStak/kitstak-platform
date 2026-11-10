/** `POST /api/counts/variance` — read-only variance summary for the Update Inv. confirm (`{ level: plan|line, ids }`). */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_ANY_VIEW } from "@/lib/grid-defs/counts/count-grids";
import { varianceQuerySchema, varianceSummary } from "@/server/repositories/counts-ops";

export const POST = defineRoute({
  permission: COUNT_ANY_VIEW,
  body: varianceQuerySchema,
  transaction: false,
  rateLimit: false,
  handler: ({ db, auth, body }) => varianceSummary(db, auth, body),
});
