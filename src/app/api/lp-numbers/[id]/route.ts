/** `GET|PATCH /api/lp-numbers/[id]` — detail (contents) and edit with Logiwa's field locks. */
import { defineRoute } from "@/server/api/define-route";
import { lpUpdateSchema } from "@/lib/grid-defs/facility/lp-numbers";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getLpNumber, loadLp, lpLocks, updateLpNumber } from "@/server/repositories/lp-numbers";

export const GET = defineRoute({
  permission: ["settings.lp_numbers.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: ({ db, auth, params }) => ({ ...getLpNumber(db, auth, params.id), locks: lpLocks(loadLp(db, auth, params.id)) }),
});

export const PATCH = defineRoute({
  permission: "settings.lp_numbers.edit",
  params: idParamsSchema,
  body: lpUpdateSchema,
  handler: ({ db, auth, actor, params, body }) => updateLpNumber(db, auth, actor, params.id, body),
});
