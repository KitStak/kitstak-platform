/** `POST /api/counts/stock-hints` - on-hand per location / product for the wizard task grid. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse } from "@/server/auth/scope";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { stockHints } from "@/server/repositories/counts-plans";

const ids = z.array(z.string().min(1).max(64)).max(2000).default([]);

export const POST = defineRoute({
  permission: [P.view, P.create, P.edit],
  body: z.object({ warehouseId: z.string().min(1).max(64), locationIds: ids, productIds: ids }),
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, body }) => {
    if (!hasWarehouse(auth.scope, body.warehouseId)) throw notFoundError("Warehouse");
    return await stockHints(db, body.warehouseId, body.locationIds, body.productIds);
  },
});
