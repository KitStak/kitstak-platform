/** `GET /api/returns/summary?<grid query>` — grid-row (RMA line) counts per RMA status for the pills; same WHERE as the grid minus the status filter. */
import { defineRoute } from "@/server/api/define-route";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { returnStatusCounts } from "@/server/repositories/returns-grid";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.view,
  handler: async ({ db, auth, grid }) => await returnStatusCounts(db, auth.viewScope, grid()),
});
