/** `GET /api/monitoring/setup/[id]` — Channel Setup Details dashboard. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { setupDetails } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => setupDetails(db, auth, params.id),
});
