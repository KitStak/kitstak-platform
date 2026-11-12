/** `GET /api/returns/[id]` — RMA detail (lines, receipts, label, legal transitions). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getReturnDetail, RETURN_PERMISSIONS } from "@/server/repositories/returns";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.view,
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getReturnDetail(db, auth.scope, params.id),
});
