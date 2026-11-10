/** `POST /api/vendors/[id]/active { active, version }` — deactivate (blocked with open POs) / reactivate. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { setVendorActive } from "@/server/repositories/vendors";

export const POST = defineRoute({
  permission: "settings.vendors.edit",
  params: idParamsSchema,
  body: z.object({ active: z.boolean(), version: z.number().int().min(1).optional() }),
  handler: ({ db, auth, actor, params, body }) => setVendorActive(db, domainCtx(actor, auth), auth.scope, params.id, body.active, body.version),
});
