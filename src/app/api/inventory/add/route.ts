/** `POST /api/inventory/add` — header Add Inventory drawer (spec 04 §2.4). */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { addInventory, addInventorySchema } from "@/server/repositories/inventory-commands";
import { domainCtx } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const POST = defineRoute({
  permission: [P.addByAttributes, P.addLine],
  body: addInventorySchema,
  handler: async ({ db, auth, actor, body }) => created(await addInventory(db, domainCtx(actor, auth), body)),
});
