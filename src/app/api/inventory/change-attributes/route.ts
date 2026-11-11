/** `POST /api/inventory/change-attributes` `{ ids, attribute, value, qty? }` → per-id BulkResult (spec 04 §2.8). */
import { defineRoute } from "@/server/api/define-route";
import { changeAttributes, changeAttributesSchema } from "@/server/repositories/inventory-commands";
import { domainCtx } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const POST = defineRoute({
  permission: P.changeAttributes,
  body: changeAttributesSchema,
  handler: async ({ db, auth, actor, body }) => await changeAttributes(db, domainCtx(actor, auth), body),
});
