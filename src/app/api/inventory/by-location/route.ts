/** `GET /api/inventory/by-location` — Inventory by Location grid (one row per bucket; spec 04 §2). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listBuckets } from "@/server/repositories/inventory-by-location";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const GET = defineRoute({
  permission: P.byLocationView,
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listBuckets(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
