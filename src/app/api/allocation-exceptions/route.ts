/** `GET /api/allocation-exceptions` — Allocation Exceptions grid. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listAllocationExceptions } from "@/server/repositories/waves";

export const GET = defineRoute({
  permission: "reports.wave_exceptions.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listAllocationExceptions(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
