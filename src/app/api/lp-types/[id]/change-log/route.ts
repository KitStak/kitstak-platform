/** `GET /api/lp-types/[id]/change-log` — field-level history (the catalog has no LP-type change-log key; view gates it). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadLpType } from "@/server/repositories/lp-types";

export const GET = defineRoute({
  permission: "settings.lp_types.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadLpType(db, auth, params.id);
    return changeLogResult(db, "lp_type", params.id, query);
  },
});
