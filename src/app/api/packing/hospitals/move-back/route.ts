/** `POST /api/packing/hospitals/move-back { inventoryId, qty, toLocationId, note? }` — free hospital stock back to storage. */
import { defineRoute } from "@/server/api/define-route";
import { moveBackFromHospital, moveBackSchema } from "@/server/repositories/packing-hospitals";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";
import { scopedCtx } from "@/server/repositories/returns";

export const POST = defineRoute({
  permission: PACKING_PERMISSIONS.execute,
  body: moveBackSchema,
  handler: async ({ db, auth, actor, body }) => await moveBackFromHospital(db, scopedCtx(actor, auth), body),
});
