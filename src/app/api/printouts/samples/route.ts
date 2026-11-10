/** `GET /api/printouts/samples` — recent orders (caller scope) to preview a design against. */
import { defineRoute } from "@/server/api/define-route";
import { sampleOrders } from "@/server/repositories/printouts-render";

export const GET = defineRoute({
  permission: "settings.printouts_labels.view",
  handler: ({ db, auth }) => sampleOrders(db, auth),
});
