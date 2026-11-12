/**
 * `GET /api/end-of-day/auto-close` — auto-close rules (cutoff time per warehouse and carrier setup) and the setups in scope.
 * `POST /api/end-of-day/auto-close` `{ carrierConnectionId, cutoffTime: "HH:mm", isActive }` — creates or updates a rule.
 */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx } from "@/server/repositories/platform-common";
import { autoCloseRuleSchema, getAutoCloseSetup, saveAutoCloseRule } from "@/server/repositories/shipping-carrier-ops";

export const GET = defineRoute({
  permission: "fulfillment.end_of_day.view",
  handler: async ({ db, auth }) => await getAutoCloseSetup(db, auth),
});

export const POST = defineRoute({
  permission: "fulfillment.end_of_day.print_end_of_the_day_report",
  body: autoCloseRuleSchema,
  handler: async ({ db, auth, actor, body }) => await saveAutoCloseRule(db, auth, domainCtx(actor, auth), body),
});
