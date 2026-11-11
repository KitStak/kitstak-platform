/** `GET /api/lp-types/[id]/change-log` — field-level history (the catalog has no LP-type change-log key; view gates it). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResultOrDeleted } from "@/server/repositories/locations-shared";
import { loadLpType } from "@/server/repositories/lp-types";

export const GET = defineRoute({
  permission: ["settings.lp_types.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    return await changeLogResultOrDeleted(db, auth, "lp_type", params.id, query, async () => await loadLpType(db, auth, params.id));
  },
});
