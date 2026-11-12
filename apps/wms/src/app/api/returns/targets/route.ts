/** `GET /api/returns/targets?warehouseId=&kind=location|lp&q=` — Return Target candidates. */
import { defineRoute } from "@/server/api/define-route";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { returnTargets, targetQuerySchema } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: targetQuerySchema,
  handler: async ({ db, auth, query }) => await returnTargets(db, auth.scope, query),
});
