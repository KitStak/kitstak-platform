/**
 * `POST /api/returns/import` — returns-platform hook (Loop Returns): create RMAs from external returns.
 * Body: `{ platform: "Loop Returns", channelConnectionId?, returns: [{ externalId, order, lines: [{ sku, quantity, reason? }],
 * trackingNumber?, carrierCode?, expectedReturnDate?, note? }] }`. Idempotent per platform + externalId; per-return results.
 */
import { defineRoute } from "@/server/api/define-route";
import { RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";
import { importReturns, importReturnsSchema } from "@/server/repositories/returns-import";

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.createRma,
  body: importReturnsSchema,
  handler: async ({ db, auth, actor, body }) => await importReturns(db, scopedCtx(actor, auth), body),
});
