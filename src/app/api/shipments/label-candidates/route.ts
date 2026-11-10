/** `GET /api/shipments/label-candidates?q=&planId=` — orders that can get a shipping label now (Create label dialog). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { labelCandidates } from "@/server/repositories/shipping-label-candidates";

export const GET = defineRoute({
  permission: "fulfillment.shipment_orders.create_label",
  query: z.object({ q: z.string().trim().max(120).optional(), planId: z.string().trim().max(64).optional() }),
  handler: ({ db, auth, query }) => labelCandidates(db, auth, query),
});
