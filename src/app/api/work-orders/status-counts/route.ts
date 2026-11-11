/** `GET /api/work-orders/status-counts` (grid grammar): counts per status for the status pills. */
import { defineRoute } from "@/server/api/define-route";
import { workOrderStatusCounts } from "@/server/repositories/work-orders";
import { WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: WO_PERMISSIONS.view,
  handler: async ({ db, auth, grid }) => await workOrderStatusCounts(db, auth.viewScope, grid()),
});
