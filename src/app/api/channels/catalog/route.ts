/** `GET /api/channels/catalog` — Integration Management cards (15 channels, carriers) with connected counts. */
import { defineRoute } from "@/server/api/define-route";
import { integrationCatalog } from "@/server/repositories/channels";

export const GET = defineRoute({
  permission: ["integrations.integrations.create_setup", "integrations.integrations.edit_setup", "integrations.integrations.delete_setup", "integrations.integration_logs.view", "integrations.integration_monitoring.view"],
  handler: ({ db, auth }) => integrationCatalog(db, auth),
});
