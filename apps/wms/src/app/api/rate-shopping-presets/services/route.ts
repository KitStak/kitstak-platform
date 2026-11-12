/** `GET /api/rate-shopping-presets/services?warehouseId&clientId` — carrier services the client can use (Shipment Methods step). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { availableServices } from "@/server/repositories/rate-shopping";

export const GET = defineRoute({
  permission: "automation.rate_shopping.view",
  query: z.object({ warehouseId: z.string().min(1).max(64), clientId: z.string().min(1).max(64) }),
  handler: async ({ db, auth, query }) => await availableServices(db, auth, query.warehouseId, query.clientId),
});
