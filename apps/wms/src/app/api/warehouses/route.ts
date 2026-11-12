/**
 * `GET /api/warehouses` — Warehouses grid (grid grammar).
 * `POST /api/warehouses` — create (administrators only).
 */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { warehouseSchema } from "@/lib/grid-defs/facility/warehouses";
import { createWarehouse, listWarehouses } from "@/server/repositories/warehouses";

export const GET = defineRoute({
  permission: ["settings.warehouse.view", "inventory.inventory_by_location.view"],
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listWarehouses(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.warehouse.create",
  body: warehouseSchema,
  handler: async ({ db, auth, actor, body }) => created(await createWarehouse(db, auth, actor, body)),
});
