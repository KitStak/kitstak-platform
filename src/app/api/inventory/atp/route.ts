/** `GET /api/inventory/atp` — Available To Promise grid (spec 04 §3). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listAtp } from "@/server/repositories/inventory-atp";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

export const GET = defineRoute({
  permission: P.atpView,
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listAtp(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
