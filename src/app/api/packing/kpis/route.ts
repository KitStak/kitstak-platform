/** `GET /api/packing/kpis?warehouseId=` — orders / products the user packed today, orders to be packed. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { PACKING_PERMISSIONS, packingKpis } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: idSchema }),
  handler: ({ db, auth, query }) => packingKpis(db, auth.scope, query.warehouseId, auth.user.id),
});
