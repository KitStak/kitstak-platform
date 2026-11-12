/** `GET /api/putaway/suggest?inventoryId` — top putaway locations for one receiving-area bucket. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { suggestPutaway } from "@/server/repositories/putaway-worklist";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.view",
  query: z.object({ inventoryId: z.string().trim().min(1).max(64) }),
  handler: async ({ db, auth, query }) => await suggestPutaway(db, auth, query.inventoryId),
});
