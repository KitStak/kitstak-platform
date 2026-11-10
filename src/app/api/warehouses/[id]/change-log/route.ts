/** `GET /api/warehouses/[id]/change-log` — field-level history of one warehouse. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadWarehouse } from "@/server/repositories/warehouses";

export const GET = defineRoute({
  permission: "settings.warehouse.change_log",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadWarehouse(db, auth, params.id);
    return changeLogResult(db, "warehouse", params.id, query);
  },
});
