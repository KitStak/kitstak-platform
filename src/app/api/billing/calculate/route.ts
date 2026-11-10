/** `POST /api/billing/calculate { ids, mode, start?, end? }` — runs the billing engine now and writes one bill per contract. */
import { defineRoute } from "@/server/api/define-route";
import { calculateContracts, calculateSchema } from "@/server/repositories/billing-reports";

export const POST = defineRoute({
  permission: "settings.billing.calculate",
  body: calculateSchema,
  handler: ({ db, auth, actor, body }) => calculateContracts(db, auth, actor, body),
});
