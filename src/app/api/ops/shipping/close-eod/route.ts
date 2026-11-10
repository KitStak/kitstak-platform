/** `POST /api/ops/shipping/close-eod` `{ manifestId }` — closes an end-of-day manifest. */
import { defineRoute } from "@/server/api/define-route";
import { shipping } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { closeEodSchema, SHIPPING_PERMISSIONS } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: SHIPPING_PERMISSIONS.closeEod,
  body: closeEodSchema,
  handler: ({ db, auth, actor, body }) => shipping.closeEndOfDay(db, domainCtx(actor, auth), body),
});
