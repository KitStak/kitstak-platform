/** `GET /api/billing/[id]/charge-if-values?field=carrier` — the real values a lookup-backed Charge If attribute can take for this contract's client + warehouse. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { chargeIfValues } from "@/server/repositories/billing-lookups";

export const GET = defineRoute({
  permission: "settings.billing.view",
  params: idParamsSchema,
  query: z.object({ field: z.string().trim().min(1).max(64) }),
  handler: ({ db, auth, params, query }) => chargeIfValues(db, auth, params.id, query.field),
});
