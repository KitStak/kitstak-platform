/** `GET /api/monitoring/setup` — the default (most recently active) setup id for Channel Setup Details. */
import { defineRoute } from "@/server/api/define-route";
import { defaultSetupId } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  handler: ({ db, auth }) => ({ id: defaultSetupId(db, auth) }),
});
