/** `POST /api/inventory/transfer-lp` `{ lpId, target }` — moves an LP (with child LPs) or merges it onto another LP (spec 04 §2.5). */
import { defineRoute } from "@/server/api/define-route";
import { transferLp, transferLpSchema } from "@/server/repositories/inventory-commands";
import { domainCtx } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const POST = defineRoute({
  permission: P.transferLpLocation,
  body: transferLpSchema,
  handler: ({ db, auth, actor, body }) => transferLp(db, domainCtx(actor, auth), body),
});
