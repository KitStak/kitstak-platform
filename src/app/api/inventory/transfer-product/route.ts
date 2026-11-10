/** `POST /api/inventory/transfer-product` `{ inventoryId, qty, target }` — partial move of one bucket (spec 04 §2.7). */
import { defineRoute } from "@/server/api/define-route";
import { transferProduct, transferProductSchema } from "@/server/repositories/inventory-commands";
import { domainCtx } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const POST = defineRoute({
  permission: P.transferProduct,
  body: transferProductSchema,
  handler: ({ db, auth, actor, body }) => transferProduct(db, domainCtx(actor, auth), body),
});
