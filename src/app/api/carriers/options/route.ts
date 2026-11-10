/** `GET /api/carriers/options` — carrier setups for filters. */
import { defineRoute } from "@/server/api/define-route";
import { carrierOptions } from "@/server/repositories/carriers";

export const GET = defineRoute({
  permission: ["integrations.integrations.create_setup", "integrations.integrations.edit_setup", "integrations.integrations.delete_setup", "integrations.carrier_monitoring.view"],
  handler: ({ db, auth }) => carrierOptions(db, auth),
});
