/** `GET /api/inventory/product-options/[id]` — pack types and tracked attributes for Add Inventory. */
import { defineRoute } from "@/server/api/define-route";
import { productOptions } from "@/server/repositories/inventory-lookups";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const GET = defineRoute({
  permission: P.byLocationView,
  params: idParamsSchema,
  handler: ({ db, auth, params }) => productOptions(db, auth, params.id),
});
