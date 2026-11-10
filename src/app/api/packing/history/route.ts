/**
 * `GET /api/packing/history?warehouseId=&since=` — orders the signed-in user finished packing
 * today in the warehouse (newest first). `since` (ISO) is the dashboard "Clear completed" mark.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { PACKING_PERMISSIONS, packingHistory, warehouseIdParam } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: warehouseIdParam, since: z.string().datetime({ offset: true }).optional() }),
  handler: ({ db, auth, query }) => packingHistory(db, auth.scope, query.warehouseId, auth.user.id, { since: query.since ?? null }),
});
