/** `POST /api/shipment-plans/print` `{ ids }` — Manifest / BOL PDF for the selected plans. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/server/repositories/platform-common";
import { printPlanBol } from "@/server/repositories/shipment-plans";

export const POST = defineRoute({
  permission: "fulfillment.shipment_plan.print_manifest_bol",
  body: z.object({ ids: bulkIdsSchema }),
  transaction: false,
  handler: ({ db, auth, body }) => printPlanBol(db, auth, body.ids),
});
