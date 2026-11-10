/** `POST /api/ops/shipping/return-label` — creates a return label for a shipped order. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { shipping } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { returnLabelSchema, SHIPPING_PERMISSIONS } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: SHIPPING_PERMISSIONS.returnLabel,
  transaction: false,
  body: returnLabelSchema,
  handler: async ({ db, auth, actor, body }) => created(await shipping.createReturnLabel(db, domainCtx(actor, auth), body)),
});
