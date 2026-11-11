/**
 * `POST /api/work-orders/pick-list { ids, consolidated }`: print records for the
 * Work Order (Consolidated) Picking List templates. Read-only, so no transaction.
 */
import { defineRoute } from "@/server/api/define-route";
import { pickListBodySchema, WO_PERMISSIONS } from "@/server/repositories/work-orders-api";
import { buildPickLists } from "@/server/repositories/work-orders-ops";

export const POST = defineRoute({
  permission: WO_PERMISSIONS.view,
  body: pickListBodySchema,
  transaction: false,
  handler: async ({ db, auth, body }) => await buildPickLists(db, auth.scope, body.ids, body.consolidated),
});
