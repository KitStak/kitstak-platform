/** `GET /api/kits`: Kit Inventory report (grid grammar); `meta.updatedAt` is the last recalculation. */
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { listKitInventory } from "@/server/repositories/kits";
import { KIT_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: KIT_PERMISSIONS.inventory,
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total, updatedAt } = listKitInventory(db, auth.viewScope, query);
    return result(rows, { meta: { total, page: query.page, pageSize: query.pageSize, updatedAt } });
  },
});
