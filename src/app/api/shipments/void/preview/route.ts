/**
 * `POST /api/shipments/void/preview` `{ ids }` — every package a void will cancel: the selection
 * plus the Active siblings of each master-tracking group (multi-package shipments void together).
 * Read-only; the confirm dialog lists these rows and the real label / shipment counts.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/server/repositories/platform-common";
import { previewVoid } from "@/server/repositories/shipping";

export const POST = defineRoute({
  permission: "fulfillment.shipment_orders.void_label",
  body: z.object({ ids: bulkIdsSchema }),
  transaction: false,
  handler: ({ db, auth, body }) => previewVoid(db, auth, body.ids),
});
