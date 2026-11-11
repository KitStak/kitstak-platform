/** `GET /api/counts/assignees?warehouseId=` - warehouse staff who can count (Create Job / Create Recount "Assign to"). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { countAssignees } from "@/server/repositories/counts-assignees";

export const GET = defineRoute({
  permission: [P.createJob, P.locRecount, P.skuRecount],
  query: z.object({ warehouseId: z.string().min(1, "Choose a warehouse first").max(64) }),
  handler: async ({ db, auth, query }) => await countAssignees(db, auth.scope, query.warehouseId),
});
