/** `GET /api/retailers/[id]/change-log` — field-level history of one retailer. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadRetailer } from "@/server/repositories/retailers";

export const GET = defineRoute({
  permission: "settings.retailers.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, params, query }) => {
    loadRetailer(db, params.id);
    return changeLogResult(db, "retailer", params.id, query);
  },
});
