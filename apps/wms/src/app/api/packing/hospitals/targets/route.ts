/** `GET /api/packing/hospitals/targets?warehouseId=&q=` — Move back destinations (Storage / Picking). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { moveBackTargets } from "@/server/repositories/packing-hospitals";
import { PACKING_PERMISSIONS, warehouseIdParam } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: warehouseIdParam, q: z.string().max(60).default("") }),
  handler: async ({ db, auth, query }) => await moveBackTargets(db, auth.scope, query.warehouseId, query.q),
});
