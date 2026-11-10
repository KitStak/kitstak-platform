/** `POST /api/packing/slip { orderId }` — packing slip PDF for the order being packed (Print Actions). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { printPackingSlip } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";
import { scopedCtx } from "@/server/repositories/returns";

export const POST = defineRoute({
  permission: PACKING_PERMISSIONS.printSlip,
  transaction: false,
  body: z.object({ orderId: idSchema }),
  handler: ({ db, auth, actor, body }) => printPackingSlip(db, scopedCtx(actor, auth), body.orderId),
});
