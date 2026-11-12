/** `GET /api/counts/instant/location?warehouseId=&code=` - resolves a scanned location and its stock for Quick Count. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { instantLocation } from "@/server/repositories/counts-sheet";

export const GET = defineRoute({
  permission: [P.create, P.mobileInstant],
  query: z.object({ warehouseId: z.string().min(1).max(64), code: z.string().trim().min(1, "Scan a location").max(120) }),
  handler: async ({ db, auth, query }) => await instantLocation(db, auth.scope, query.warehouseId, query.code),
});
