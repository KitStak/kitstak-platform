/** `GET /api/packing/hospitals?warehouseId=` — designated hospital locations, default first (read: packing view, like /stock and /targets). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { hospitalOptions } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS, warehouseIdParam } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: warehouseIdParam }),
  handler: ({ db, auth, query }) => hospitalOptions(db, auth.scope, query.warehouseId),
});
