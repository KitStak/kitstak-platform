/** `GET /api/algorithms/test/inventory?warehouseId&productId` — the product's inventory rows to test a putaway from. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { putawayTestInventory } from "@/server/repositories/algorithms";

export const GET = defineRoute({
  permission: "automation.algorithms.test",
  query: z.object({ warehouseId: z.string().min(1).max(64), productId: z.string().min(1).max(64) }),
  handler: async ({ db, auth, query }) => await putawayTestInventory(db, auth, query.warehouseId, query.productId),
});
