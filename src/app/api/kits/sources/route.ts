/**
 * `GET /api/kits/sources?productIds=a,b,c&warehouseId&clientId`: free Stock buckets of every
 * component in one request (Create Work Order > Auto-assign all sources). Each bucket carries
 * `lockedBy`, the count plan that locks its location, so locked stock is never suggested.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listStockBucketsFor, MAX_SOURCE_PRODUCTS } from "@/server/repositories/kits";
import { WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: WO_PERMISSIONS.view,
  query: z.object({
    productIds: z.string().trim().min(1).max(64 * MAX_SOURCE_PRODUCTS + MAX_SOURCE_PRODUCTS)
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(z.string().min(1).max(64)).min(1).max(MAX_SOURCE_PRODUCTS)),
    warehouseId: z.string().trim().min(1).max(64),
    clientId: z.string().trim().max(64).optional(),
  }),
  handler: ({ db, auth, query }) => listStockBucketsFor(db, auth.scope, { productIds: query.productIds, warehouseId: query.warehouseId, clientId: query.clientId || null }),
});
