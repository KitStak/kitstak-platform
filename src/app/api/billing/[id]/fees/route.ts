/** `POST /api/billing/[id]/fees` — Create Fee (operation, Fee By / Charge By matrix, conditions, tiers, min/max, split month). */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { feeSchema } from "@/lib/grid-defs/organization/billing";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { createFee } from "@/server/repositories/billing";

export const POST = defineRoute({
  permission: "settings.billing.edit",
  params: idParamsSchema,
  body: feeSchema,
  handler: ({ db, auth, actor, params, body }) => created(createFee(db, auth, actor, params.id, body)),
});
