/** `GET /api/inventory` — Total Inventory grid (grid grammar; spec 04 §1). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listTotalInventory } from "@/server/repositories/inventory-total";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const GET = defineRoute({
  permission: P.totalView,
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listTotalInventory(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
