/** `GET /api/kits/:id?warehouseId=`: kit card + BOM with live free component stock. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getKitDetail } from "@/server/repositories/kits";
import { KIT_PERMISSIONS, WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: [WO_PERMISSIONS.view, KIT_PERMISSIONS.inventory],
  params: z.object({ id: z.string().trim().min(1).max(64) }),
  query: z.object({ warehouseId: z.string().trim().max(64).optional() }),
  handler: ({ db, auth, params, query }) => getKitDetail(db, auth.scope, params.id, query.warehouseId || null),
});
