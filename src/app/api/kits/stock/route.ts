/**
 * `GET /api/kits/stock?productId&warehouseId&clientId`: free Stock buckets of a product
 * (component source editor, Disassemble source picker).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listStockBuckets } from "@/server/repositories/kits";
import { WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: WO_PERMISSIONS.view,
  query: z.object({
    productId: z.string().trim().min(1).max(64),
    warehouseId: z.string().trim().min(1).max(64),
    clientId: z.string().trim().max(64).optional(),
  }),
  handler: ({ db, auth, query }) => listStockBuckets(db, auth.scope, { productId: query.productId, warehouseId: query.warehouseId, clientId: query.clientId || null }),
});
