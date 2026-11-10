/** `GET /api/returns/summary` — RMA counts per status (status pills). */
import { defineRoute } from "@/server/api/define-route";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { returnStatusCounts } from "@/server/repositories/returns-grid";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.view,
  handler: ({ db, auth }) => returnStatusCounts(db, auth.viewScope),
});
