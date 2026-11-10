/** `GET /api/inventory/buckets/[id]` — bucket drawer: attributes, allocations, last 50 transactions. */
import { defineRoute } from "@/server/api/define-route";
import { getBucketDetail } from "@/server/repositories/inventory-by-location";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const GET = defineRoute({
  permission: P.byLocationView,
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getBucketDetail(db, auth, params.id),
});
