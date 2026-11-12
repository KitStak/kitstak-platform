/** `GET|PATCH /api/warehouses/[id]` — detail and edit (optimistic `version`). */
import { defineRoute } from "@/server/api/define-route";
import { warehouseSchema } from "@/lib/grid-defs/facility/warehouses";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getWarehouse, updateWarehouse } from "@/server/repositories/warehouses";

export const GET = defineRoute({
  permission: ["settings.warehouse.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getWarehouse(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.warehouse.edit",
  params: idParamsSchema,
  body: warehouseSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateWarehouse(db, auth, actor, params.id, body),
});
