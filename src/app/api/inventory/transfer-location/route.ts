/** `POST /api/inventory/transfer-location` `{ fromLocationId, target }` — moves a whole location (spec 04 §2.6). */
import { defineRoute } from "@/server/api/define-route";
import { transferLocation, transferLocationSchema } from "@/server/repositories/inventory-commands";
import { domainCtx } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const POST = defineRoute({
  permission: P.transferLpLocation,
  body: transferLocationSchema,
  handler: ({ db, auth, actor, body }) => transferLocation(db, domainCtx(actor, auth), body),
});
