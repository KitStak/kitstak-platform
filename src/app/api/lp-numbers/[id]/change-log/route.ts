/**
 * `GET /api/lp-numbers/[id]/change-log` — field-level history for one LP number.
 * One rule across M10 entities: whoever can view the record can view its change log
 * (critic R4: viewers could open every other facility change log but not this one).
 */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResultOrDeleted } from "@/server/repositories/locations-shared";
import { loadLp } from "@/server/repositories/lp-numbers";

export const GET = defineRoute({
  permission: ["settings.lp_numbers.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    return changeLogResultOrDeleted(db, auth, "license_plate", params.id, query, () => loadLp(db, auth, params.id));
  },
});
