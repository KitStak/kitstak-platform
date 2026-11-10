/** `GET /api/clients/[id]/change-log` — field-level history of one client. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadClient } from "@/server/repositories/clients";

export const GET = defineRoute({
  permission: ["settings.clients.change_log", "settings.clients.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadClient(db, auth, params.id);
    return changeLogResult(db, "client", params.id, query);
  },
});
