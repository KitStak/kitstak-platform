/** `GET|PATCH /api/lp-numbers/[id]` — detail (contents) and edit with Logiwa's field locks. */
import { defineRoute } from "@/server/api/define-route";
import { lpUpdateSchema } from "@/lib/grid-defs/facility/lp-numbers";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getLpNumber, loadLp, lpLocks, updateLpNumber } from "@/server/repositories/lp-numbers";

export const GET = defineRoute({
  permission: ["settings.lp_numbers.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => ({ ...(await getLpNumber(db, auth, params.id)), locks: lpLocks(await loadLp(db, auth, params.id)) }),
});

export const PATCH = defineRoute({
  permission: "settings.lp_numbers.edit",
  params: idParamsSchema,
  body: lpUpdateSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateLpNumber(db, auth, actor, params.id, body),
});
