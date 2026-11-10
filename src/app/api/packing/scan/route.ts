/**
 * `GET /api/packing/scan?warehouseId=&mode=tote|location|order|putwall&code=` — resolves a scan to packable orders.
 * Expected misses (unknown code, nothing allocated, open pack short) answer 200 `{ miss: { message } }`
 * so a mis-scan never writes a browser console error; an out-of-scope warehouse is still 404.
 */
import { defineRoute } from "@/server/api/define-route";
import { PACKING_PERMISSIONS, scanOutcome, scanQuerySchema } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: scanQuerySchema,
  handler: ({ db, auth, query }) => scanOutcome(db, auth.scope, query),
});
