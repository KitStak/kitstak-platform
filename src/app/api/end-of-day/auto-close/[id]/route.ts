/** `DELETE /api/end-of-day/auto-close/[id]` — removes an auto-close rule. */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { deleteAutoCloseRule } from "@/server/repositories/shipping-carrier-ops";

export const DELETE = defineRoute({
  permission: "fulfillment.end_of_day.print_end_of_the_day_report",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => deleteAutoCloseRule(db, auth, domainCtx(actor, auth), params.id),
});
