/**
 * `GET /api/packing/kpis?warehouseId=&stationId=` — orders / products the user packed today, orders to be packed,
 * pack-short orders held in hospitals, orders with packing warnings, and (with a station) that station's totals today.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { PACKING_PERMISSIONS, packingKpis, warehouseIdParam } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: warehouseIdParam, stationId: idSchema.optional() }),
  handler: async ({ db, auth, query }) => await packingKpis(db, auth.scope, query.warehouseId, auth.user.id, new Date(), query.stationId ?? null),
});
