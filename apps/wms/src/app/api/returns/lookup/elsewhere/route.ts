/**
 * `GET /api/returns/lookup/elsewhere?code=` — the other in-scope warehouses where a scanned code
 * matches an RMA, so the Return Station can offer "Switch to <warehouse>". A code that matches
 * nothing is an ordinary outcome: 200 with `[]` (never a 4xx, so no browser console error).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { rmaWarehousesFor } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ code: z.string().trim().max(120).default("") }),
  handler: async ({ db, auth, query }) => (query.code ? await rmaWarehousesFor(db, auth.scope, query.code) : []),
});
