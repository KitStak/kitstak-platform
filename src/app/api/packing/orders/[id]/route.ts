/** `GET /api/packing/orders/[id]` — pack context: lines to pack, scan codes, packages, carriers, client settings. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { packContext } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  params: idParamsSchema,
  handler: ({ db, auth, params }) => packContext(db, auth.scope, params.id),
});
