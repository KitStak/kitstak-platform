/** `GET /api/inventory/reasons` — adjustment & damage reasons plus the per-warehouse "reason required" flag. */
import { defineRoute } from "@/server/api/define-route";
import { inventoryReasons } from "@/server/repositories/inventory-lookups";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const GET = defineRoute({
  permission: [P.byLocationView, P.totalView],
  handler: async ({ db, auth }) => await inventoryReasons(db, auth),
});
