/** `GET /api/returns/open?warehouseId=&limit=` — outstanding RMAs (Pending / In Transit / Started) for the Return Station. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { warehouseIdParam } from "@/server/repositories/packing-scan";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { openRmas } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ warehouseId: warehouseIdParam, limit: z.coerce.number().int().min(1).max(50).optional() }),
  handler: async ({ db, auth, query }) => await openRmas(db, auth.scope, query.warehouseId, query.limit ?? 8),
});
