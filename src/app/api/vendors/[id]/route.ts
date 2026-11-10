/** `/api/vendors/[id]` — vendor detail and edit (client locked, optimistic `version`). */
import { defineRoute } from "@/server/api/define-route";
import { vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { getVendor, updateVendor } from "@/server/repositories/vendors";

export const GET = defineRoute({
  permission: ["settings.vendors.view", "inventory.purchase_orders.view"],
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getVendor(db, auth.scope, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.vendors.edit",
  params: idParamsSchema,
  body: vendorFormSchema,
  handler: ({ db, auth, actor, params, body }) => updateVendor(db, domainCtx(actor, auth), auth.scope, params.id, body),
});
