/** `GET /api/carriers/[id]/change-log` — field-level history of a carrier setup. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/integration-logs-kit";
import { loadCarrierConnection } from "@/server/repositories/carriers";

export const GET = defineRoute({
  permission: ["integrations.integrations.create_setup", "integrations.integrations.edit_setup", "integrations.integrations.delete_setup"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadCarrierConnection(db, auth, params.id);
    return await changeLogResult(db, "carrier_connection", params.id, query);
  },
});
