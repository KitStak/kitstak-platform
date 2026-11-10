/** `GET /api/monitoring/missing-orders/[id]` — Order Details drawer (error catalog + payload). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getMissing } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getMissing(db, auth, params.id),
});
