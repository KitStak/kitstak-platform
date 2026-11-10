/** `GET /api/vas-operations/[id]/change-log` — field-level history of one VAS operation. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadVas } from "@/server/repositories/vas";

export const GET = defineRoute({
  permission: "settings.vas_operations.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadVas(db, auth, params.id);
    return changeLogResult(db, "vas_operation", params.id, query);
  },
});
