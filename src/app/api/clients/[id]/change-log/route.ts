/** `GET /api/clients/[id]/change-log` — field-level history of one client. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadClient } from "@/server/repositories/clients";

export const GET = defineRoute({
  permission: ["settings.clients.change_log", "settings.clients.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadClient(db, auth, params.id);
    return await changeLogResult(db, "client", params.id, query);
  },
});
