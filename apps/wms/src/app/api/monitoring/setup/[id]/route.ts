/** `GET /api/monitoring/setup/[id]?tz` — Channel Setup Details dashboard (days bucketed in the viewer's zone). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { setupDetails } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  params: idParamsSchema,
  query: z.object({ tz: z.string().max(64).optional() }),
  handler: async ({ db, auth, params, query }) => await setupDetails(db, auth, params.id, new Date(), query.tz),
});
