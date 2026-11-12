/**
 * `GET /api/inventory/destinations?kind=location|lp&q=&warehouseId=&productIds=a,b&exclude=id&exact=1`
 * Destination options for the inventory drawers, each with its restriction (count lock,
 * only-1-SKU) evaluated for the SKUs being placed, so blocked rows are badged and disabled in
 * the option list (read-only, scoped to the user's warehouses).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { destinationOptions } from "@/server/repositories/inventory-lookups";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

const idList = z.string().trim().max(4000).optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : []))
  .pipe(z.array(z.string().min(1).max(64)));

export const GET = defineRoute({
  permission: P.byLocationView,
  query: z.object({
    kind: z.enum(["location", "lp"]),
    q: z.string().max(100).optional().default(""),
    warehouseId: z.string().trim().min(1).max(64).optional(),
    productIds: idList,
    exclude: idList,
    exact: z.enum(["1", "true", "0", "false"]).optional(),
  }),
  handler: async ({ db, auth, query }) =>
    await destinationOptions(db, auth, {
      kind: query.kind, q: query.q, warehouseId: query.warehouseId ?? null,
      productIds: query.productIds, excludeInventoryIds: query.exclude, exact: query.exact === "1" || query.exact === "true",
    }),
});
