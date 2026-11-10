/** `GET /api/counts/pickers/lps?warehouseId=` - Add License Plate modal grid for the count wizard (LP count type, grid grammar). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { listPickLps } from "@/server/repositories/counts-pickers";

export const GET = defineRoute({
  permission: [P.create, P.edit],
  query: z.object({ warehouseId: z.string().min(1, "Choose a warehouse first").max(64), exceptPlanId: z.string().max(64).optional() }).passthrough(),
  handler: ({ db, auth, grid, query }) => {
    const page = listPickLps(db, auth.scope, query.warehouseId, grid(), query.exceptPlanId || null);
    return listResult(page.rows, { total: page.total, page: page.page, pageSize: page.pageSize });
  },
});
