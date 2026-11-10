/** `GET /api/packing/scan?warehouseId=&mode=tote|location|order|putwall&code=` — resolves a scan to packable orders. */
import { defineRoute } from "@/server/api/define-route";
import { PACKING_PERMISSIONS, resolveScan, scanQuerySchema } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: scanQuerySchema,
  handler: ({ db, auth, query }) => resolveScan(db, auth.scope, query),
});
